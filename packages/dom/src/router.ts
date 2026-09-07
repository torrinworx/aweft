// The URL, the history entry, and the clicks that move between them (design 121).
//
// One history path: `popstate`, `pushState`, `replaceState`. Everything the router does to a
// browser goes through the `Host` interface below, and the implementation with no `window` keeps
// its stack in memory rather than switching the effects off. So a static render, a Node test and
// a real page all drive the same router.

import { type Derived, mutable } from '@aweftjs/core';

import { assert } from './assert.ts';

/** Where a page was scrolled to, in CSS pixels from the top left. */
export interface ScrollPosition {
	readonly x: number;
	readonly y: number;
}

/** What `links` attaches to: the element clicks are watched on. */
export interface LinkRoot {
	addEventListener(type: string, listener: (event: never) => void): void;
	removeEventListener(type: string, listener: (event: never) => void): void;
}

/** What `createRouter` takes. */
export interface RouterOptions {
	/**
	 * The URL to start from, relative to `base`. In a browser the address bar wins and this is
	 * ignored; with no `window` it is where the router starts, `/` when it is left off.
	 */
	readonly url?: string;
	/** A path every URL is under, `/docs` say. No trailing slash; `''` when it is left off. */
	readonly base?: string;
}

/** The URL, the history entry, and the ways to move. */
export interface Router {
	/** The path, query and hash showing now, relative to `base`, always starting with `/`. */
	readonly url: Derived<string>;
	/** The key of the history entry showing now. The same key comes back with back and forward. */
	readonly key: Derived<string>;
	/** The path every URL of this router is under, as it was given. */
	readonly base: string;
	/**
	 * Go to a URL, on a new history entry.
	 *
	 * Params:
	 *   url: a path relative to `base`, with an optional query and hash
	 *
	 * Throws: an assert, loud in development and stripped in a release build, when the path is a
	 * whole URL or already starts with `base`, both of which produce a URL nothing answers.
	 */
	push(url: string): void;
	/** Go to a URL, keeping the entry showing now and its key. Same argument as `push`. */
	replace(url: string): void;
	/** Go back one entry. With no `window` this walks a stack held in memory. */
	back(): void;
	/**
	 * Take over same-origin anchor clicks under an element.
	 *
	 * A link into the page showing now, differing from it only in its hash, is left to the
	 * browser, which scrolls to the target and writes the entry itself.
	 *
	 * Params:
	 *   root: the element to watch clicks on
	 *
	 * Returns: the unsubscribe, as every registration in this stack does.
	 */
	links(root: LinkRoot): () => void;
	/** Where the page was when it last left this entry, or null. */
	saved(): ScrollPosition | null;
	/** Put the page back where `saved` says. Returns false when there is nothing saved. */
	restore(): boolean;
	/** Stop listening for entry changes. The router answers its last values afterwards. */
	stop(): void;
}

// --- the seam ---------------------------------------------------------------------------------

/**
 * Everything the router does outside itself. Two implementations: a browser, and a stack in
 * memory for a static render and for Node.
 */
interface Host {
	/** The whole path, query and hash showing now, `base` included. */
	current(): string;
	/** The history state of the entry showing now, whoever wrote it. */
	state(): unknown;
	push(state: unknown, href: string): void;
	replace(state: unknown, href: string): void;
	back(): void;
	/** Called after every entry change the host reports. Returns its unsubscribe. */
	listen(fn: () => void): () => void;
	/** Where the page is now, or null where there is no page. */
	position(): ScrollPosition | null;
	scroll(to: ScrollPosition): void;
	/** Session-lifetime storage, or null where there is none. */
	read(name: string): string | null;
	write(name: string, value: string): void;
	/**
	 * Take over clicks under a root. `go` is handed the whole path of a same-origin link and
	 * answers whether it took it; a click it did not take is left to the browser.
	 */
	intercept(root: LinkRoot, go: (path: string) => boolean): () => void;
}

