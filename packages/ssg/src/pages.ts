// Pages on request: the application's page rendered for every request, with the answers its
// reads were given written into it, so the browser takes the page over without asking again
// (design 304).
//
// A render asks as a visitor nobody knows. The gate the application hands in is asked who a
// request with no headers is, and its `access` is asked for every module a page asks, so a read
// the gate keeps from an anonymous visitor is kept out of the page's HTML too.

import { readFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { Client, ClientStatus, Handle } from '@aweftjs/client';
import { codecError } from '@aweftjs/codec';
import { immutable } from '@aweftjs/core';
import { createRouter } from '@aweftjs/dom/router';
import type { Router } from '@aweftjs/dom/router';
import type { Gate, Identified } from '@aweftjs/server';
import { context, render } from '@aweftjs/ui';

import { type Recorded, type Refused, askKey, crossed, throughJson } from './answers.ts';
import { buildDocument, statusOf } from './document.ts';
import { emptyStage } from './site.ts';

/** What `createPages` takes. */
export interface PagesOptions {
	/**
	 * The whole page, built from a router and a client. The same function the browser entry
	 * mounts with its own router and its own client, so the markup here is the markup it renders.
	 */
	page(router: Router, client: Client): unknown;
	/**
	 * The gate the server runs. A render asks it who a request for the page's path, with no query
	 * and no headers, is, and asks its `access` for every module a page asks: `open`, or the
	 * `auth/Gate` instance from `deps`.
	 */
	readonly gate: Gate;
	/**
	 * The modules a page may ask while it renders, each under the name the page asks it by. Read
	 * once, when the module is made, and each has to carry a `call`.
	 */
	readonly modules: Readonly<Record<string, unknown>>;
	/**
	 * The directory the bundler wrote, resolved from the working directory. Its `index.html` is the
	 * page shell, and a path that names a file in it is left to the next module. `dist` when left off.
	 */
	readonly dir?: string;
	/** How many renders may run at once. Past it, the shell answers with 503. 16 when left off. */
	readonly renders?: number;
	/** How long a render may take, in milliseconds. Past it, the shell answers with 503. 10 000 when left off. */
	readonly timeoutMs?: number;
}

/** The server module `createPages` makes: what a gate reads, and the hook the server walks to. */
export interface Pages {
	/** True, so a gate that reads it lets anyone fetch a page. A render is anonymous whoever asks. */
	readonly public: true;
	/** A page request rendered, or `undefined` for a method other than GET and HEAD and for a file. */
	request(request: Request): Promise<Response | undefined>;
}

/** One ask's place in the record, filled when its answer arrives. */
interface Slot {
	answer?: Recorded;
}

interface Made {
	readonly status: number;
	readonly html: string;
}

const FAILED = Symbol('failed');
const LATE = Symbol('late');

// Over 2^31 - 1 milliseconds Node fires a timer after one millisecond instead.
const MAX_TIMER = 2_147_483_647;

type Call = (args: unknown, context: unknown, tools: { progress(value: unknown): void }) => unknown;

const callOf = (instance: unknown): Call | undefined => {
	if (instance === null || typeof instance !== 'object') return undefined;
	const call: unknown = (instance as { call?: unknown }).call;
	return typeof call === 'function' ? call as Call : undefined;
};

/** Thrown on purpose, in the stack's shape: a reason a caller can branch on, which crosses whole. */
const isRefusal = (error: unknown): error is { reason: string } =>
	error !== null && typeof error === 'object' && typeof (error as { reason?: unknown }).reason === 'string';

const isReason = (value: unknown): value is { code: string; message: string } => {
	const held = value as { code?: unknown; message?: unknown } | null;
	return held !== null && typeof held === 'object' && typeof held.code === 'string' && typeof held.message === 'string';
};

/** A refusal as the socket would carry it to the page. */
const frameOf = (error: { reason: string }): Refused => {
	const held = error as { reason: string; message?: unknown; reasons?: unknown };
	const message = String(held.message ?? held.reason);
	const reasons = Array.isArray(held.reasons) ? held.reasons.filter(isReason) : [];
	return reasons.length === 0 ? { reason: held.reason, message } : { reason: held.reason, message, reasons };
};

const refuse = (detail: string, fix: string): Error => codecError('invalid-config', `createPages was given ${detail}`, fix);

/** A refusal the server raises itself, made the way the server makes it so its words are the same. */
const gated = (name: string, reasons: readonly unknown[]): Refused => frameOf(Object.assign(
	codecError('refused', `${name} refused the call`, 'Sign in, or ask for something the gate allows.'),
	{ reasons: reasons.filter(isReason) },
));

/**
 * Make the server module that renders the application's page for every page request.
 *
 * Params:
 *   page: builds the page from a router and a client, as the browser entry does
 *   gate: the gate the server runs. A render's visitor is whoever it says a request for the
 *         page's path with no query and no headers is, and a module it refuses that visitor is
 *         refused in the render too
 *   modules: the modules a page may ask while it renders, keyed by the name it asks, each with
 *            a `call`
 *   dir: the directory the bundler wrote, `dist` by default. Its `index.html` is the shell
 *   renders: renders at once, 16 by default
 *   timeoutMs: milliseconds per render, 10 000 by default
 *
 * Returns: the module, `{ public: true, request }`. Return it from a module's factory. Its hook
 * declines a method other than GET and HEAD and a path naming a file in `dir`, and answers
 * everything else: the page with the answers its reads were given, at the status the page asked
 * for with `<Meta httpEquiv="status" content="404" />`, else 404 when a stage shows its fallback
 * or nothing, else 200. A read that failed, a page that waited on a document it shared, a render
 * past `timeoutMs` and a request past `renders` are answered with the shell, 503, which mounts
 * live in a browser.
 *
 * Throws: `no-shell` when `dir` holds no `index.html`, `shell-head` and `shell-body` for a shell
 * that cannot hold a page, and `invalid-config` for an option of the wrong kind or a module with
 * no `call`, all when the module is made rather than on the first request. A render throws what
 * the page threw, and `bad-status` for a status meta that is not 200 or from 400 to 599. The
 * server reports both and answers 500.
 *
 * Example:
 *   // modules/site/Pages.ts
 *   export const deps = ['auth/Gate', 'posts/List'];
 *   export default ({ imports }) => createPages({
 *     page: (router, client) => h(Site, { router, client }),
 *     gate: imports.Gate,
 *     modules: { 'posts/List': imports.List },
 *   });
 */
export const createPages = (options: PagesOptions): Pages => {
	const { page, gate, modules } = options;
	if (typeof page !== 'function') {
		throw refuse(`page ${typeof page}`, 'Pass page, the function that builds the page from a router and a client.');
	}
	if (gate === null || typeof gate !== 'object' || typeof gate.identify !== 'function' || typeof gate.access !== 'function') {
		throw refuse('a gate with no identify and access', 'Pass the gate the server runs: open, or the auth/Gate instance named in deps.');
	}
	if (modules === null || typeof modules !== 'object' || Array.isArray(modules)) {
		throw refuse(`modules ${JSON.stringify(modules)}`, 'Pass modules, an object holding each module a page may ask under the name it asks by.');
	}
	// Read once. A name handed no module with a `call` is a mistake, most often an import spelled
	// differently from `deps`, which reads as undefined. Refused here, it does not become a page
	// answered with a refusal where its data should be.
	const handed = new Map<string, { readonly instance: object; readonly call: Call }>();
	for (const [name, instance] of Object.entries(modules)) {
		const call = callOf(instance);
		if (call === undefined) {
			throw refuse(`modules[${JSON.stringify(name)}] with no call`,
				'Pass each module from imports, as its factory returned it. One that is undefined is spelled differently from its name in deps.');
		}
		handed.set(name, { instance: instance as object, call });
	}
	const renders = options.renders ?? 16;
	if (!Number.isInteger(renders) || renders < 1) {
		throw refuse(`renders ${JSON.stringify(renders)}`, 'Set renders to a whole number of renders at once, 1 or more.');
	}
	const timeoutMs = options.timeoutMs ?? 10_000;
	if (typeof timeoutMs !== 'number' || !(timeoutMs > 0) || timeoutMs > MAX_TIMER) {
		throw refuse(`timeoutMs ${JSON.stringify(timeoutMs)}`, 'Set timeoutMs to a positive number of milliseconds, at most 2147483647.');
	}

	// Resolved once, from the working directory, as `static/Files` resolves the same directory.
	const dir = resolve(options.dir ?? 'dist');
	let shell: string;
	try {
		shell = readFileSync(join(dir, 'index.html'), 'utf8');
	} catch {
		throw codecError('no-shell', `${join(dir, 'index.html')} could not be read`,
			'Build the page first, so dir holds the index.html the bundler writes, or point dir at the directory it wrote.');
	}
	// A shell that cannot hold a page is a build mistake, refused at boot rather than on every request.
	buildDocument(shell, { body: '', css: '', head: '', title: null });

	/** Whether a path names a file in `dir`, by `static/Files`' rule: no dot segment is ever a file. */
	const isFile = async (pathname: string): Promise<boolean> => {
		let path: string;
		try {
			path = decodeURIComponent(pathname);
		} catch {
			return false;
		}
		const segments = path.split('/').filter((segment) => segment !== '');
		if (segments.length === 0 || segments.some((segment) => segment.startsWith('.'))) return false;
		try {
			return (await stat(join(dir, ...segments))).isFile();
		} catch {
			return false;
		}
	};

	const renderAt = async (url: URL): Promise<Made | typeof FAILED> => {
		const path = `${url.pathname}${url.search}`;
		const asked = new Map<string, Slot[]>();
		let failed = false;

		// The visitor nobody knows: the page's path, with no query, no headers and no address, since
		// a gate may read identity from any of them. Asked once, at the first ask, so a page that
		// reads nothing costs the gate nothing.
		let identified: Promise<Identified<unknown>> | undefined;
		const identity = (): Promise<Identified<unknown>> =>
			(identified ??= Promise.resolve().then(() => gate.identify(new Request(`${url.origin}${url.pathname}`), { address: undefined })));

		/** A read that failed: the operator hears why, and the page hears what a browser would. */
		const fail = (name: string, error: unknown): Error => {
			failed = true;
			console.error(`${name}: a read failed while ${path} was rendered, so the shell answered it`, error);
			return crossed('failed', 'the call failed');
		};

		const answer = async (name: string, args: unknown, slot: Slot, progress?: (value: unknown) => void): Promise<unknown> => {
			const refused = (error: Refused): never => {
				slot.answer = { error };
				throw crossed(error.reason, error.message, error.reasons);
			};
			const held = handed.get(name);
			if (held === undefined) {
				failed = true;
				const error = codecError('not-handed', `${path} asked ${name} while it rendered, and createPages was not handed it`,
					'Hand the module to createPages in modules, under the name the page asks it by.');
				console.error(error);
				throw error;
			}
			const { instance, call } = held;

			// Worded as the server words it, so the page reads the refusal a browser would have
			// been answered with.
			let allowed: { readonly context: unknown } | Refused;
			try {
				const who = await identity();
				if ('refused' in who) {
					allowed = gated(name, who.refused);
				} else {
					const reasons = await gate.access({ name, instance }, who.context);
					allowed = reasons.length > 0 ? gated(name, reasons) : { context: who.context };
				}
			} catch (error) {
				throw fail(name, error);
			}
			if (!('context' in allowed)) return refused(allowed);

			let result: unknown;
			let answered = false;
			try {
				result = await call.call(instance, args, allowed.context, {
					// The socket carries nothing after the answer, and a page's handler that throws
					// is the page's own error: told to the operator, and the read goes on, as it
					// would in a browser.
					progress: (value) => {
						if (answered || progress === undefined) return;
						try {
							progress(value === undefined ? null : value);
						} catch (error) {
							console.error(`${name}: a progress handler threw while ${path} was rendered`, error);
						}
					},
				});
			} catch (error) {
				if (isRefusal(error)) return refused(frameOf(error));
				throw fail(name, error);
			} finally {
				answered = true;
			}
			let text: string | undefined;
			try {
				text = JSON.stringify(result === undefined ? null : result);
			} catch (error) {
				return refused({ reason: 'not-data', message: `${name}: the result could not be encoded: ${String((error as Error).message)}` });
			}
			// Parsed twice, so a page that edits what it was handed cannot edit what it recorded.
			slot.answer = { result: text === undefined ? null : JSON.parse(text) as unknown };
			return text === undefined ? null : JSON.parse(text) as unknown;
		};

		const client: Client = {
			status: immutable<ClientStatus>('open'),
			ask: (name, args, askOptions) => {
				let sent: unknown;
				try {
					sent = throughJson(args);
				} catch (error) {
					return Promise.reject(codecError('not-data', `${name}: the arguments could not be encoded: ${String((error as Error).message)}`,
						'Send arguments JSON.stringify can carry.'));
				}
				// The place is taken now, so the record keeps the order the asks were made in,
				// which is the order the browser will make them in.
				const slot: Slot = {};
				const key = askKey(name, sent);
				const slots = asked.get(key);
				if (slots === undefined) asked.set(key, [slot]);
				else slots.push(slot);
				return answer(name, sent, slot, askOptions?.progress);
			},
			// A render has no link. A shared document has not arrived when a browser first renders
			// either, so a page that renders its waiting state from `document` hydrates. `ready`
			// rejects rather than never settling, so a page that waits on it ends its render and
			// gives its place back. It is handled here, so a page that never waits leaves no
			// unhandled rejection behind.
			share: <T extends object>(name: string): Handle<T> => {
				const ready = Promise.reject(codecError('not-shared', `${path} shared ${name} while it rendered, and a render has no link`,
					'Render the waiting state from handle.document, as a browser shows it until the document arrives. A page that waits on ready is answered with the shell.')) as Promise<T>;
				ready.catch(() => {});
				return { document: undefined, ready, stop: () => {} };
			},
			reconnect: () => {},
			close: () => {},
		};

		const own = context();
		let body: string;
		try {
			body = await render(page(createRouter({ url: path }), client), { context: own });
		} catch (error) {
			// A loader rejected with nothing to show it (design 306). After a failed read, or a
			// share the render cannot make, that is a page the render could not write, and the
			// shell answers it. Anything else is the page's own defect, which the server reports.
			if (failed || (error as { reason?: unknown } | null)?.reason === 'not-shared') return FAILED;
			throw error;
		}
		if (failed) return FAILED;

		const status = statusOf(own.head) ?? (emptyStage(own) === null ? 200 : 404);
		const recorded: Record<string, Recorded[]> = {};
		let any = false;
		for (const [key, slots] of asked) {
			// An ask still waiting when the render ended recorded nothing: the browser asks it.
			const done = slots.flatMap((slot) => (slot.answer === undefined ? [] : [slot.answer]));
			if (done.length === 0) continue;
			recorded[key] = done;
			any = true;
		}
		const html = buildDocument(shell, {
			body, css: own.theme.markup(), head: own.head.markup(), title: own.head.title(),
			...(any ? { answers: JSON.stringify(recorded) } : {}),
		});
		return { status, html };
	};

	const answered = (request: Request, status: number, html: string): Response =>
		new Response(request.method === 'HEAD' ? null : html, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });

	let running = 0;

	return {
		public: true,
		request: async (request) => {
			if (request.method !== 'GET' && request.method !== 'HEAD') return undefined;
			const url = new URL(request.url);
			if (await isFile(url.pathname)) return undefined;
			if (running >= renders) return answered(request, 503, shell);

			running += 1;
			const making = renderAt(url);
			// The place is held until the render itself ends, not when the time limit answers for
			// it: it is still running, and a render that never ends keeps its place for good.
			const release = (): void => { running -= 1; };
			making.then(release, release);
			let timer: ReturnType<typeof setTimeout> | undefined;
			const late = new Promise<typeof LATE>((done) => { timer = setTimeout(() => { done(LATE); }, timeoutMs); });
			let made: Made | typeof FAILED | typeof LATE;
			try {
				made = await Promise.race([making, late]);
			} finally {
				clearTimeout(timer);
			}
			if (made === LATE || made === FAILED) return answered(request, 503, shell);
			return answered(request, made.status, made.html);
		},
	};
};
