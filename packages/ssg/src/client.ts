// The browser half: three functions, and nothing that reads a disk (design 151).
//
// Its own subpath, and the only values it imports are `ui`'s `mount` and `hydrate` and the two
// `dom` needs to read an item, so a page bundle that reaches for it carries the walk, the
// document builder and `node:fs` nowhere. `languageOf` reads the language the site wrote on the
// page back, by the one prefix rule the site wrote it with (design 279). `replay` gives a client
// the answers a render on request wrote into the page (design 304).

import type { Client, ShareHandlers } from '@aweftjs/client';
import { codecError } from '@aweftjs/codec';
import { type ParentLike, type Remove, h, isComponentCall } from '@aweftjs/dom';
import { type Render, hydrate, mount } from '@aweftjs/ui';

// The only files this half imports besides `ui`: one string, and the key and error both halves
// share. Nothing in either reads a disk, so a page bundle carries no Node module through here.
import { ANSWERS, type Recorded, askKey, crossed, throughJson } from './answers.ts';
import { STAMP } from './stamp.ts';

/**
 * What `replay` reads the answers off: the page's document, or anything that finds a script by id.
 * `dom`'s light document finds nothing by id, so a test in Node hands in an object of its own.
 */
export interface AnswerSource {
	getElementById(id: string): { readonly textContent?: string | null } | null;
}

// The answers each document's clients still hold, so the hydration that settles can drop them.
// Keyed by the document, never one list for the process, so two documents keep their own.
const holding = new WeakMap<object, Set<Map<string, Recorded[]>>>();

const pageDocument = (): AnswerSource | undefined => (globalThis as { document?: AnswerSource }).document;

const isRecorded = (value: unknown): value is Recorded => {
	if (value === null || typeof value !== 'object') return false;
	if ('result' in value) return true;
	const error = (value as { error?: { reason?: unknown; message?: unknown } }).error;
	return error !== null && typeof error === 'object' && typeof error.reason === 'string' && typeof error.message === 'string';
};

/**
 * Take over a generated page, or mount a live one, whichever this document is.
 *
 * Params:
 *   target: the element the page lives in, `document.body` for a page `ssg` wrote
 *   item: the same item the site was rendered from. A component call, `h(Site, props)`, or a
 *         function that makes it, which is mounted as a component with no props either way
 *   render: the `ui` systems to use. Omitted, the document's shared render is used, as
 *           `mount` and `hydrate` do
 *
 * Returns: the removal, exactly as `mount` and `hydrate` answer it.
 *
 * A page `ssg` wrote carries `data-aweft-ssg` on its body and is hydrated: the server's elements
 * are adopted in place and nothing flashes. Anything else is mounted. The choice cannot be left to
 * the application, because both mistakes are silent in a different way: mounting over server
 * markup renders the page twice, and hydrating an empty body says the markup ran out.
 *
 * Example:
 *   const router = createRouter();
 *   attach(document.body, h(Site, { router }));
 *   router.links(document.body);
 */
export const attach = (target: ParentLike, item: unknown, render?: Render): Remove => {
	// A mount target is anything with the three node operations, and only an element can carry an
	// attribute, so a target that is not one is the mounting case by construction.
	const element = target as { hasAttribute?(name: string): boolean };
	const generated = typeof element.hasAttribute === 'function' && element.hasAttribute(STAMP);
	// A bare function means the same thing on both branches, so it is wrapped here rather than
	// left to `hydrate`, which does its own wrapping, and to `mount`, which would read it as a
	// mounter and render nothing. `mount`'s own contract is untouched.
	const mounted = typeof item === 'function' && !isComponentCall(item) ? h(item) : item;
	if (!generated) return mount(target, mounted, undefined, render);
	const removal = hydrate(target, mounted, render);
	// The answers are for the hydration alone: once it has settled, a later ask with the same
	// arguments wants what the server holds now (design 304).
	const page = (target as { ownerDocument?: object | null }).ownerDocument ?? pageDocument();
	void (removal as { ready?: Promise<void> }).ready?.then(() => {
		const held = page === undefined || page === null ? undefined : holding.get(page);
		for (const answers of held ?? []) answers.clear();
		held?.clear();
	});
	return removal;
};

