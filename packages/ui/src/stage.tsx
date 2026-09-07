// The stage: acts declared as data, and the content that swaps between them.
//
// `StageContext` holds the acts and, when it is given a router, the URL. `Stage` renders whichever
// act is current. They are two components rather than one because a component that did template
// selection, URL matching, child coordination and the accessibility work at once is a file nobody
// could change safely. Designs 122 to 126.

import { type Derived, all, mutable } from '@aweftjs/core';
import {
	type ElementLike, type Mounter, type NodeLike, type Remove,
	getFirst, h as domH, mount,
} from '@aweftjs/dom';
import type { Router } from '@aweftjs/dom/router';

import { assert } from './assert.ts';
import type { Component } from './component.ts';
import { type ContextNode, createContext } from './contexts.ts';
import { h } from './h.ts';
import { type ActEntries, type StageAct, type StageEntry } from './stage-entry.ts';
import { use } from './render.ts';
import { type Match, checkActKeys, hashOf, matchAct, parseQuery, pathOf, queryOf, writeQuery } from './route.ts';
import { suspend } from './suspend.tsx';

/** An act that is the component itself, with the static walk's parameter source on it. */
export type ActComponent = Component<Record<string, unknown>> & { entries?: ActEntries };

/** An act that arrives later: `{ load: () => import('./page.tsx') }`. */
export interface LazyAct {
	/** Resolves to the component, or to a module whose `default` is one. */
	load(): Promise<unknown>;
	/** The static walk's parameter source. */
	entries?: ActEntries;
}

/** What an act key maps to: the component, or a loader for it. */
export type Act = ActComponent | LazyAct;

/** What `open` takes. Everything past the three named fields is props for the act. */
export interface OpenOptions {
	/** The act to show, by its key in `acts`. */
	readonly name: string;
	/** The template to wrap it in, for this open only. */
	readonly template?: Component;
	/** Take a history entry, so back dismisses it. The URL does not move (design 124). */
	readonly history?: boolean;
	readonly [prop: string]: unknown;
}

/** The stage an act is in: what is showing, what the URL said, and the two ways to change it. */
export interface StageValue {
	/** The act showing now, or null when nothing is. */
	readonly current: Derived<string | null>;
	/** The `:name` and `*name` values of the act key that matched. */
	readonly params: Derived<Readonly<Record<string, string>>>;
	/** The URL's query, as a plain object. Write to it and the URL is updated with `replace`. */
	readonly query: Derived<Record<string, string>>;
	/**
	 * Show an act now, whatever the URL says.
	 *
	 * Props do not accumulate: each call replaces what the one before it held.
	 */
	open(options: OpenOptions): void;
	/** Put the stage back on what the URL decides. */
	close(): void;
}

/** What `StageContext` takes. */
export interface StageProps {
	/** The acts, by path. `''` is the index; `:name` takes one segment and `*name` the rest. */
	readonly acts: Readonly<Record<string, Act>>;
	/** What wraps the act. A plain pass-through when it is left off. */
	readonly template?: Component;
	/** The act shown when nothing matched: the 404. A name in `acts`. */
	readonly fallback?: string;
	/** The act shown when no URL decides. A name in `acts`. */
	readonly initial?: string;
	/** The router this stage takes its URL from. Without one it is a content swapper. */
	readonly router?: Router;
	readonly children?: unknown[];
}

interface Opened {
	/** Counts up per open, so two opens of one act with the same props are still two opens. */
	readonly id: number;
	readonly name: string;
	readonly template: Component | null;
	readonly props: Record<string, unknown>;
	/** The history entry this open owns, or null when it owns none. */
	readonly key: string | null;
}

/** What a child stage reaches on its parent. Not exported: it is how nesting works, not API. */
interface StageInner {
	readonly router: Router | null;
	/** The one query cell of a routing tree: every stage under one router shares it. */
	readonly query: Derived<Record<string, string>>;
	/** The tail this stage did not take, for the one child stage that claims it. */
	claimTail(): { tail: Derived<string>; release(): void } | null;
	/** The path a child stage's acts sit under: this stage's prefix plus what it matched. */
	basePath(): string;
	readonly entry: StageEntry;
	/** Say a new title, through the root stage's live region. */
	announce(text: string): void;
	/** What `Stage` mounts. */
	readonly content: Derived<unknown>;
	/** `Stage` tells the stage how to find the act's root element, and releases it on unmount. */
	bind(first: () => NodeLike | null): () => void;
	/** The act's content has mounted. */
	ready(): void;
}