interface HistoryLike {
	readonly state: unknown;
	scrollRestoration?: string;
	pushState(state: unknown, title: string, url: string): void;
	replaceState(state: unknown, title: string, url: string): void;
	back(): void;
}

interface StorageLike {
	getItem(name: string): string | null;
	setItem(name: string, value: string): void;
}

interface WindowLike {
	readonly history: HistoryLike;
	readonly location: { readonly href: string; readonly origin: string; readonly pathname: string; readonly search: string; readonly hash: string };
	readonly sessionStorage?: StorageLike | null;
	readonly scrollX?: number;
	readonly scrollY?: number;
	addEventListener(type: string, listener: (event: never) => void): void;
	removeEventListener(type: string, listener: (event: never) => void): void;
	scrollTo(x: number, y: number): void;
}

interface ClickLike {
	readonly defaultPrevented?: boolean;
	readonly button?: number;
	readonly metaKey?: boolean;
	readonly ctrlKey?: boolean;
	readonly shiftKey?: boolean;
	readonly altKey?: boolean;
	readonly target?: unknown;
	preventDefault(): void;
}

interface AnchorLike {
	readonly localName?: string;
	readonly parentNode?: AnchorLike | null;
	getAttribute?(name: string): string | null;
	hasAttribute?(name: string): boolean;
}

/** The attribute that leaves one link to the browser. */
const OPT_OUT = 'data-no-route';

const windowOf = (): WindowLike | null => {
	const found = (globalThis as { window?: WindowLike }).window;
	if (found === undefined || found === null) return null;
	const held = found as Partial<WindowLike>;
	return typeof held.history === 'object' && held.history !== null && typeof held.location === 'object'
		? found
		: null;
};

const anchorOf = (from: unknown): AnchorLike | null => {
	for (let node = from as AnchorLike | null | undefined; node !== null && node !== undefined; node = node.parentNode) {
		if (node.localName === 'a' && node.getAttribute !== undefined) return node;
	}
	return null;
};

const browserHost = (win: WindowLike): Host => {
	const session = (() => {
		// Reading `sessionStorage` throws outright where the user has turned storage off, so the
		// read that finds out is the one in a try rather than every read after it.
		try {
			return win.sessionStorage ?? null;
		} catch {
			return null;
		}
	})();

	if (win.history.scrollRestoration !== undefined) win.history.scrollRestoration = 'manual';

	return {
		current: () => win.location.pathname + win.location.search + win.location.hash,
		state: () => win.history.state,
		push: (state, href) => { win.history.pushState(state, '', href); },
		replace: (state, href) => { win.history.replaceState(state, '', href); },
		back: () => { win.history.back(); },
		listen: (fn) => {
			const on = (): void => { fn(); };
			win.addEventListener('popstate', on as (event: never) => void);
			return () => { win.removeEventListener('popstate', on as (event: never) => void); };
		},
		position: () => ({ x: win.scrollX ?? 0, y: win.scrollY ?? 0 }),
		scroll: (to) => { win.scrollTo(to.x, to.y); },
		read: (name) => {
			try {
				return session?.getItem(name) ?? null;
			} catch {
				return null;
			}
		},
		write: (name, value) => {
			// A full or refused quota is not a reason to fail a navigation: the page loses a
			// remembered scroll position and nothing else.
			try {
				session?.setItem(name, value);
			} catch {
				// nothing to do
			}
		},
		intercept: (root, go) => {
			const onClick = (event: ClickLike): void => {
				if (event.defaultPrevented === true) return;
				if (event.button !== undefined && event.button !== 0) return;
				if (event.metaKey === true || event.ctrlKey === true || event.shiftKey === true || event.altKey === true) return;

				const anchor = anchorOf(event.target);
				if (anchor === null) return;
				if (anchor.hasAttribute?.(OPT_OUT) === true) return;
				if (anchor.hasAttribute?.('download') === true) return;
				const target = anchor.getAttribute?.('target') ?? null;
				if (target !== null && target !== '' && target !== '_self') return;

				const href = anchor.getAttribute?.('href') ?? null;
				if (href === null || href === '') return;

				const resolved = new URL(href, win.location.href);
				if (resolved.origin !== win.location.origin) return;

				if (go(resolved.pathname + resolved.search + resolved.hash)) event.preventDefault();
			};
			root.addEventListener('click', onClick as (event: never) => void);
			return () => { root.removeEventListener('click', onClick as (event: never) => void); };
		},
	};
};