/**
 * A client that answers each ask from the answers the server rendered this page with, before it
 * asks the server (design 304).
 *
 * Params:
 *   client: the page's connection, what `createClient` answered
 *   document: where the answers are read from, the page's own `document` when left off
 *
 * Returns: a client that answers an ask the server's render made with the answer it was given:
 * each answer once, in the order the render made the asks, a result resolved and a refusal
 * rejected with its reason, message and reasons. Every other ask, and everything but `ask`, goes
 * to `client`. A page with no answers in it gets `client` itself. Once `attach`'s hydration of
 * the same document has settled, the answers it did not hand out are dropped.
 *
 * Throws: `no-lookup` for a `document` with no `getElementById`, which could never find the
 * answers and would ask the server for everything without a word. And what `JSON.parse` throws for
 * an answers script that is not JSON, which a page `createPages` rendered never carries.
 *
 * Example:
 *   const client = replay(createClient({ url: '/ws' }));
 *   attach(document.body, h(Site, { router: createRouter(), client }));
 */
export const replay = (client: Client, document?: AnswerSource): Client => {
	const page = document ?? pageDocument();
	// No document at all is a process with no page. A document that cannot look anything up is a
	// mistake that would otherwise cost every read a request, silently.
	if (page === undefined) return client;
	if (typeof page.getElementById !== 'function') {
		throw codecError('no-lookup', 'replay was handed a document with no getElementById',
			'Pass the page\'s document, or an object whose getElementById finds the answers script by its id.');
	}
	const text = page.getElementById(ANSWERS)?.textContent;
	if (typeof text !== 'string' || text === '') return client;
	// Only a list of answers, each a result or a refusal, is kept: a record edited by hand is asked
	// for live rather than thrown out of an ask.
	const answers = new Map<string, Recorded[]>();
	for (const [key, list] of Object.entries(JSON.parse(text) as Record<string, unknown>)) {
		if (Array.isArray(list)) answers.set(key, list.filter(isRecorded));
	}
	let held = holding.get(page);
	if (held === undefined) holding.set(page, held = new Set());
	held.add(answers);

	return {
		status: client.status,
		ask: (name, args, options) => {
			if (answers.size > 0) {
				let key: string | undefined;
				try {
					key = askKey(name, throughJson(args));
				} catch {
					key = undefined;
				}
				const queue = key === undefined ? undefined : answers.get(key);
				const next = queue?.shift();
				if (queue !== undefined && queue.length === 0) answers.delete(key!);
				if (next !== undefined) {
					return 'result' in next
						? Promise.resolve(next.result)
						: Promise.reject(crossed(next.error.reason, next.error.message, next.error.reasons));
				}
			}
			return client.ask(name, args, options);
		},
		share: <T extends object>(name: string, given?: T, handlers?: ShareHandlers) => client.share<T>(name, given, handlers),
		reconnect: () => { client.reconnect(); },
		close: () => { client.close(); },
	};
};

/** Where a page stands: its language, and the router base its URLs carry. */
export interface PageLanguage {
	/** The tag on `<html lang>`, or `''` for a page with none. */
	readonly locale: string;
	/** `/<tag>` when the address is under the language's prefix, and `''` otherwise, which is the
	 * source language and a site with one language alike. What `createRouter({ base })` takes. */
	readonly base: string;
}

/**
 * The language a generated page is in, and the base its router needs.
 *
 * Params:
 *   document: the page's document, or anything with a `documentElement` carrying `lang` and a
 *             `location` with a `pathname`; the browser's `document` and `window` are read when
 *             the argument has no location of its own
 *
 * Returns: the tag on `<html lang>` and the prefix the address carries when its first segment is
 * that tag. A site with one language answers `''` for both, so an entry written this way works
 * before the site has a second language.
 *
 * Example:
 *   const { locale, base } = languageOf(document);
 *   const catalog = locale === 'en' ? undefined : (await import(`./text/${locale}.json`)).default;
 *   attach(document.body, h(Site, { router: createRouter({ base }) }), context({ locale, catalog }));
 */
export const languageOf = (document: {
	readonly documentElement?: { getAttribute?(name: string): string | null } | null;
	readonly location?: { readonly pathname?: string } | null;
}): PageLanguage => {
	const root = document.documentElement;
	const locale = (root !== null && root !== undefined && typeof root.getAttribute === 'function' ? root.getAttribute('lang') : null) ?? '';
	if (locale === '') return { locale: '', base: '' };
	const location = document.location ?? (globalThis as { location?: { pathname?: string } }).location;
	const path = location?.pathname ?? '/';
	const prefix = `/${locale}`;
	return { locale, base: path === prefix || path.startsWith(`${prefix}/`) ? prefix : '' };
};