const Value = createContext<StageValue | null>(null);
const Inner = createContext<StageInner | null>(null);

const isLazy = (act: Act): act is LazyAct =>
	typeof act === 'object' && act !== null && typeof (act as LazyAct).load === 'function';

const entriesOf = (act: Act | undefined): ActEntries | null =>
	(act === undefined ? null : (act as { entries?: ActEntries }).entries ?? null);

const componentOf = (loaded: unknown): Component => {
	const found = typeof loaded === 'function' ? loaded : (loaded as { default?: unknown })?.default;
	assert(typeof found === 'function',
		'a lazy act resolved to something that is not a component; make the module\'s default export the component, or resolve to the component itself');
	return found as Component;
};

/** The template a stage uses when the page named none. */
const Pass = (props: { children?: unknown[] }): unknown => props.children ?? [];

/** Wraps the act so the stage learns when the act itself, and not its loading fallback, mounted. */
const Ready = (
	props: { ready?: () => void; children?: unknown[] },
	_cleanup: (...fns: (() => void)[]) => void,
	mounted: (...fns: (() => void)[]) => void,
): unknown => {
	mounted(() => { props.ready?.(); });
	return props.children ?? [];
};

const HIDDEN = 'position:absolute;width:1px;height:1px;margin:-1px;padding:0;'
	+ 'overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0';

const browser = (): { scrollTo(x: number, y: number): void; document?: unknown } | null =>
	(globalThis as { window?: { scrollTo(x: number, y: number): void } }).window ?? null;

const joinPath = (prefix: string, taken: string): string =>
	(prefix === '' ? taken : taken === '' ? prefix : `${prefix}/${taken}`);

