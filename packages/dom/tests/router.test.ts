// The router (design 121), on both of its implementations.
//
// With no `window` it runs its stack in memory, which is what a static render and a headless test
// get. With a fake `window` installed for the length of one `createRouter` call it takes the
// browser path, so `pushState`, `popstate`, `sessionStorage` and anchor clicks are all exercised
// here rather than only in Chromium.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createRouter } from '@aweftjs/dom/router';

const ORIGIN = 'https://site.test';

interface FakeHistory {
	scrollRestoration: string;
	back(): void;
	forward(): void;
}

interface Fake {
	readonly window: { readonly history: FakeHistory; readonly sessionStorage: unknown };
	readonly entries: { state: unknown; href: string }[];
	at(): number;
	fire(type: string, event: unknown): void;
	readonly storage: Map<string, string>;
	scrolled(): { x: number; y: number };
	place(x: number, y: number): void;
}

/** A window with just enough of one: history, location, session storage and listeners. */
const fakeWindow = (start = '/'): Fake => {
	const entries: { state: unknown; href: string }[] = [{ state: null, href: start }];
	const storage = new Map<string, string>();
	const listeners = new Map<string, ((event: unknown) => void)[]>();
	let at = 0;
	let x = 0;
	let y = 0;

	const fire = (type: string, event: unknown): void => {
		for (const listener of [...listeners.get(type) ?? []]) listener(event);
	};

	const window = {
		history: {
			get state() { return entries[at]!.state; },
			scrollRestoration: 'auto',
			pushState(state: unknown, _title: string, url: string) {
				entries.length = at + 1;
				entries.push({ state, href: url });
				at += 1;
			},
			replaceState(state: unknown, _title: string, url: string) { entries[at] = { state, href: url }; },
			back() {
				if (at === 0) return;
				at -= 1;
				fire('popstate', { state: entries[at]!.state });
			},
			forward() {
				if (at + 1 >= entries.length) return;
				at += 1;
				fire('popstate', { state: entries[at]!.state });
			},
		},
		location: {
			get href() { return ORIGIN + entries[at]!.href; },
			origin: ORIGIN,
			get pathname() { return entries[at]!.href.replace(/[?#].*$/, ''); },
			get search() { return (/\?[^#]*/.exec(entries[at]!.href) ?? [''])[0]; },
			get hash() { const found = entries[at]!.href.indexOf('#'); return found < 0 ? '' : entries[at]!.href.slice(found); },
		},
		sessionStorage: {
			getItem: (name: string) => storage.get(name) ?? null,
			setItem: (name: string, value: string) => { storage.set(name, value); },
		},
		get scrollX() { return x; },
		get scrollY() { return y; },
		scrollTo(toX: number, toY: number) { x = toX; y = toY; },
		addEventListener(type: string, listener: (event: unknown) => void) {
			listeners.set(type, [...listeners.get(type) ?? [], listener]);
		},
		removeEventListener(type: string, listener: (event: unknown) => void) {
			listeners.set(type, (listeners.get(type) ?? []).filter((held) => held !== listener));
		},
	};

	return {
		window: window as unknown as { readonly history: FakeHistory; readonly sessionStorage: unknown },
		entries,
		at: () => at,
		fire,
		storage,
		scrolled: () => ({ x, y }),
		place: (toX, toY) => { x = toX; y = toY; },
	};
};

/** Make a router with a window installed, and take the window away again. */
const withWindow = <T>(fake: Fake, make: () => T): T => {
	const held = (globalThis as { window?: unknown }).window;
	(globalThis as { window?: unknown }).window = fake.window;
	try {
		return make();
	} finally {
		if (held === undefined) delete (globalThis as { window?: unknown }).window;
		else (globalThis as { window?: unknown }).window = held;
	}
};

const anchor = (attrs: Record<string, string>, parent: unknown = null): unknown => ({
	localName: 'a',
	parentNode: parent,
	getAttribute: (name: string) => attrs[name] ?? null,
	hasAttribute: (name: string) => name in attrs,
});

const clickRoot = (): { root: { addEventListener(t: string, l: (e: never) => void): void; removeEventListener(t: string, l: (e: never) => void): void }; click(event: Record<string, unknown>): boolean } => {
	let held: ((event: unknown) => void)[] = [];
	return {
		root: {
			addEventListener: (_type, listener) => { held = [...held, listener as unknown as (event: unknown) => void]; },
			removeEventListener: (_type, listener) => { held = held.filter((one) => one !== (listener as unknown as (event: unknown) => void)); },
		},
		click: (event) => {
			let prevented = false;
			const full = { button: 0, ...event, preventDefault: () => { prevented = true; } };
			for (const listener of held) listener(full);
			return prevented;
		},
	};
};

// --- with no window --------------------------------------------------------------------------

test('with no window the router still moves, so a headless test can drive a whole navigation', () => {
	const router = createRouter({ url: '/about' });
	assert.equal(router.url.get(), '/about');
	assert.equal(router.base, '');

	router.push('/posts/3');
	assert.equal(router.url.get(), '/posts/3');

	router.back();
	assert.equal(router.url.get(), '/about');
});

test('an entry key is minted per push and comes back with back and forward', () => {
	const router = createRouter({ url: '/' });
	const first = router.key.get();
	router.push('/a');
	const second = router.key.get();
	assert.notEqual(second, first);
	router.push('/b');
	assert.notEqual(router.key.get(), second);
	router.back();
	assert.equal(router.key.get(), second, 'the key came back with the entry');
	router.back();
	assert.equal(router.key.get(), first);
});

test('replace keeps the entry it is on, and its key', () => {
	const router = createRouter({ url: '/' });
	router.push('/a');
	const key = router.key.get();
	router.replace('/a?sort=name');
	assert.equal(router.url.get(), '/a?sort=name');
	assert.equal(router.key.get(), key);
	router.back();
	assert.equal(router.url.get(), '/', 'replace left one entry behind it, not two');
});

test('base is taken off every URL the cell reports and put back on every one it writes', () => {
	const router = createRouter({ url: '/guide', base: '/docs/' });
	assert.equal(router.base, '/docs', 'a trailing slash is not part of a base');
	assert.equal(router.url.get(), '/guide');
	router.push('/api');
	assert.equal(router.url.get(), '/api');
	router.back();
	assert.equal(router.url.get(), '/guide');
});

test('a base that is not an absolute path is a loud mistake', () => {
	assert.throws(() => createRouter({ base: 'docs' }), /has to start with a slash/);
});

test('with no page there is no scroll position to save or restore', () => {
	const router = createRouter({ url: '/' });
	router.push('/a');
	assert.equal(router.saved(), null);
	assert.equal(router.restore(), false);
	assert.equal(router.links({ addEventListener: () => undefined, removeEventListener: () => undefined })(), undefined);
});

// --- with a window ----------------------------------------------------------------------------

test('a browser router writes history entries and follows popstate', () => {
	const fake = fakeWindow('/about');
	const router = withWindow(fake, () => createRouter());

	assert.equal(fake.window.history.scrollRestoration, 'manual', 'the browser is told not to guess');
	assert.equal(router.url.get(), '/about');

	router.push('/posts/3');
	assert.equal(fake.entries.length, 2);
	assert.equal(fake.entries[1]!.href, '/posts/3');

	fake.window.history.back();
	assert.equal(router.url.get(), '/about', 'popstate moved the cell');
	fake.window.history.forward();
	assert.equal(router.url.get(), '/posts/3');
	router.stop();
});

test('an entry the router did not write is stamped in place rather than pushed over', () => {
	const fake = fakeWindow('/start');
	fake.entries[0] = { state: { mine: 'yours' }, href: '/start' };
	const router = withWindow(fake, () => createRouter());

	assert.equal(fake.entries.length, 1, 'no entry was added');
	assert.deepEqual((fake.entries[0]!.state as { mine: string }).mine, 'yours', 'a foreign field survived');
	assert.notEqual(router.key.get(), '');
	router.stop();
});

test('scroll positions are kept per entry key and restored on request', () => {
	const fake = fakeWindow('/list');
	const router = withWindow(fake, () => createRouter());
	const list = router.key.get();

	fake.place(0, 640);
	router.push('/posts/3');
	assert.equal(router.saved(), null, 'the new entry has been nowhere');

	fake.place(0, 20);
	fake.window.history.back();
	assert.equal(router.key.get(), list);
	assert.deepEqual(router.saved(), { x: 0, y: 640 }, 'the position of the entry we left');
	assert.equal(router.restore(), true);
	assert.deepEqual(fake.scrolled(), { x: 0, y: 640 });

	// The store is keyed on the entry, so the other entry's position is its own.
	fake.window.history.forward();
	assert.deepEqual(router.saved(), { x: 0, y: 20 });
	router.stop();
});

test('a router restarted in the same session does not mint a key an entry already holds', () => {
	const fake = fakeWindow('/');
	const first = withWindow(fake, () => createRouter());
	first.push('/a');
	const used = first.key.get();
	first.stop();

	// A reload: the same session storage, a new router, the same history.
	const second = withWindow(fake, () => createRouter());
	second.push('/b');
	assert.notEqual(second.key.get(), used, 'a reused key would inherit the old entry\'s scroll position');
	second.stop();
});

test('links takes over a same-origin click and leaves everything else to the browser', () => {
	const fake = fakeWindow('/');
	const router = withWindow(fake, () => createRouter());
	const page = clickRoot();
	const stop = router.links(page.root);

	assert.equal(page.click({ target: anchor({ href: '/about' }) }), true, 'the router took it');
	assert.equal(router.url.get(), '/about');

	// A link that opted out.
	assert.equal(page.click({ target: anchor({ href: '/opted', 'data-no-route': '' }) }), false);
	assert.equal(router.url.get(), '/about');

	// Modifier keys, and every button but the primary one.
	for (const held of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey']) {
		assert.equal(page.click({ target: anchor({ href: '/mod' }), [held]: true }), false, `${held} is the browser's`);
	}
	assert.equal(page.click({ target: anchor({ href: '/mid' }), button: 1 }), false, 'middle click opens a tab');

	// A target, a download, and a click something else already handled.
	assert.equal(page.click({ target: anchor({ href: '/tab', target: '_blank' }) }), false);
	assert.equal(page.click({ target: anchor({ href: '/file', download: '' }) }), false);
	assert.equal(page.click({ target: anchor({ href: '/handled' }), defaultPrevented: true }), false);

	// Another origin, and another scheme.
	assert.equal(page.click({ target: anchor({ href: 'https://elsewhere.test/x' }) }), false);
	assert.equal(page.click({ target: anchor({ href: 'mailto:a@b.test' }) }), false);

	// target="_self" is this window, so it is taken; a click on nothing is not.
	assert.equal(page.click({ target: anchor({ href: '/self', target: '_self' }) }), true);
	assert.equal(page.click({ target: { localName: 'p', parentNode: null } }), false);
	assert.equal(page.click({ target: anchor({}) }), false, 'an anchor with no href is not a link');

	assert.equal(router.url.get(), '/self');
	stop();
	assert.equal(page.click({ target: anchor({ href: '/after' }) }), false, 'the unsubscribe took the listener off');
	router.stop();
});

test('a click on a link inside another element finds the link above it', () => {
	const fake = fakeWindow('/');
	const router = withWindow(fake, () => createRouter());
	const page = clickRoot();
	const stop = router.links(page.root);

	const link = anchor({ href: '/deep' });
	const span = { localName: 'span', parentNode: link };
	assert.equal(page.click({ target: span }), true);
	assert.equal(router.url.get(), '/deep');
	stop();
	router.stop();
});

test('a same-origin link outside the base is left to the browser', () => {
	const fake = fakeWindow('/docs/guide');
	const router = withWindow(fake, () => createRouter({ base: '/docs' }));
	const page = clickRoot();
	const stop = router.links(page.root);

	assert.equal(page.click({ target: anchor({ href: '/docs/api' }) }), true);
	assert.equal(router.url.get(), '/api');
	assert.equal(page.click({ target: anchor({ href: '/blog/post' }) }), false, 'outside the base is another page');
	assert.equal(router.url.get(), '/api');
	stop();
	router.stop();
});

test('stop takes the popstate listener off and the cells keep their last values', () => {
	const fake = fakeWindow('/a');
	const router = withWindow(fake, () => createRouter());
	router.push('/b');
	router.stop();
	fake.window.history.back();
	assert.equal(router.url.get(), '/b', 'a stopped router hears nothing');
});

test('session storage that refuses to answer costs a scroll position and nothing else', () => {
	const fake = fakeWindow('/');
	const broken = {
		...fake.window,
		sessionStorage: {
			getItem: () => { throw new Error('blocked'); },
			setItem: () => { throw new Error('blocked'); },
		},
	};
	const held = (globalThis as { window?: unknown }).window;
	(globalThis as { window?: unknown }).window = broken;
	try {
		const router = createRouter();
		router.push('/a');
		assert.equal(router.url.get(), '/a');
		assert.equal(router.saved(), null);
		assert.equal(router.restore(), false);
		router.stop();
	} finally {
		if (held === undefined) delete (globalThis as { window?: unknown }).window;
		else (globalThis as { window?: unknown }).window = held;
	}
});

test('a window with no history is not a window the router will use', () => {
	const held = (globalThis as { window?: unknown }).window;
	(globalThis as { window?: unknown }).window = { location: { href: 'https://site.test/x' } };
	try {
		const router = createRouter({ url: '/given' });
		assert.equal(router.url.get(), '/given', 'it fell back to the memory implementation');
		router.stop();
	} finally {
		if (held === undefined) delete (globalThis as { window?: unknown }).window;
		else (globalThis as { window?: unknown }).window = held;
	}
});

test('a window that refuses to hand over session storage at all is still a router', () => {
	const fake = fakeWindow('/');
	const guarded = Object.defineProperties({}, {
		history: { value: { state: null, pushState: () => undefined, replaceState: () => undefined, back: () => undefined } },
		location: { value: { href: `${ORIGIN}/`, origin: ORIGIN, pathname: '/', search: '', hash: '' } },
		// No scrollRestoration, no scrollX and no scrollY either: an old host, or a hardened one.
		addEventListener: { value: () => undefined },
		removeEventListener: { value: () => undefined },
		scrollTo: { value: () => undefined },
		sessionStorage: { get() { throw new Error('storage is off'); } },
	});
	const held = (globalThis as { window?: unknown }).window;
	(globalThis as { window?: unknown }).window = guarded;
	try {
		const router = createRouter();
		assert.equal(router.url.get(), '/');
		router.push('/a');
		assert.equal(router.saved(), null);
		router.stop();
	} finally {
		if (held === undefined) delete (globalThis as { window?: unknown }).window;
		else (globalThis as { window?: unknown }).window = held;
	}
	assert.equal(fake.at(), 0);
});

test('a stored scroll position that is not two numbers is no position', () => {
	const fake = fakeWindow('/');
	const router = withWindow(fake, () => createRouter());
	fake.storage.set(`aweft:scroll:${router.key.get()}`, 'left,down');
	assert.equal(router.saved(), null);
	fake.storage.set(`aweft:scroll:${router.key.get()}`, '4');
	assert.equal(router.saved(), null);
	router.stop();
});

test('with no base every path is inside it, the empty one included', () => {
	const fake = fakeWindow('/');
	const router = withWindow(fake, () => createRouter());
	const page = clickRoot();
	const stop = router.links(page.root);
	assert.equal(page.click({ target: anchor({ href: `${ORIGIN}/deep/link?x=1#top` }) }), true);
	assert.equal(router.url.get(), '/deep/link?x=1#top');
	stop();
	router.stop();
});

test('a link into this same page, differing only in its hash, is left to the browser', () => {
	const fake = fakeWindow('/guide?tab=api');
	const router = withWindow(fake, () => createRouter());
	const page = clickRoot();
	const stop = router.links(page.root);

	// The browser scrolls to the target and writes the entry. Taking this over would push an entry
	// nothing acted on, and the target would never be scrolled to at all.
	assert.equal(page.click({ target: anchor({ href: '#install' }) }), false, 'the click was not taken');
	assert.equal(router.url.get(), '/guide?tab=api', 'and nothing was pushed');
	assert.equal(fake.entries.length, 1);

	// A hash on another path is a real navigation and is still taken over.
	assert.equal(page.click({ target: anchor({ href: '/api#post' }) }), true);
	assert.equal(router.url.get(), '/api#post');

	// Same path, different query: not the same document, so the router takes it.
	assert.equal(page.click({ target: anchor({ href: '/api?sort=new#post' }) }), true);
	assert.equal(router.url.get(), '/api?sort=new#post');
	stop();
	router.stop();
});

test('replace keeps the fields somebody else put on the entry showing now', () => {
	const fake = fakeWindow('/');
	fake.entries[0] = { state: { mine: 'yours' }, href: '/' };
	const router = withWindow(fake, () => createRouter());

	router.replace('/a');
	assert.equal((fake.entries[0]!.state as { mine?: string }).mine, 'yours',
		'the entry is the same entry, so a foreign field is still on it');

	// A push is a new entry and starts from nothing.
	router.push('/b');
	assert.equal((fake.entries[1]!.state as { mine?: string }).mine, undefined);
	router.stop();
});

test('push takes a path, and a whole URL or one that already carries the base is a loud mistake', () => {
	const plain = createRouter({ url: '/' });
	assert.throws(() => plain.push('https://elsewhere.test/x'), /is a whole URL/);
	assert.throws(() => plain.push('//elsewhere.test/x'), /is a whole URL/);
	assert.throws(() => plain.replace('mailto:a@b.test'), /is a whole URL/);
	assert.equal(plain.url.get(), '/', 'none of them moved the router');

	const docs = createRouter({ url: '/guide', base: '/docs' });
	assert.throws(() => docs.push('/docs/api'), /already starts with this router's base/);
	assert.throws(() => docs.replace('/docs'), /already starts with this router's base/);
	docs.push('/api');
	assert.equal(docs.url.get(), '/api', 'the path the base is put back onto is the relative one');
});

// --- with entries handed in (design 279) ------------------------------------------------------

/** An entries object in memory that records what the router does to it. */
const fakeEntries = (start: string) => {
	const stack: { href: string; state: unknown }[] = [{ href: start, state: null }];
	const calls: string[] = [];
	const listeners: (() => void)[] = [];
	let at = 0;
	return {
		calls,
		/** Move the entries from outside, the way a page's back reaches a room. */
		arrive: (href: string) => {
			stack.length = at + 1;
			stack.push({ href, state: null });
			at += 1;
			for (const fn of [...listeners]) fn();
		},
		entries: {
			current: () => stack[at]!.href,
			state: () => stack[at]!.state,
			push: (state: unknown, href: string) => { calls.push(`push ${href}`); stack.length = at + 1; stack.push({ href, state }); at += 1; },
			replace: (state: unknown, href: string) => { calls.push(`replace ${href}`); stack[at] = { href, state }; },
			back: () => { calls.push('back'); if (at === 0) return; at -= 1; for (const fn of [...listeners]) fn(); },
			listen: (fn: () => void) => { listeners.push(fn); return () => { listeners.splice(listeners.indexOf(fn), 1); }; },
		},
	};
};

test('a router over entries in memory reads current, writes push, replace and back, and follows listen', () => {
	const fake = fakeEntries('/app/3/notes');
	const router = createRouter({ base: '/app/3', entries: fake.entries });
	assert.equal(router.url.get(), '/notes', 'url follows current, with the base taken off');
	assert.deepEqual(fake.calls, ['replace /app/3/notes'], 'the first entry was stamped with a key through the entries object');
	const first = router.key.get();

	router.push('/notes/7');
	assert.equal(router.url.get(), '/notes/7');
	assert.deepEqual(fake.calls.at(-1), 'push /app/3/notes/7', 'push reaches the object with the base on');
	router.replace('/notes/7?edit=1');
	assert.deepEqual(fake.calls.at(-1), 'replace /app/3/notes/7?edit=1');
	assert.equal(router.url.get(), '/notes/7?edit=1');

	fake.arrive('/app/3/settings');
	assert.equal(router.url.get(), '/settings', 'listen drives url');
	assert.notEqual(router.key.get(), first, 'an entry the router did not write is stamped with a key of its own');

	router.back();
	assert.equal(fake.calls.at(-1), 'back', 'back reaches the object');
	assert.equal(router.url.get(), '/notes/7?edit=1', 'and the object moved the router back');
	router.stop();
});

test('with a window present and entries handed in, links are still intercepted while the URL lives in the entries', () => {
	const fake = fakeEntries('/notes');
	const win = fakeWindow('/page/of/the/host');
	// The frame's location: what an opaque srcdoc frame reports, which no path resolves against.
	const location = (win.window as unknown as { location: object }).location;
	Object.defineProperty(location, 'href', { get: () => 'about:srcdoc' });
	Object.defineProperty(location, 'origin', { get: () => 'null' });
	const router = withWindow(win, () => createRouter({ entries: fake.entries }));
	assert.equal(router.url.get(), '/notes', 'the URL is the entries\', not the window\'s');
	assert.equal(win.entries.length, 1, 'the window\'s history was not written');
	assert.equal(win.window.history.scrollRestoration, 'auto', 'nor told anything');

	const clicks = clickRoot();
	const stop = router.links(clicks.root);
	assert.equal(clicks.click({ target: anchor({ href: '/notes/7' }) }), true, 'a root-relative link is taken');
	assert.equal(router.url.get(), '/notes/7');
	assert.equal(fake.calls.at(-1), 'push /notes/7', 'and pushed on the entries');
	assert.equal(clicks.click({ target: anchor({ href: 'edit?x=1' }) }), true, 'a relative link resolves against the entries\' URL');
	assert.equal(router.url.get(), '/notes/edit?x=1');
	assert.equal(clicks.click({ target: anchor({ href: 'https://elsewhere.test/x' }) }), false, 'a link with an origin of its own is the browser\'s');
	assert.equal(clicks.click({ target: anchor({ href: '#top' }) }), false, 'a hash on the page showing now is the browser\'s');
	assert.equal(clicks.click({ target: anchor({ href: '/other', target: '_blank' }) }), false, 'a link with a target is left alone');
	assert.equal(win.entries.length, 1, 'the window\'s history was never written');

	win.place(4, 40);
	router.push('/notes/8');
	assert.deepEqual(win.storage.size > 0, true, 'scroll positions still go to the window\'s storage');
	stop();
	router.stop();
});
