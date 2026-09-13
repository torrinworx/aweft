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
import { type Loader, type Source, createLoader } from '@aweftjs/modules';

import { assert } from './assert.ts';
import type { Component } from './component.ts';
import { type ContextNode, createContext } from './contexts.ts';
import { h } from './h.ts';
import { type ActEntries, type StageAct, type StageEntry } from './stage-entry.ts';
import { use } from './render.ts';
import { textOf } from './text.ts';
import { type Match, checkActKeys, hashOf, matchAct, parseQuery, pathOf, queryOf, writeQuery } from './route.ts';
import { suspend } from './suspend.tsx';

/** An act that is the component itself, with the static walk's parameter source on it. */
export type ActComponent = Component<Record<string, unknown>> & { entries?: ActEntries };

/** What an act module's factory answers (design 242). */
export interface ActInstance {
	/** The component the stage renders. */
	readonly component: Component<Record<string, unknown>>;
	/** What the live region says when this act arrives, a string or a text token. The head's title is not touched. */
	readonly title?: unknown;
}

/** What an act key maps to: the component itself, or the name of a module that makes one. */
export type Act = ActComponent | string;

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
	/** The acts, by path. `''` is the index; `:name` takes one segment, `*name` the rest, and a bare `*` parks the rest as the tail. */
	readonly acts: Readonly<Record<string, Act>>;
	/** What wraps the act. A plain pass-through when it is left off. */
	readonly template?: Component;
	/** The act shown when nothing matched: the 404. A name in `acts`. */
	readonly fallback?: string;
	/** The act shown when no URL decides. A name in `acts`. */
	readonly initial?: string;
	/**
	 * The router this stage takes its URL from. A nested stage under a routed act takes none and
	 * follows its parent's; a stage with no router above it either is a content swapper.
	 */
	readonly router?: Router;
	/**
	 * Where a named act comes from, in precedence order. The stage builds one loader over these
	 * for the whole routing tree; a stage inside an act inherits it and takes none of its own.
	 */
	readonly sources?: readonly Source[];
	/**
	 * The loader the modules are already in, from a platform that built it, instead of
	 * `sources` (design 279). The stage loads acts from it and never closes it; a stage inside
	 * an act inherits it as it would a loader built from `sources`.
	 */
	readonly loader?: Loader;
	/**
	 * The page's connection, handed to every module as its `client` prop. Typed `unknown`
	 * because this package may not import `@aweftjs/client`; pass what `createClient` answered.
	 * A static render names none, and a module that wants one decides what its absence means.
	 */
	readonly client?: unknown;
	/**
	 * The act shown when loading a named act is refused: a name in `acts` (design 244). It is
	 * handed the refusal as `refusal` and a `retry` that builds the act the URL chose again, and
	 * its key takes no parameters: it renders under the URL that was refused.
	 */
	readonly refused?: string;
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
	/** The one loader of a routing tree, or null when no stage in it was given sources. */
	readonly loader: Loader | null;
	/** The sources that loader was built over, for reading an act module's `entries`. */
	readonly sources: readonly Source[] | null;
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

/**
 * The refusal inside a rejected load, or null when there is none (design 244).
 *
 * The loader wraps a factory that threw as `failed` and carries the throw as its cause, so the
 * refusal is that cause, and only when it names a reason. Every other rejection is a defect in
 * the page: a name no source lists, a cycle, or a factory that threw a bare error.
 */
const refusalOf = (error: unknown): unknown => {
	const held = error as { reason?: unknown; cause?: unknown } | null;
	if (held === null || held === undefined || held.reason !== 'failed') return null;
	const cause = held.cause as { reason?: unknown } | null | undefined;
	if (cause === null || cause === undefined || typeof cause.reason !== 'string') return null;
	return cause;
};

/** Report something nobody is waiting on where the host already looks. */
const escaped = (error: unknown): void => {
	queueMicrotask(() => { throw error; });
};

/**
 * The template that adds nothing: the act, and no element around it.
 *
 * This is what a stage uses when the page named no `template`, and it is exported so a page that
 * names one for some acts can name this one for the rest rather than leaving a gap.
 *
 * Params:
 *   props: `children`, the act
 *
 * Returns: the children, unchanged.
 *
 * Example:
 *   stage.open({ name: 'preview', template: Default });
 */