/** What `StageContext` is. Its block comment is on the exported symbol, which is what a caller sees. */
const provider = (props: StageProps): Mounter => (elem, _item, before, context) => {
	const render = use(context);
	const keys = Object.keys(props.acts);
	checkActKeys(keys);
	for (const named of [props.fallback, props.initial]) {
		assert(named === undefined || props.acts[named] !== undefined,
			`the stage names ${JSON.stringify(named)} as an act and acts has no such key; declare it in acts or take the name off`);
	}

	const above = Inner.read(context);
	const router = props.router ?? above?.router ?? null;
	const owns = props.router !== undefined;

	// A stage with a router of its own reads the URL. One without takes what its parent did not
	// match, and there is one claimant (design 123).
	const claim = owns ? null : above?.claimTail() ?? null;
	const path: Derived<string | null> = owns
		? props.router!.url.map((url) => pathOf(String(url)))
		: claim === null ? mutable<string | null>(null) : claim.tail.map((tail) => String(tail));

	const found: Derived<Match | null> = path.map((held) => (held === null ? null : matchAct(keys, held)));
	const params = found.map((match) => match?.params ?? {});
	const tail = found.map((match) => match?.tail ?? '');

	const decide = (): string | null => {
		const held = path.get();
		if (held !== null) {
			const match = found.get();
			if (match !== null) return match.name;
			// An empty path is a stage whose parent took the whole URL, not a URL nothing answered.
			if (pathOf(held) !== '') return props.fallback ?? props.initial ?? null;
		}
		return props.initial ?? props.fallback ?? null;
	};

	const opened = mutable<Opened | null>(null);
	let opens = 0;
	// Every derived thing below follows these two, and everything else follows one of them.
	const source = all([opened, path]);
	const nameNow = (): string | null => opened.get()?.name ?? decide();
	const current = source.map(() => nameNow());
	// What decides whether the act is rebuilt: which act, the parameters it was matched with, and
	// which open it is. Not the tail, which belongs to the child stage: a move from
	// `/posts/3/edit` to `/posts/3/comments` changes the child's act and leaves this one alone.
	const signature = source.map(() => `${nameNow() ?? ''}|${writeQuery(params.get())}|${opened.get()?.id ?? 0}`);

	// --- the query -----------------------------------------------------------------------------

	const query: Derived<Record<string, string>> = above?.query
		?? mutable<Record<string, string>>(owns ? parseQuery(queryOf(String(props.router!.url.get()))) : {});

	const stops: (() => void)[] = [];
	if (owns) {
		const live = props.router!;
		let fromUrl = false;
		stops.push(live.url.effect((url) => {
			const held = parseQuery(queryOf(String(url)));
			if (writeQuery(held) === writeQuery(query.get())) return;
			fromUrl = true;
			try {
				query.set(held);
			} finally {
				fromUrl = false;
			}
		}));
		stops.push(query.effect((held) => {
			if (fromUrl) return;
			const url = String(live.url.get());
			const written = writeQuery(held);
			if (written === writeQuery(parseQuery(queryOf(url)))) return;
			// `replace`, not `push`: a filter a user changes ten times leaves one entry behind it.
			live.replace(`/${pathOf(url)}${written === '' ? '' : `?${written}`}${hashOf(url)}`);
		}));
	}

	// --- opening and closing -------------------------------------------------------------------

	const open = (options: OpenOptions): void => {
		const { name, template, history, children: _children, ...rest } = options;
		assert(props.acts[name] !== undefined,
			`open was given the act ${JSON.stringify(name)} and acts has no such key; declare it in acts`);
		let key: string | null = null;
		if (history === true && router !== null) {
			const held = opened.get();
			const owned = held !== null && held.key !== null && String(router.key.get()) === held.key;
			// The same URL, so the address bar does not move and a copied link is the page. A
			// second open while the stage already owns the entry replaces it rather than pushing a
			// second one, so one back closes whatever is showing and lands on the page (design 124).
			if (owned) router.replace(String(router.url.get()));
			else router.push(String(router.url.get()));
			key = String(router.key.get());
		}
		opens += 1;
		opened.set({ id: opens, name, template: template ?? null, props: rest, key });
	};

	const close = (): void => {
		const held = opened.get();
		if (held === null) return;
		if (held.key !== null && router !== null && String(router.key.get()) === held.key) {
			// The entry change is what closes it, so closing by button and closing by back are one
			// navigation rather than two ways to be half closed.
			router.back();
			return;
		}
		opened.set(null);
	};

	if (router !== null) {
		stops.push(all([router.key, router.url]).effect(() => {
			const held = opened.get();
			if (held === null) return;
			if (held.key === null || String(router.key.get()) !== held.key) opened.set(null);
		}));
	}

	// --- what Stage mounts -----------------------------------------------------------------------

	const value: StageValue = { current, params, query, open, close };

	let ready = (): void => undefined;

	const build = (): unknown => {
		const name = nameNow();
		if (name === null) return null;
		const act = props.acts[name];
		assert(act !== undefined, `the stage has no act named ${JSON.stringify(name)}; declare it in acts`);
		const held = opened.get();
		const mine = held !== null && held.name === name;
		const template = (mine ? held.template : null) ?? props.template ?? Pass;
		// The stage goes to the act as a prop, so an act reads `params` and `query` without
		// reaching into the context. It is written after the open's props, because the stage an act
		// is in is not a thing an open gets to name.
		const given = { ...(mine ? held.props : {}), stage: value };
		const report = { ready: () => { ready(); } };

		if (isLazy(act!)) {
			const lazy = suspend<Record<string, unknown>>(null, async () =>
				h(Ready, report, h(componentOf(await act!.load()), given)));
			return h(template, {}, h(lazy, {}));
		}
		return h(template, {}, h(Ready, report, h(act as Component, given)));
	};

	const content = signature.map(() => build());

	// --- the act change effects ------------------------------------------------------------------

	const region = above === null
		? domH('div', { 'aria-live': 'polite', 'aria-atomic': 'true', style: HIDDEN }) as ElementLike
		: null;

	const announce = (text: string): void => {
		if (region === null) {
			above!.announce(text);
			return;
		}
		if (region.textContent !== text) region.textContent = text;
	};

	let firstNode: (() => NodeLike | null) | null = null;
	// The first act is not a change: a page load should not steal focus or announce itself, and
	// the browser has already put the page where the URL asked for.
	let settled = false;

	const focusAct = (): void => {
		const node = firstNode?.() ?? null;
		if (node === null || node.nodeType !== 1) return;
		const element = node as ElementLike & { focus?: () => void };
		if (typeof element.focus !== 'function') return;
		if (!element.hasAttribute('tabindex')) element.setAttribute('tabindex', '-1');
		element.focus();
	};

	const restoreScroll = (win: { scrollTo(x: number, y: number): void }): void => {
		if (router !== null && router.restore()) return;
		const hash = hashOf(router === null ? '' : String(router.url.get()));
		const page = (globalThis as { document?: { getElementById(id: string): { scrollIntoView(): void } | null } }).document;
		const target = hash === '' || page === undefined ? null : page.getElementById(hash.slice(1));
		if (target !== null) {
			target.scrollIntoView();
			return;
		}
		win.scrollTo(0, 0);
	};

	ready = (): void => {
		if (!settled) {
			settled = true;
			return;
		}
		const win = browser();
		if (win === null) return;
		focusAct();
		const title = render.head.title()
			?? (globalThis as { document?: { title?: string } }).document?.title ?? null;
		if (title !== null && title !== '') announce(title);
		restoreScroll(win);
	};

	// --- the registry entry ------------------------------------------------------------------------

	const acts: StageAct[] = keys.map((name) => ({
		name,
		loader: isLazy(props.acts[name]!),
		entries: entriesOf(props.acts[name]),
	}));
	const entry: StageEntry = {
		acts,
		get prefix() {
			return above === null ? '' : above.basePath();
		},
		parent: above?.entry ?? null,
	};

	// --- the mount ---------------------------------------------------------------------------------

	let taken = false;
	const inner: StageInner = {
		router,
		query,
		claimTail: () => {
			if (taken) return null;
			taken = true;
			return { tail, release: () => { taken = false; } };
		},
		basePath: () => joinPath(entry.prefix, found.get()?.taken ?? ''),
		entry,
		announce,
		content,
		bind: (first) => {
			firstNode = first;
			return () => { firstNode = null; };
		},
		ready: () => { ready(); },
	};

	const forget = render.stage.add(entry);
	const inside = h(Value, { value }, h(Inner, { value: inner }, ...(props.children ?? [])));
	const remove = mount(elem, region === null ? inside : [region, inside], before, context);

	return (arg) => {
		if (arg !== undefined) return remove(arg);
		for (const stop of stops) stop();
		claim?.release();
		forget();
		return remove();
	};
};