/**
 * The host with no page: a stack of entries, and nothing to scroll or click.
 *
 * `push`, `replace` and `back` all work, which is what lets a headless test drive a whole
 * navigation and a static render open the act a URL names.
 */
const memoryHost = (start: string): Host => {
	const stack: { href: string; state: unknown }[] = [{ href: start, state: null }];
	let at = 0;
	const listeners: (() => void)[] = [];
	const report = (): void => { for (const fn of [...listeners]) fn(); };

	return {
		current: () => stack[at]!.href,
		state: () => stack[at]!.state,
		push: (state, href) => {
			stack.length = at + 1;
			stack.push({ href, state });
			at += 1;
		},
		replace: (state, href) => { stack[at] = { href, state }; },
		back: () => {
			if (at === 0) return;
			at -= 1;
			report();
		},
		listen: (fn) => {
			listeners.push(fn);
			return () => {
				const found = listeners.indexOf(fn);
				if (found >= 0) listeners.splice(found, 1);
			};
		},
		position: () => null,
		scroll: () => undefined,
		read: () => null,
		write: () => undefined,
		intercept: () => () => undefined,
	};
};

// --- the entry stamp ----------------------------------------------------------------------------

/** The one field of a history state object this package writes. */
const ENTRY = 'aweft:entry';
const SEQUENCE = 'aweft:entry-seq';
const SCROLL = 'aweft:scroll:';

interface Entry {
	readonly key: string;
}

const entryOf = (raw: unknown): Entry | null => {
	if (raw === null || typeof raw !== 'object') return null;
	const held = (raw as Record<string, unknown>)[ENTRY];
	if (held === null || typeof held !== 'object') return null;
	return typeof (held as Entry).key === 'string' ? held as Entry : null;
};

/** The entry stamped onto whatever state was already there, so a foreign field survives. */
const stamped = (raw: unknown, entry: Entry): unknown =>
	(raw !== null && typeof raw === 'object'
		? { ...raw as Record<string, unknown>, [ENTRY]: entry }
		: { [ENTRY]: entry });

const trimEnd = (path: string): string => path.replace(/\/+$/, '');

// --- the router --------------------------------------------------------------------------------

/**
 * Make a router over the page's history, or over a stack in memory where there is no page.
 *
 * Params:
 *   options: `url`, where to start with no `window` (`/` when left off, ignored in a browser),
 *            and `base`, a path every URL is under (`''` when left off, no trailing slash)
 *
 * Returns: the router. `url` and `key` are read-only cells; write to them and they throw,
 * because `push` and `replace` are how a router moves.
 *
 * Throws: an assert, loud in development and stripped in a release build, when `base` does not
 * start with `/`, which is the mistake that silently routes nothing.
 *
 * Example:
 *   const router = createRouter({ base: '/docs' });
 *   const stop = router.links(document.body);
 *   router.push('/guide/install');
 *   router.url.get();  // '/guide/install'
 */