export const Default = (props: { children?: unknown[] }): unknown => props.children ?? [];

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
	for (const named of [props.fallback, props.initial, props.refused]) {
		assert(named === undefined || props.acts[named] !== undefined,
			`the stage names ${JSON.stringify(named)} as an act and acts has no such key; declare it in acts or take the name off`);
	}
	// A refusal is not a route: the refused act renders under the refusing URL, so it would be
	// handed that URL's `:name` values, which are another act's parameters (design 244).
	assert(props.refused === undefined || !/(^|\/)[:*]/.test(props.refused),
		`the stage names ${JSON.stringify(props.refused)} as its refused act and that key takes parameters; a refused act renders under the URL that was refused, so name an act key with no :name or *name segment`);

	const above = Inner.read(context);
	assert(props.sources === undefined || props.loader === undefined,
		'the stage was given sources and a loader; a loader is already built over its sources, so pass one or the other');
	assert((props.sources === undefined && props.loader === undefined) || above === null,
		'a stage inside another stage cannot take sources or a loader of its own; one loader is built for a routing tree and every stage under it shares it, so declare sources on the outermost StageContext');
	assert(props.client === undefined || props.sources !== undefined,
		'the stage was given a client and no sources, so nothing would ever read it; a loader handed in was built with the props its builder chose, so pass sources too, or take the client off');
	const router = props.router ?? above?.router ?? null;
	const owns = props.router !== undefined;

	// One loader per mount, over the sources this stage was given, mirroring what the server does
	// with its own (designs 240, 242). `client` is the one prop the platform hands a page module,
	// and the key is absent when the caller named none, so a factory can tell the two apart. A
	// loader handed in belongs to whoever built it, so this stage never closes it (design 279).
	const ownsLoader = props.sources !== undefined;
	const loader: Loader | null = ownsLoader
		? createLoader({
			sources: props.sources!,
			...(props.client === undefined ? {} : { props: { client: props.client } }),
		})
		: props.loader ?? above?.loader ?? null;
	const sources = props.sources ?? above?.sources ?? null;
	for (const name of keys) {
		assert(typeof props.acts[name] !== 'string' || loader !== null,
			`the act ${JSON.stringify(name)} names the module ${JSON.stringify(props.acts[name])} and no stage above it was given sources or a loader; pass sources to the StageContext at the top of the routing tree`);
	}

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
	// Counts up per `retry`, so a refused act can ask for the act the URL chose to be built again
	// without the URL moving (design 244). Nothing else writes it.
	const rebuilds = mutable(0);
	// Every derived thing below follows these three, and everything else follows one of them.
	const source = all([opened, path, rebuilds]);
	const nameNow = (): string | null => opened.get()?.name ?? decide();
	const current = source.map(() => nameNow());
	// What decides whether the act is rebuilt: which act, the parameters it was matched with,
	// which open it is, and how many times something asked for it again. Not the tail, which
	// belongs to the child stage: a move from `/posts/3/edit` to `/posts/3/comments` changes the
	// child's act and leaves this one alone.
	const signature = source.map(() =>
		`${nameNow() ?? ''}|${writeQuery(params.get())}|${opened.get()?.id ?? 0}|${rebuilds.get()}`);
	/** Build the act the URL chose again, in place. What a refused act is handed as `retry`. */
	const retry = (): void => { rebuilds.set(rebuilds.get() + 1); };

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
	/** What the live region says next: the act module's `title`, or the head's when it has none. */
	let announced: string | null = null;
	/** The act module loaded right now, so the stage knows what to let go of when it leaves. */
	let loaded: string | null = null;

	const drop = (name: string): void => {
		if (loader === null) return;
		loader.unload(name).catch(escaped);
	};

	// The outgoing act goes after the incoming one is showing, so a module both of them depend on
	// is never torn down and rebuilt between two pages that hold it (design 242).
	const retire = (leaving: string | null): void => {
		if (leaving !== null && leaving !== loaded) drop(leaving);
	};

	/** Counts up per build, so a load that lands after a later navigation knows it was abandoned. */
	let builds = 0;

	/**
	 * Load a named act and answer its component, called with the props the act was given.
	 *
	 * Answers null when the build that asked for it has been abandoned, and nothing is mounted.
	 */
	const instantiate = async (name: string, given: Record<string, unknown>, round: number): Promise<unknown> => {
		const instance = (await loader!.load([name]))[name] as Partial<ActInstance> | null;
		const component = instance?.component;
		assert(typeof component === 'function',
			`the act module ${JSON.stringify(name)} answered with no component; return { component, title? } from its factory`);
		// A later navigation abandoned this load, so this instance is never going on screen. The
		// stage must not record it as loaded: doing so made the stage let go of an act it had
		// never shown on the next move, and hold the one it was actually showing until unmount.
		if (round !== builds) {
			if (name !== loaded) drop(name);
			return null;
		}
		loaded = name;
		// Resolved here, where the render is, so a token is announced in the page's language.
		const title = textOf(context, instance?.title);
		announced = title !== '' ? title : null;
		return h(component as Component, given);
	};

	const mountAct = async (act: Act, given: Record<string, unknown>, round: number): Promise<unknown> =>
		(typeof act === 'string' ? await instantiate(act, given, round) : h(act as Component, given));

	/** The act, ready to mount, or null when the build that asked for it was abandoned. */
	const wrap = (report: { ready: () => void }, built: unknown): unknown =>
		(built === null ? null : h(Ready, report, built));

	const build = (): unknown => {
		const name = nameNow();
		builds += 1;
		const round = builds;
		const leaving = loaded;
		loaded = null;
		announced = null;
		if (name === null) {
			// Nothing is coming to hang the unload on, so it happens as soon as the stage knows.
			retire(leaving);
			return null;
		}
		const act = props.acts[name];
		assert(act !== undefined, `the stage has no act named ${JSON.stringify(name)}; declare it in acts`);
		const held = opened.get();
		const mine = held !== null && held.name === name;
		const own = (mine ? held.template : null) ?? props.template ?? Default;
		// What the open carried past `name`, `template` and `history`. It goes to the template as
		// well as to the act (design 213), so a `Modal` opened with a `label` is named at the call
		// rather than in a closure written per open. An act reached from the URL carried nothing,
		// so the template the stage was given is called with nothing.
		const outer = mine ? held.props : {};
		// The stage goes to the act as a prop, so an act reads `params` and `query` without
		// reaching into the context. It is written after the open's props, because the stage an act
		// is in is not a thing an open gets to name.
		const given = { ...(mine ? held.props : {}), stage: value };
		const report = { ready: () => { ready(); retire(leaving); } };

		if (typeof act !== 'string') return h(own, outer, h(Ready, report, h(act as Component, given)));

		// A name is the lazy form, so it goes through the same `suspend` path (design 242). Under a
		// hydration that shows nothing at all and the server's markup stays (design 243).
		const lazy = suspend<Record<string, unknown>>(null, async () => {
			try {
				return wrap(report, await instantiate(act, given, round));
			} catch (error) {
				const refusal = props.refused === undefined ? null : refusalOf(error);
				if (refusal === null) {
					retire(leaving);
					throw error;
				}
				// The URL does not move: what changed is what the act it names rendered (design 244).
				// `retry` is how the refused act asks for the act the URL chose once the reason has
				// stopped holding, and it is written after the open's props so an open cannot shadow it.
				return wrap(report, await mountAct(
					props.acts[props.refused!]!, { ...given, refusal, retry }, round));
			}
		});
		return h(own, outer, h(lazy, {}));
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
		// An act module's own `title` wins, because the head may still say what the last page did.
		const title = announced
			?? render.head.title()
			?? (globalThis as { document?: { title?: string } }).document?.title ?? null;
		if (title !== null && title !== '') announce(title);
		restoreScroll(win);
	};

	// --- the registry entry ------------------------------------------------------------------------

	// Read once per name and no sooner: a plain mount evaluates no module it does not show.
	const declared = new Map<string, Promise<ActEntries | null>>();
	const exported = async (name: string): Promise<ActEntries | null> => {
		for (const source of sources ?? []) {
			for (const candidate of await source.candidates()) {
				if (candidate.name !== name) continue;
				const found = (await candidate.exports() as { entries?: ActEntries }).entries;
				if (typeof found === 'function') return found;
			}
		}
		return null;
	};

	/** An act's parameter source: its own for a component, its module's `entries` for a name. */
	const entriesOf = (act: Act | undefined): ActEntries | null => {
		if (act === undefined) return null;
		if (typeof act !== 'string') return act.entries ?? null;
		return async () => {
			let held = declared.get(act);
			if (held === undefined) declared.set(act, held = exported(act));
			const found = await held;
			// A module that exports none says nothing about its URLs, which is what null means to
			// a walk: the same answer a parameterised component act with no `entries` gives.
			return found === null ? null : await found();
		};
	};

	const acts: StageAct[] = keys.map((name) => ({
		name,
		loader: typeof props.acts[name] === 'string',
		entries: entriesOf(props.acts[name]),
	}));
	const entry: StageEntry = {
		acts,
		get prefix() {
			return above === null ? '' : above.basePath();
		},
		parent: above?.entry ?? null,
		fallback: props.fallback ?? null,
		// Read on every ask, not captured: a walk renders a URL and then asks what that URL showed.
		get current() {
			return nameNow();
		},
	};

	// --- the mount ---------------------------------------------------------------------------------

	let taken = false;
	const inner: StageInner = {
		router,
		loader,
		sources,
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

	/** The page is going away, so everything it built goes with it: nothing else holds this loader. */
	const closeLoader = async (own: Loader): Promise<void> => {
		// Reverse load order is a dependency order reversed, so a module stops before what it
		// depends on, which is what `server.stop()` does with its own (design 240).
		for (const name of [...own.loaded()].reverse()) await own.unload(name);
	};

	return (arg) => {
		if (arg !== undefined) return remove(arg);
		for (const stop of stops) stop();
		claim?.release();
		forget();
		const held = loaded;
		loaded = null;
		if (ownsLoader) closeLoader(loader!).catch(escaped);
		else if (held !== null) drop(held);
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
 *         takes the rest, and a trailing bare `*` takes nothing and parks the rest as the tail
 *         for a stage inside the act. A value is the component, or the name of a module whose
 *         factory answers `{ component, title? }` (design 242)
 *   template: what wraps the act. A pass-through when it is left off
 *   fallback: the act shown when nothing matched. This is the 404, and it is matched last
 *   initial: the act shown when no URL decides: no router, or a parent that took the whole path
 *   router: the router this stage reads. Without one the stage is a content swapper driven by
 *           `open` and `close`, and a stage inside an act takes what its parent did not match
 *   sources: where a named act comes from. The stage builds one loader over these for the whole
 *            routing tree, so a stage inside an act inherits it and takes no `sources`
 *   loader: the loader the modules are already in, instead of `sources`, from a platform that
 *           built it; the stage loads acts from it and never closes it (design 279)
 *   client: the page's connection, handed to every module as its `client` prop
 *   refused: the act shown when loading a named act rejects with a refusal (design 244)
 *   children: the page, with a `Stage` somewhere in it
 *
 * Returns: the subtree, with the stage in scope for everything under it. Reach it with
 * `StageContext.read(context)` or `StageContext.use(stage => ...)`. Every act is also handed the
 * stage as its `stage` prop, so an act that only wants `params` or `query` takes it as an argument.
 *
 * A named act is loaded, with its dependencies first, when the stage decides it, and unloaded
 * once the next act is showing; the modules it depended on stay loaded for the page, and go when
 * the stage is removed.
 *
 * Throws: an assert, loud in development and stripped in a release build, for an act key that is
 * not relative, has an empty segment, has a `:` with no name, has a `*` segment anywhere but
 * last, or cannot be told apart from another key; for a `fallback`, `initial` or `refused` naming
 * an act that is not declared; for a `refused` naming a key with a `:name` or `*name` segment,
 * which would render under another act's parameters; for a nested stage given `sources` or a
 * `loader`; for `sources` beside a `loader`; for a `client` with no `sources`; for a named act
 * with no `sources` or `loader` anywhere above it; and for an act module whose instance carries
 * no `component`.
 *
 * Example:
 *   <StageContext router={router} sources={[app]} client={client}
 *     acts={{ '': Home, 'posts/:id': 'posts/Page' }} fallback="404" refused="join">
 *     <Nav /><Stage />
 *   </StageContext>
 */
export const StageContext: StageContextComponent = Object.assign(
	provider as unknown as (props: StageProps) => unknown,
	{ read: Value.read, node: Value.node, use: Value.use },
);

/** What `claimTail` hands a routed child that is not a stage. */
export interface TailClaim {
	/** The part of the path the parent stage did not take, recomputed on every navigation. */
	readonly tail: Derived<string>;
	/**
	 * The path the parent's acts sit under plus what the parent matched, as `StageEntry.prefix`
	 * spells it: no leading slash, `''` at the root. Read on each ask, because the parent's match
	 * can change under a mounted child.
	 */
	readonly base: string;
	/** The router of the routing tree, or null when no stage above has one. */
	readonly router: Router | null;
	/** Give the tail back, so the next claimant takes it. Call it on unmount. */
	release(): void;
}

/**
 * Claim the parent stage's tail for a component that is a routed child without being a stage
 * (design 279): a frame that routes inside itself, say. It claims exactly what a nested
 * `StageContext` claims, once, and the tail is released with `release` when the component
 * unmounts (design 123).
 *
 * Params:
 *   context: the mount context the component was handed
 *
 * Returns: the claim, or null when there is no stage above or the tail is already claimed, which
 * is what a second child under one act gets.
 *
 * Example:
 *   const Room = (props): Mounter => (elem, _item, before, context) => {
 *     const claim = claimTail(context);
 *     const stop = claim?.tail.effect((tail) => { route.url = `/${tail}`; });
 *     ...
 *     return (arg) => { if (arg !== undefined) return remove(arg); stop?.(); claim?.release(); return remove(); };
 *   };
 */
export const claimTail = (context: unknown): TailClaim | null => {
	const inner = Inner.read(context);
	if (inner === null) return null;
	const claim = inner.claimTail();
	if (claim === null) return null;
	return {
		tail: claim.tail,
		get base() {
			return inner.basePath();
		},
		router: inner.router,
		release: claim.release,
	};
};

/**
 * Where the current act is rendered.
 *
 * Params:
 *   nothing
 *
 * Returns: the act `current` names, inside the template chosen for it. An act named as a module
 * runs through `suspend`, so it shows the `LoaderContext`'s loading component while it arrives
 * and its failed component if it never does. Inside a hydration it shows neither: the server's
 * markup stays until the act arrives (design 243).
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