/** `StageContext`, with the three ways to reach the stage from outside a consumer. */
export interface StageContextComponent {
	(props: StageProps): unknown;
	/** The stage a mount is inside, or null above every stage. */
	read(context: unknown): StageValue | null;
	/** The nearest stage's context node, or null. */
	node(context: unknown): ContextNode<StageValue | null> | null;
	/** A component built from the stage it is mounted in, once, when it is built. */
	use<P extends Record<string, unknown>>(build: (stage: StageValue | null) => Component<P>): Component<P>;
}

/**
 * Hold a set of acts, and the URL when a router is given.
 *
 * Params:
 *   acts: the acts, by path. `''` is the index, `:name` takes one segment, one trailing `*name`
 *         takes the rest. A value is the component, or `{ load: () => import('./page.tsx') }`
 *   template: what wraps the act. A pass-through when it is left off
 *   fallback: the act shown when nothing matched. This is the 404, and it is matched last
 *   initial: the act shown when no URL decides: no router, or a parent that took the whole path
 *   router: the router this stage reads. Without one the stage is a content swapper driven by
 *           `open` and `close`, and a stage inside an act takes what its parent did not match
 *   children: the page, with a `Stage` somewhere in it
 *
 * Returns: the subtree, with the stage in scope for everything under it. Reach it with
 * `StageContext.read(context)` or `StageContext.use(stage => ...)`. Every act is also handed the
 * stage as its `stage` prop, so an act that only wants `params` or `query` takes it as an argument.
 *
 * Throws: an assert, loud in development and stripped in a release build, for an act key that is
 * not relative, has an empty segment, has a `:` or `*` with no name, has a `*rest` anywhere but
 * last, or cannot be told apart from another key; and for a `fallback` or `initial` naming an act
 * that is not declared.
 *
 * Example:
 *   <StageContext router={router} acts={{ '': Home, 'posts/:id': Post }} fallback="404">
 *     <Nav /><Stage />
 *   </StageContext>
 */
export const StageContext: StageContextComponent = Object.assign(
	provider as unknown as (props: StageProps) => unknown,
	{ read: Value.read, node: Value.node, use: Value.use },
);

/**
 * Where the current act is rendered.
 *
 * Params:
 *   nothing
 *
 * Returns: the act `current` names, inside the template chosen for it. A lazy act runs through
 * `suspend`, so it shows the `LoaderContext`'s loading component while it arrives and its failed
 * component if it never does.
 *
 * Throws: an assert, loud in development and stripped in a release build, when there is no
 * `StageContext` above it.
 *
 * Example:
 *   <StageContext router={router} acts={acts}><Nav /><Stage /></StageContext>
 */
export const Stage = (): Mounter => (elem, _item, before, context) => {
	const inner = Inner.read(context);
	assert(inner !== null, 'Stage has no StageContext above it; wrap the page in <StageContext acts={...}> and put the Stage inside it');

	const remove: Remove = mount(elem, inner!.content, before, context);
	const release = inner!.bind(() => remove(getFirst) ?? null);

	return (arg) => {
		if (arg !== undefined) return remove(arg);
		release();
		return remove();
	};
};