export const createRouter = (options: RouterOptions = {}): Router => {
	const base = trimEnd(options.base ?? '');
	assert(base === '' || base.startsWith('/'),
		`a router base has to start with a slash and ${JSON.stringify(base)} does not; write it as an absolute path such as '/docs'`);

	const win = windowOf();
	const start = options.url ?? '/';
	const host = win === null ? memoryHost(base + (start.startsWith('/') ? start : `/${start}`)) : browserHost(win);

	/** A URL relative to `base`, or null when it is outside it. */
	const within = (path: string): string | null => {
		if (base === '') return path === '' ? '/' : path;
		if (path === base) return '/';
		return path.startsWith(`${base}/`) ? path.slice(base.length) : null;
	};

	const href = (url: string): string => base + (url.startsWith('/') ? url : `/${url}`);

	const url = mutable(within(host.current()) ?? '/');
	const key = mutable('');
	let at = '';

	// Seeded from session storage rather than from zero, so a reload does not mint a key an entry
	// already in the back stack is using and inherit its scroll position.
	const seeded = Number(host.read(SEQUENCE) ?? '0');
	let sequence = Number.isFinite(seeded) ? seeded : 0;

	const nextKey = (): string => {
		sequence += 1;
		host.write(SEQUENCE, String(sequence));
		return `e${sequence}`;
	};

	/** Remember where the page is, against the entry it is about to leave. */
	const save = (): void => {
		if (at === '') return;
		const where = host.position();
		if (where !== null) host.write(SCROLL + at, `${where.x},${where.y}`);
	};

	/** Read the entry showing now, stamping it with a key when the router did not write it. */
	const sync = (): void => {
		let entry = entryOf(host.state());
		if (entry === null) {
			entry = { key: nextKey() };
			host.replace(stamped(host.state(), entry), host.current());
		}
		at = entry.key;
		key.set(entry.key);
		url.set(within(host.current()) ?? '/');
	};

	const stopListening = host.listen(() => {
		// The browser has already moved, and scroll restoration is manual, so the page is still
		// where the entry being left had it.
		save();
		sync();
	});
	sync();

	const go = (url_: string, replacing: boolean): void => {
		const entry = replacing ? { key: at } : { key: nextKey() };
		if (!replacing) save();
		const target = href(url_);
		// Replacing keeps whatever else is on the entry showing now, because it is still that
		// entry and its other fields belong to whoever wrote them. A push starts an entry of its
		// own, so it starts from nothing.
		if (replacing) host.replace(stamped(host.state(), entry), target);
		else host.push(stamped(null, entry), target);
		at = entry.key;
		key.set(entry.key);
		url.set(within(target) ?? '/');
	};

	const saved = (): ScrollPosition | null => {
		const held = host.read(SCROLL + key.get());
		if (held === null) return null;
		const [x, y] = held.split(',').map(Number);
		return x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y) ? null : { x, y };
	};

	/**
	 * What `push` and `replace` take. Checked here and not in `href`, because `links` works out its
	 * own path from the base and a page really under `/docs/docs` would fail the second rule.
	 */
	const checkPath = (to: string): void => {
		assert(!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(to) && !to.startsWith('//'),
			`push and replace take a path and ${JSON.stringify(to)} is a whole URL; write the path part on its own, and leave a page this router does not own to the browser`);
		assert(base === '' || (to !== base && !to.startsWith(`${base}/`)),
			`the path ${JSON.stringify(to)} already starts with this router's base ${JSON.stringify(base)}; paths are relative to the base, so write ${JSON.stringify(to.slice(base.length) === '' ? '/' : to.slice(base.length))}`);
	};

	return {
		url: url.map((value) => value),
		key: key.map((value) => value),
		base,
		push: (to) => { checkPath(to); go(to, false); },
		replace: (to) => { checkPath(to); go(to, true); },
		back: () => { host.back(); },
		links: (root) => host.intercept(root, (path) => {
			// A link into the page showing now, differing only in its hash, is the browser's. It
			// scrolls to the target and writes the entry itself, which no push here would do,
			// because the act does not change and nothing would move.
			const at = path.indexOf('#');
			if (at >= 0 && path.slice(0, at) === host.current().replace(/#.*$/, '')) return false;
			// Outside the base is somebody else's page, even on this origin, so the browser keeps it.
			const relative = within(path);
			if (relative === null) return false;
			go(relative, false);
			return true;
		}),
		saved,
		restore: () => {
			const where = saved();
			if (where === null) return false;
			host.scroll(where);
			return true;
		},
		stop: stopListening,
	};
};
