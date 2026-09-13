// The suite a server passes rather than claims (design 271).
//
// Each check is one named obligation citing the ASVS 5.0 requirements it proves, run against a
// server the caller starts, so an application that boots its own modules behind the same server
// proves the same things about itself. The session routes are spoken by their documented shape
// (`POST` and `DELETE /api/session`, as `@aweftjs/auth` answers them) and no battery is imported
// here: what is behind `start` is the caller's.
//
// Append-only. A case is added for every hole ever found and none is removed.

import assert from 'node:assert/strict';

import type { Commit } from '@aweftjs/codec';
import { createObject } from '@aweftjs/core';
import { fromBundle } from '@aweftjs/modules';
import type { ModuleProps, Source } from '@aweftjs/modules';
import type { Connection, Gate, Named, Server } from '@aweftjs/server';
import type { Link, Refused, Requests } from '@aweftjs/sync';

import { settle } from './settle.ts';

/** A connection the target opened: the socket, the link and the call channel over it. */
export interface Opened {
	readonly socket: { readonly readyState: number; send(data: string | Uint8Array): void; close(): void };
	readonly link: Link;
	readonly asks: Requests;
}

/** A started application the suite runs against. `loadServer` answers this shape as it is. */
export interface SecurityTarget {
	/**
	 * An HTTP request as a listener would deliver it: a path on the target's own origin, or a
	 * full URL whose scheme says how the request arrived.
	 */
	fetch(path: string, init?: RequestInit): Promise<Response>;
	/** A socket connection through the handshake. Throws when the gate refuses it, carrying `status`. */
	open(options?: { readonly headers?: Record<string, string> | undefined; readonly url?: string | undefined }): Promise<Opened>;
	/** The server itself, for the one case that grants an administrator from inside the process. */
	readonly server: Server;
	stop(): Promise<void>;
}

/**
 * What the suite hands `start`: its own probe modules, the gate the target must run under, and
 * where the server reports a module that broke.
 */
export interface StartOptions {
	readonly sources: readonly Source[];
	readonly gate: Gate | string;
	readonly handlers: { failed(name: string, error: unknown): void };
}

/**
 * The caller's boot. It loads the sources given beside its own (a store declaring the auth
 * paths, and a session battery answering the auth routes), starts under the gate given, and
 * hands the server the handlers given, so a module the suite breaks on purpose is reported to
 * the suite rather than raised where nothing catches it.
 */
export type StartTarget = (options: StartOptions) => Promise<SecurityTarget>;

/** One named obligation a server has to meet, and the requirements it proves. */
export interface SecurityCheck {
	readonly name: string;
	/** The ASVS 5.0 requirement ids this case proves. */
	readonly requirements: readonly string[];
	run(start: StartTarget): Promise<void>;
}

const PASSWORD = 'correct horse battery staple';

const userOf = (context: unknown): string | null => {
	const user: unknown = (context as { user?: unknown } | null)?.user;
	return typeof user === 'string' ? user : null;
};

const json = (body: unknown, status = 200): Response =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const reasonOf = (error: unknown): string => String((error as { reason?: unknown } | null)?.reason);
const statusOf = (error: unknown): number | undefined => (error as { status?: number } | null)?.status;
const codesOf = async (response: Response): Promise<string[]> =>
	((await response.json()) as { reasons?: { code: string }[] }).reasons?.map((r) => r.code) ?? [];

const failsWith = async (reason: string, what: string, run: () => Promise<unknown>): Promise<unknown> => {
	try {
		await run();
	} catch (error) {
		assert.equal(reasonOf(error), reason, `${what}: expected ${reason}, got ${reasonOf(error)} (${String((error as Error).message)})`);
		return error;
	}
	assert.fail(`${what}: expected ${reason}, and it answered`);
};

/** The probe modules: what the suite reaches for on the far side, shipped with it. */
const probes = (): Source => fromBundle({
	'./probe/Public.ts': {
		default: () => ({
			public: true,
			call: (args: unknown, context: unknown) => ({ echo: args, user: userOf(context) }),
			routes: { 'GET /probe/public': (_request: Request, context: unknown) => json({ user: userOf(context) }) },
		}),
	},
	'./probe/Private.ts': {
		default: () => {
			// One document per connection, owned by whoever the gate said; `locked` is the slot the
			// module keeps for itself.
			const docs = new WeakMap<object, Record<string, unknown>>();
			return {
				call: (args: unknown, context: unknown) => ({ echo: args, user: userOf(context), locked: docs.get(context as object)?.locked }),
				routes: { 'GET /probe/private': (_request: Request, context: unknown) => json({ user: userOf(context) }) },
				connection: ({ link, context, request }: Connection) => {
					const doc = createObject<Record<string, unknown>>({ owner: userOf(context), locked: 'keep' });
					docs.set(context as object, doc);
					link.share('private', doc, {
						accept: (commit: Commit) => commit.deltas.some((d) => d.ref.kind === 'object' && d.ref.key === 'locked')
							? [{ code: 'locked', message: 'locked is not yours to write' }]
							: [],
					});
					// The one hole this suite has to prove is closed: a share that names nobody who may
					// write. Only a handshake that asks for it, so every other case keeps its connection.
					if (request.headers.get('x-careless') === '1') {
						(link as unknown as { share(name: string, doc: object, handlers: object): unknown }).share('careless', createObject({}), {});
					}
				},
			};
		},
	},
	'./probe/Throws.ts': {
		default: () => ({
			public: true,
			call: () => { throw new TypeError('secret detail: /srv/app/users.json'); },
			routes: { 'GET /probe/throws': () => { throw new Error('secret detail: /srv/app/users.json'); } },
		}),
	},
	// Who is an administrator, held where no client can reach it: no call, no share, no route.
	'./probe/Admins.ts': {
		default: () => {
			const ids = new Set<string>();
			return { has: (id: string | null) => id !== null && ids.has(id), grant: (id: string) => { ids.add(id); } };
		},
	},
	// Marked with a word of the suite's own, not `admin`: an application's gate that reads the
	// word the docs suggest must not see this module as one of its own reserved ones, or the
	// grant made from inside the process would still be refused by that gate.
	'./probe/Admin.ts': { default: () => ({ probeReserved: true, call: () => 'admin only' }) },
});

interface Admins { has(id: string | null): boolean; grant(id: string): void }

/** The caller's gate with one rule composed on top: a module the suite marks reserved is for an administrator. */
const composed = (gate: Gate | string): Source => {
	const wrap = (inner: Gate, admins: Admins): Gate => ({
		identify: (request, peer) => inner.identify(request, peer),
		access: async (module: Named, context: unknown) => {
			const reasons = await inner.access(module, context);
			if (reasons.length > 0) return reasons;
			const reserved = module.instance !== null && typeof module.instance === 'object' && (module.instance as { probeReserved?: unknown }).probeReserved === true;
			return reserved && !admins.has(userOf(context)) ? [{ code: 'not-admin', message: `${module.name} is for an administrator` }] : [];
		},
	});
	const admins = ({ imports }: ModuleProps): Admins => imports.Admins as Admins;
	return fromBundle({
		'./probe/Gate.ts': typeof gate === 'string'
			? { deps: [gate, 'probe/Admins'], default: (props: ModuleProps) => wrap(props.imports[gate.slice(gate.lastIndexOf('/') + 1)] as Gate, admins(props)) }
			: { deps: ['probe/Admins'], default: (props: ModuleProps) => wrap(gate, admins(props)) },
	});
};

const jsonInit = (body: unknown, headers: Record<string, string> = {}): RequestInit =>
	({ method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

const enter = (target: SecurityTarget, email: string, password = PASSWORD, headers: Record<string, string> = {}, url = '/api/session'): Promise<Response> =>
	target.fetch(url, jsonInit({ email, password }, headers));

interface SignedUp { readonly cookie: string; readonly set: string; readonly user: string }

const signUp = async (target: SecurityTarget, email: string): Promise<SignedUp> => {
	const answer = await enter(target, email);
	assert.equal(answer.status, 201, `POST /api/session answered ${String(answer.status)} for a new email: the target needs a session battery answering the auth routes`);
	const set = answer.headers.getSetCookie()[0];
	assert.ok(set !== undefined, 'the answer carries Set-Cookie');
	const { user } = (await answer.json()) as { user: string };
	return { cookie: set.split(';')[0]!, set, user };
};

interface Started extends SecurityTarget {
	/** What the server reported, as `name: message`. */
	readonly reported: string[];
}

const started = async (start: StartTarget, gate: Gate | string): Promise<Started> => {
	const reported: string[] = [];
	const target = await start({
		sources: [probes(), composed(gate)],
		gate: 'probe/Gate',
		handlers: { failed: (name, error) => { reported.push(`${name}: ${String((error as Error).message ?? error)}`); } },
	});
	// Called through rather than spread, so a target whose methods live on a prototype keeps them.
	return {
		fetch: (path, init) => target.fetch(path, init),
		open: (options) => target.open(options),
		server: target.server,
		stop: () => target.stop(),
		reported,
	};
};

const checks = (gate: Gate | string): SecurityCheck[] => [
	{
		name: 'a private module refuses an anonymous call, share and route, and a public one answers',
		requirements: ['V8.3.1', 'V8.2.2'],
		run: async (start) => {
			const target = await started(start, gate);
			try {
				const page = await target.open();
				assert.deepEqual(await page.asks.ask('probe/Public', 1), { echo: 1, user: null });
				await failsWith('refused', 'an anonymous ask of a private module', () => page.asks.ask('probe/Private'));
				const handle = page.link.share('private');
				await settle();
				assert.equal(handle.document, undefined, 'the private share was never offered to an anonymous connection');
				handle.stop();
				assert.equal((await target.fetch('/probe/public')).status, 200);
				assert.equal((await target.fetch('/probe/private')).status, 403);
				page.socket.close();
			} finally {
				await target.stop();
			}
		},
	},
	{
		name: 'the context a module sees is the gate\'s word and never the client\'s',
		requirements: ['V8.3.1'],
		run: async (start) => {
			const target = await started(start, gate);
			try {
				const ada = await signUp(target, 'ada@example.test');
				const forged = { 'x-user': 'someone-else', 'x-context': '{"user":"someone-else"}' };
				const page = await target.open({ headers: { cookie: ada.cookie, ...forged } });
				const heard = (await page.asks.ask('probe/Private', { user: 'someone-else', context: { user: 'someone-else' } })) as { user: string };
				assert.equal(heard.user, ada.user, 'the argument named another user and the context did not move');
				page.socket.close();
				const route = await target.fetch('/probe/private?user=someone-else', { headers: { cookie: ada.cookie, ...forged } });
				assert.deepEqual(await route.json(), { user: ada.user });
				assert.equal((await target.fetch('/probe/private', { headers: forged })).status, 403, 'headers alone are nobody');
			} finally {
				await target.stop();
			}
		},
	},
	{
		name: 'one user reaches nothing of another\'s',
		requirements: ['V8.2.2'],
		run: async (start) => {
			const target = await started(start, gate);
			try {
				const ada = await signUp(target, 'ada@example.test');
				const bo = await signUp(target, 'bo@example.test');
				const adaPage = await target.open({ headers: { cookie: ada.cookie } });
				const adaDoc = await adaPage.link.share<Record<string, unknown>>('private').ready;
				assert.equal(adaDoc.owner, ada.user);
				adaDoc.mine = 'written by ada';
				await settle();
				const boPage = await target.open({ headers: { cookie: bo.cookie } });
				const boDoc = await boPage.link.share<Record<string, unknown>>('private').ready;
				assert.equal(boDoc.owner, bo.user, 'the module picked the document by the gate\'s word');
				assert.equal(boDoc.mine, undefined, 'and nothing of ada\'s is in it');
				adaPage.socket.close();
				boPage.socket.close();
			} finally {
				await target.stop();
			}
		},
	},
	{
		name: 'a module reserved for an administrator refuses a signed-in user whatever they write, and the document the gate reads is out of their reach',
		requirements: ['V8.2.3', 'V8.2.1'],
		run: async (start) => {
			const target = await started(start, gate);
			try {
				const ada = await signUp(target, 'ada@example.test');
				const page = await target.open({ headers: { cookie: ada.cookie } });
				await failsWith('refused', 'a user asking the administrator\'s module', () => page.asks.ask('probe/Admin'));
				await failsWith('missing', 'a user asking the module that holds who is an administrator', () => page.asks.ask('probe/Admins', { grant: ada.user }));
				const admins = page.link.share('admins');
				await settle();
				assert.equal(admins.document, undefined, 'no share by that name is offered');
				admins.stop();
				const own = await page.link.share<Record<string, unknown>>('private').ready;
				own.role = 'admin';
				own.admin = true;
				await settle();
				await failsWith('refused', 'the same ask after writing role into the user\'s own document', () => page.asks.ask('probe/Admin'));
				// The one way in is from inside the process, which is where an application grants it.
				(target.server.loader.get('probe/Admins') as Admins).grant(ada.user);
				assert.equal(await page.asks.ask('probe/Admin'), 'admin only');
				page.socket.close();
			} finally {
				await target.stop();
			}
		},
	},
	{
		name: 'a commit the module refuses is reported at the client with its undo, and the server\'s copy is unchanged',
		requirements: ['V2.2.2'],
		run: async (start) => {
			const target = await started(start, gate);
			try {
				const ada = await signUp(target, 'ada@example.test');
				const page = await target.open({ headers: { cookie: ada.cookie } });
				const refusals: Refused[] = [];
				const doc = await page.link.share<Record<string, unknown>>('private', undefined, { refused: (report) => { refusals.push(report); } }).ready;
				doc.locked = 'mine now';
				await settle();
				assert.equal(refusals.length, 1, 'the write was refused');
				assert.deepEqual(refusals[0]!.reasons.map((r) => r.code), ['locked']);
				assert.ok(refusals[0]!.undo !== undefined, 'with the commit that takes it back');
				const held = (await page.asks.ask('probe/Private')) as { locked: unknown };
				assert.equal(held.locked, 'keep', 'the server\'s copy never changed');
				page.socket.close();
			} finally {
				await target.stop();
			}
		},
	},
	{
		name: 'the session cookie is HttpOnly, SameSite and Secure over TLS',
		requirements: ['V3.3.2', 'V3.3.4'],
		run: async (start) => {
			const target = await started(start, gate);
			try {
				const plain = await signUp(target, 'ada@example.test');
				assert.match(plain.set, /;\s*HttpOnly(;|$)/i, `HttpOnly on ${plain.set}`);
				assert.match(plain.set, /;\s*SameSite=(Lax|Strict)(;|$)/i, `SameSite on ${plain.set}`);
				assert.match(plain.set, /;\s*Path=\/(;|$)/i, `Path=/ on ${plain.set}`);
				assert.doesNotMatch(plain.set, /;\s*Secure(;|$)/i, 'not Secure over plain HTTP, or the browser drops it');
				const tls = await enter(target, 'bo@example.test', PASSWORD, {}, 'https://app.test/api/session');
				assert.equal(tls.status, 201);
				assert.match(tls.headers.getSetCookie()[0] ?? '', /;\s*Secure(;|$)/i, 'Secure over TLS');
			} finally {
				await target.stop();
			}
		},
	},
	{
		name: 'every sign-in mints a new token of at least 128 bits, never repeated',
		requirements: ['V7.2.2', 'V7.2.3', 'V7.2.4', 'V11.5.1'],
		run: async (start) => {
			const target = await started(start, gate);
			try {
				const tokens = new Set<string>();
				const first = await signUp(target, 'ada@example.test');
				tokens.add(first.cookie.split('=')[1]!);
				for (let i = 0; i < 4; i++) {
					const again = await enter(target, 'ada@example.test');
					assert.equal(again.status, 200, 'signing in again');
					tokens.add(again.headers.getSetCookie()[0]!.split(';')[0]!.split('=')[1]!);
				}
				assert.equal(tokens.size, 5, 'five sign-ins, five tokens');
				for (const token of tokens) {
					// Twenty-two base64url characters carry 132 bits; twenty-one carry 126.
					assert.match(token, /^[A-Za-z0-9_.~-]{22,}$/, `${token}: at least 128 bits of the cookie alphabet`);
				}
			} finally {
				await target.stop();
			}
		},
	},
	{
		name: 'after sign-out the old token is anonymous at the next handshake and the next request',
		requirements: ['V7.4.1'],
		run: async (start) => {
			const target = await started(start, gate);
			try {
				const ada = await signUp(target, 'ada@example.test');
				assert.equal((await target.fetch('/probe/private', { headers: { cookie: ada.cookie } })).status, 200, 'signed in');
				const out = await target.fetch('/api/session', { method: 'DELETE', headers: { cookie: ada.cookie } });
				assert.equal(out.status, 200);
				assert.match(out.headers.getSetCookie()[0] ?? '', /Max-Age=0/, 'the cookie is cleared');
				assert.equal((await target.fetch('/probe/private', { headers: { cookie: ada.cookie } })).status, 403, 'the old token on a request');
				const page = await target.open({ headers: { cookie: ada.cookie } });
				await failsWith('refused', 'the old token on a handshake', () => page.asks.ask('probe/Private'));
				page.socket.close();
			} finally {
				await target.stop();
			}
		},
	},
	{
		name: 'a foreign Origin is refused on a state-changing request and at the handshake, and passes on a read',
		requirements: ['V3.5.1', 'V4.4.2'],
		run: async (start) => {
			const target = await started(start, gate);
			try {
				const foreign = { origin: 'https://evil.test' };
				const posted = await enter(target, 'ada@example.test', PASSWORD, foreign);
				assert.equal(posted.status, 403);
				assert.deepEqual(await codesOf(posted), ['origin']);
				const refused = await target.open({ headers: foreign }).then(() => undefined, (error: unknown) => error);
				assert.equal(statusOf(refused), 403, 'the handshake from another origin');
				assert.equal((await target.fetch('/probe/public', { headers: foreign })).status, 200, 'a read passes');
			} finally {
				await target.stop();
			}
		},
	},
	{
		name: 'more requests than the window allows from one address are 429 with Retry-After, and so is the handshake',
		requirements: ['V2.4.1'],
		run: async (start) => {
			const target = await started(start, gate);
			try {
				let over: Response | undefined;
				for (let i = 0; i < 601 && over === undefined; i++) {
					const answer = await target.fetch('/probe/public');
					if (answer.status === 429) over = answer;
				}
				assert.ok(over !== undefined, 'inside 601 requests from one address, one was 429');
				assert.match(over.headers.get('retry-after') ?? '', /^\d+$/, 'Retry-After in seconds');
				assert.deepEqual(await codesOf(over), ['limit']);
				const refused = await target.open().then(() => undefined, (error: unknown) => error);
				assert.equal(statusOf(refused), 429, 'the handshake counts with the requests');
			} finally {
				await target.stop();
			}
		},
	},
	{
		name: 'attempts on one email and from one address are counted, and hashing in flight is bounded',
		requirements: ['V6.3.1', 'V15.2.2'],
		run: async (start) => {
			const target = await started(start, gate);
			try {
				await signUp(target, 'ada@example.test');
				for (let i = 0; i < 5; i++) assert.equal((await enter(target, 'ada@example.test', 'wrong horse battery')).status, 401, `wrong password ${String(i + 1)}`);
				const locked = await enter(target, 'ada@example.test');
				assert.equal(locked.status, 429, 'the right password after five wrong ones in the window');
				assert.match(locked.headers.get('retry-after') ?? '', /^\d+$/);
				assert.deepEqual(await codesOf(locked), ['attempts']);
				let byAddress: Response | undefined;
				for (let i = 0; i < 20 && byAddress === undefined; i++) {
					const answer = await enter(target, `u${String(i)}@example.test`);
					if (answer.status === 429) byAddress = answer;
				}
				assert.ok(byAddress !== undefined, 'the address is counted across emails');
			} finally {
				await target.stop();
			}
			const fresh = await started(start, gate);
			try {
				const burst = await Promise.all(Array.from({ length: 64 }, (_, i) => enter(fresh, `burst${String(i)}@example.test`)));
				const statuses = burst.map((a) => a.status);
				assert.ok(statuses.every((s) => s === 201 || s === 503 || s === 429), `every answer is a sign-up, busy or counted: ${statuses.join(' ')}`);
				assert.ok(statuses.includes(201), 'some were hashed');
				assert.ok(statuses.includes(503), 'some were refused rather than hashed');
				for (const answer of burst) if (answer.status === 503) assert.match(answer.headers.get('retry-after') ?? '', /^\d+$/, 'a busy answer says when');
			} finally {
				await fresh.stop();
			}
		},
	},
	{
		name: 'a password shorter than eight or longer than the ceiling is refused, and any composition of eight is taken',
		requirements: ['V6.2.1', 'V6.2.5', 'V6.2.9'],
		run: async (start) => {
			const target = await started(start, gate);
			try {
				const short = await enter(target, 'ada@example.test', 'seven77');
				assert.equal(short.status, 400);
				assert.deepEqual(await codesOf(short), ['password']);
				assert.equal((await enter(target, 'ada@example.test', 'x'.repeat(1025))).status, 400, 'a kilobyte and more is refused');
				assert.equal((await enter(target, 'bo@example.test', '        ')).status, 201, 'eight spaces');
				assert.equal((await enter(target, 'cy@example.test', 'a'.repeat(64))).status, 201, 'sixty-four');
			} finally {
				await target.stop();
			}
		},
	},
	{
		name: 'a route that throws answers a bare 500, and a call that throws answers failed with nothing of the error',
		requirements: ['V16.5.1'],
		run: async (start) => {
			const target = await started(start, gate);
			try {
				const route = await target.fetch('/probe/throws');
				assert.equal(route.status, 500);
				assert.equal(await route.text(), '');
				const page = await target.open();
				const error = await failsWith('failed', 'a call that threw', () => page.asks.ask('probe/Throws'));
				const message = String((error as Error).message);
				assert.ok(!message.includes('secret') && !message.includes('/srv'), `nothing of the error crossed: ${message}`);
				assert.deepEqual(target.reported, ['probe/Throws: secret detail: /srv/app/users.json', 'probe/Throws: secret detail: /srv/app/users.json'], 'both reached the operator');
				page.socket.close();
			} finally {
				await target.stop();
			}
		},
	},
	{
		name: 'bytes that are not a frame end the link and the server goes on answering',
		requirements: ['V16.5.3'],
		run: async (start) => {
			const target = await started(start, gate);
			try {
				const page = await target.open();
				page.socket.send(new Uint8Array([0xff, 0xfe, 0xfd, 0x00]));
				await settle();
				assert.equal(page.socket.readyState, 3, 'the socket closed');
				const again = await target.open();
				assert.deepEqual(await again.asks.ask('probe/Public', 'still here'), { echo: 'still here', user: null });
				again.socket.close();
			} finally {
				await target.stop();
			}
		},
	},
	{
		name: 'a share without accept never opens',
		requirements: ['V8.3.1'],
		run: async (start) => {
			const target = await started(start, gate);
			try {
				const ada = await signUp(target, 'ada@example.test');
				const page = await target.open({ headers: { cookie: ada.cookie, 'x-careless': '1' } });
				const careless = page.link.share('careless');
				await settle();
				assert.equal(careless.document, undefined, 'nothing crossed under that name');
				assert.equal(page.socket.readyState, 3, 'the connection ended rather than carry a writable share');
				assert.ok(target.reported.some((line) => line.startsWith('probe/Private: no-accept')), `the operator was told: ${target.reported.join(' | ')}`);
				careless.stop();
			} finally {
				await target.stop();
			}
		},
	},
];

/**
 * Every security obligation a server has, each citing the ASVS 5.0 requirements it proves.
 *
 * Params:
 *   options.gate: the gate the target runs under, a `Gate` or the name of a module that is one;
 *     the suite composes one rule of its own on top and starts the target under that
 *
 * Returns: the checks, each named, each taking `start`: the caller's boot, which loads the
 * sources given beside its own store and session battery, starts under the gate given with the
 * handlers given, and answers `{ fetch, open, server, stop }`. `loadServer` answers that shape,
 * so over the harness a case is one line.
 *
 * Throws: each check's `run` throws an assertion naming what the target did instead. A target
 * with no session battery fails the session cases at the first sign-up, naming that.
 *
 * Example:
 *   for (const c of securityChecks({ gate: 'auth/Gate' })) {
 *     test(`${c.requirements.join(' ')}: ${c.name}`, () => c.run((given) => loadServer({
 *       ...given, sources: [auth, ...given.sources], store: newStore(),
 *     })));
 *   }
 */
export const securityChecks = (options: { readonly gate: Gate | string }): SecurityCheck[] => checks(options.gate);
