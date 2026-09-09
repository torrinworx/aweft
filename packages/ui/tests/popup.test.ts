// The popup system with no browser: where a popup goes in the tree, and how it comes back out.
// Where it goes on the screen is `internal.placement.test.ts`, and what a real browser does with
// it is `browser.test.ts`.

import test from 'node:test';
import assert from 'node:assert/strict';

import { mutable } from '@aweftjs/core';
import { createDocument, parseHtml, toHtml } from '@aweftjs/dom';
import type { LightElement, NodeLike } from '@aweftjs/dom';
import {
	Detached, Menu, Popup, PopupContext, Select, Stage, StageContext,
	context, h, hydrate, mark, mount, render, trackedMount,
} from '@aweftjs/ui';
import type { Rect } from '@aweftjs/ui';

const somewhere = { mode: 'below-start' as const, left: 10, top: 20, maxWidth: 100, maxHeight: 60, transformOrigin: 'top left' };

/** Every element at or under `node` and its siblings, in document order. */
const elements = (node: NodeLike | null): LightElement[] => {
	const found: LightElement[] = [];
	for (let n = node; n !== null; n = n.nextSibling) {
		if (n.nodeType === 1) found.push(n as unknown as LightElement);
		found.push(...elements(n.firstChild));
	}
	return found;
};

test('a popup renders nothing where it is written and everything at the sink', () => {
	const where = mutable<typeof somewhere | null>(somewhere);
	const document = createDocument();
	const stop = mount(document.body, h(PopupContext, {},
		h('main', {}, 'the page', h(Popup as never, { placement: where }, h('nav', {}, 'menu')))));

	const markup = toHtml(document.body.childNodes);
	assert.match(markup, /^<main>the page<\/main>/, 'the page has no popup inside it');
	assert.match(markup, /<div style="[^"]*left: 10px[^"]*"><nav>menu<\/nav><\/div>$/, 'the popup is after the page');
	stop();
});

test('a null placement hides the popup and a value shows it again', () => {
	const where = mutable<typeof somewhere | null>(null);
	const document = createDocument();
	const stop = mount(document.body, h(PopupContext, {}, h(Popup as never, { placement: where }, 'inside')));

	assert.match(toHtml(document.body.childNodes), /style="display: none;"/);
	where.set(somewhere);
	assert.match(toHtml(document.body.childNodes), /position: fixed/);
	assert.match(toHtml(document.body.childNodes), /max-height: 60px/);
	where.set(null);
	assert.match(toHtml(document.body.childNodes), /style="display: none;"/);
	stop();
});

test('a popup leaves the sink when it unmounts', () => {
	const shown = mutable(true);
	const own = context();
	const document = createDocument();
	const stop = mount(document.body, h(PopupContext, {},
		shown.bool(h(Popup as never, { placement: somewhere }, 'inside'), null)), undefined, own);

	assert.equal(own.popups.items.length, 1);
	shown.set(false);
	assert.equal(own.popups.items.length, 0, 'the popup took itself out of the sink');
	assert.doesNotMatch(toHtml(document.body.childNodes), /inside/);
	stop();
});

test('a popup with no PopupContext above it goes in the element the page was mounted into', () => {
	// It used to assert. A `Select`, a `Menu` and a `Tooltip` are all popups now, so that assert made
	// the simplest page in the package a page that refuses to render (design 113, amended).
	const document = createDocument();
	const stop = mount(document.body, h('main', {}, 'the page',
		h(Popup as never, { placement: somewhere }, h('nav', {}, 'menu'))));

	const markup = toHtml(document.body.childNodes);
	assert.match(markup, /^<main>the page<\/main>/, 'the page still has no popup inside it');
	assert.match(markup, /<nav>menu<\/nav>/, 'and the popup is on the page rather than refused');
	stop();
	assert.doesNotMatch(toHtml(document.body.childNodes), /menu/, 'and it comes back out again');
});

test('a popup inside a dialog goes in the dialog, whatever context is above it', () => {
	// The dialog's top layer swallows every pointer event aimed outside it, so a list drawn at a sink
	// beside the page cannot be clicked at all (design 113, amended).
	const own = context();
	const document = createDocument();
	const stop = mount(document.body, h(PopupContext, {},
		h('dialog', { id: 'sheet' }, 'the act',
			h(Popup as never, { placement: somewhere }, h('nav', {}, 'menu')))), undefined, own);

	assert.equal(own.popups.items.length, 0, 'the context sink was not asked for');
	const dialog = document.body.firstChild as unknown as LightElement;
	assert.equal(dialog.localName, 'dialog');
	assert.match(toHtml(dialog.childNodes), /<nav>menu<\/nav>/, 'the popup is inside the dialog');
	stop();
});

test('a Select and a Menu with no PopupContext still open their lists', () => {
	// The two components that draw a list are popups (designs 224, 225), so the assert that used to
	// stand here made a page with a `Select` on it a page that would not mount.
	for (const [name, item, role] of [
		['Select', h(Select as never, { options: ['a', 'b'] }), 'listbox'],
		['Menu', h(Menu as never, { label: 'Actions', items: [{ label: 'Rename' }] }), 'menu'],
	] as [string, unknown, string][]) {
		const document = createDocument();
		const stop = mount(document.body, item);
		const found = elements(document.body.firstChild)
			.filter((element) => element.getAttribute('role') === role);
		assert.equal(found.length, 1, `${name} drew its list with no context above it`);
		stop();
	}
});

test('two PopupContexts keep their popups apart', () => {
	const own = context();
	const document = createDocument();
	const stop = mount(document.body, [
		h(PopupContext, {}, h('section', {}, 'one'), h(Popup as never, { placement: somewhere }, 'first')),
		h(PopupContext, {}, h('section', {}, 'two'), h(Popup as never, { placement: somewhere }, 'second')),
	], undefined, own);

	// The first provider took the render's own sink; the second made one, because two providers
	// rendering one list would mount every popup in it twice.
	assert.equal(own.popups.items.length, 1);
	const markup = toHtml(document.body.childNodes);
	assert.ok(markup.indexOf('first') < markup.indexOf('two'), 'each popup sits inside its own context');
	stop();
});

test('trackedMount hands back the real nodes without keeping them out of the document', () => {
	const [nodes, virtual] = trackedMount();
	const document = createDocument();
	const stop = mount(document.body, [h(virtual as never, {}, h('b', {}, 'one'), h('i', {}, 'two')), nodes]);

	assert.equal(nodes.length, 2);
	assert.equal((nodes[0] as LightElement).localName, 'b');
	assert.equal(toHtml(document.body.childNodes), '<b>one</b><i>two</i>', 'the nodes still landed in the page');
	stop();
});

test('Detached renders its anchor where it was written and its popup at the sink', () => {
	const open = mutable(false);
	const document = createDocument();
	const stop = mount(document.body, h(PopupContext, {},
		h(Detached as never, { enabled: open },
			h('button', {}, 'menu'),
			h(mark.popup, {}, h('nav', {}, 'the menu')))));

	const markup = toHtml(document.body.childNodes);
	assert.match(markup, /^<button>menu<\/button>/);
	// Closed, and with no way to measure anything, the popup is present and hidden.
	assert.match(markup, /<div style="display: none;"><nav>the menu<\/nav><\/div>$/);
	stop();
});

test('nothing in the package writes a z-index', async () => {
	const { readdirSync, readFileSync } = await import('node:fs');
	const { join } = await import('node:path');
	const { fileURLToPath } = await import('node:url');
	const dir = fileURLToPath(new URL('../src/', import.meta.url));

	const found: string[] = [];
	const walk = (at: string): void => {
		for (const entry of readdirSync(at, { withFileTypes: true })) {
			const path = join(at, entry.name);
			if (entry.isDirectory()) walk(path);
			// The property being written, in either spelling. The words in a comment are not it.
			else if (/\bzIndex\s*:|z-index\s*:/.test(readFileSync(path, 'utf8'))) found.push(entry.name);
		}
	};
	walk(dir);
	assert.deepEqual(found, [], 'design 113 says this package writes no z-index, anywhere');
});

test('a registry removal is safe to run twice, and takes nothing else with it', () => {
	const own = context();
	const first = own.popups.add('first');
	own.popups.add('second');
	assert.deepEqual([...own.popups.items], ['first', 'second']);

	first();
	first();
	// An index looked up and not found is -1, and splice(-1, 1) takes the last item out instead
	// of nothing, which is how the second one would disappear.
	assert.deepEqual([...own.popups.items], ['second']);
});

test('a registry is claimed once, so two renderers cannot both take it', () => {
	const own = context();
	assert.equal(own.popups.claim(), true);
	assert.equal(own.popups.claim(), false);
});

// --- taking over the anchor's markup ----------------------------------------------------------

/** Render an item to markup and parse it back into a document, the way a page loads. */
const served = async (item: () => unknown): Promise<{ document: ReturnType<typeof createDocument>; markup: string }> => {
	const markup = await render(h(item), { context: context() });
	const document = createDocument();
	for (const node of parseHtml(markup, document)) document.body.appendChild(node);
	return { document, markup };
};

const byId = (node: NodeLike | null, id: string): LightElement | null => {
	for (let n = node; n !== null; n = n.nextSibling) {
		if (n.nodeType === 1 && (n as unknown as LightElement).getAttribute('id') === id) return n as unknown as LightElement;
		const inside = byId(n.firstChild, id);
		if (inside !== null) return inside;
	}
	return null;
};

test('a Detached whose anchor has a handler on it takes over the server\'s node', async () => {
	const app = (): unknown => {
		const open = mutable(false);
		return h(PopupContext, {},
			h('div', { id: 'page' },
				h(Detached as never, { enabled: open },
					h('button', { id: 'anchor', onClick: () => open.set(!open.get()) }, '?'),
					h(mark.popup, {}, h('div', { id: 'tip' }, 'help')))));
	};

	const { document, markup } = await served(app);
	const sent = byId(document.body.firstChild, 'anchor');
	assert.ok(sent !== null, 'the server wrote the anchor');

	const stop = hydrate(document.body, app);
	assert.equal(toHtml(document.body.childNodes), markup, 'the hydration changed the page');
	assert.equal(byId(document.body.firstChild, 'anchor'), sent,
		'the anchor on the page is the node the server sent, not one the client built in its place');

	// And the handler the client gave it reaches that node, which is what a dropped anchor loses.
	const box = byId(document.body.firstChild, 'tip')!.parentNode as unknown as LightElement;
	assert.match(box.getAttribute('style') ?? '', /display: none/, 'closed to begin with');
	(sent as unknown as { dispatchEvent(event: unknown): boolean }).dispatchEvent({ type: 'click', target: sent });
	assert.doesNotMatch(box.getAttribute('style') ?? '', /display: none/,
		'a click on the server\'s own node opened the popup');
	stop();
});

/** A fake browser: rectangles for the nodes an anchor is made of, and frames on demand. */
const laidOut = (rects: Map<unknown, Rect>): { frame(): void; stop(): void } => {
	const global = globalThis as Record<string, unknown>;
	const kept = { raf: global['requestAnimationFrame'], caf: global['cancelAnimationFrame'] };
	let queued: (() => void) | null = null;
	global['requestAnimationFrame'] = (fn: () => void): number => { queued = fn; return 1; };
	global['cancelAnimationFrame'] = (): void => { queued = null; };
	global['innerWidth'] = 1000;
	global['innerHeight'] = 800;
	for (const [node, rect] of rects) {
		(node as Record<string, unknown>)['getBoundingClientRect'] = (): Rect => rect;
	}
	return {
		frame: () => { const fn = queued; queued = null; fn?.(); },
		stop: () => { global['requestAnimationFrame'] = kept.raf; global['cancelAnimationFrame'] = kept.caf; },
	};
};

test('the anchor\'s rectangle is the union of every node between it and the popup', () => {
	const open = mutable(false);
	const document = createDocument();
	const stop = mount(document.body, h(PopupContext, {},
		h('div', { id: 'page' },
			h(Detached as never, { enabled: open, locations: ['below-start'] },
				h('b', { id: 'one' }, 'one'),
				' and ',
				h('i', { id: 'two' }, 'two'),
				h(mark.popup, {}, h('div', { id: 'tip' }, 'help'))))));

	const one = byId(document.body.firstChild, 'one')!;
	const two = byId(document.body.firstChild, 'two')!;
	const box = byId(document.body.firstChild, 'tip')!.parentNode as unknown as LightElement;
	const view = laidOut(new Map<unknown, Rect>([
		[one, { left: 10, top: 20, width: 30, height: 10 }],
		[two, { left: 60, top: 40, width: 20, height: 10 }],
	]));
	try {
		open.set(true);
		view.frame();
		// Worked out by hand: the union of the two rectangles is left 10, top 20, 70 by 30, and
		// `below-start` puts the popup at its left edge and its bottom. The text between them has no
		// rectangle to contribute, and the popup's own markers have none either.
		assert.match(box.getAttribute('style') ?? '', /left: 10px/);
		assert.match(box.getAttribute('style') ?? '', /top: 50px/);
	} finally {
		view.stop();
		stop();
	}
});

test('an anchor that is swapped for another element is measured again on the next frame', () => {
	const open = mutable(false);
	const which = mutable('one');
	const document = createDocument();
	const stop = mount(document.body, h(PopupContext, {},
		h('div', { id: 'page' },
			h(Detached as never, { enabled: open, locations: ['below-start'] },
				which.map((name: unknown) => (name === 'one'
					? h('b', { id: 'one' }, 'one')
					: h('i', { id: 'two' }, 'two'))),
				h(mark.popup, {}, h('div', { id: 'tip' }, 'help'))))));

	const box = byId(document.body.firstChild, 'tip')!.parentNode as unknown as LightElement;
	const view = laidOut(new Map<unknown, Rect>([
		[byId(document.body.firstChild, 'one')!, { left: 10, top: 20, width: 30, height: 10 }],
	]));
	try {
		open.set(true);
		view.frame();
		assert.match(box.getAttribute('style') ?? '', /left: 10px/, 'the first anchor');

		which.set('two');
		const two = byId(document.body.firstChild, 'two')!;
		(two as unknown as Record<string, unknown>)['getBoundingClientRect'] =
			(): Rect => ({ left: 200, top: 100, width: 40, height: 10 });
		view.frame();
		assert.match(box.getAttribute('style') ?? '', /left: 200px/,
			'the cell swapped the anchor and the next frame measured the element that is there now');
	} finally {
		view.stop();
		stop();
	}
});

test('a Detached with nothing written after it measures its anchor and not its own popup', () => {
	const open = mutable(false);
	const document = createDocument();
	// No element after it and no wrapper around it, so the popup sink's own nodes are the anchor's
	// next siblings. Walking to the end of the parent would measure the popup being placed.
	const stop = mount(document.body, h(PopupContext, {},
		h(Detached as never, { enabled: open, locations: ['below-start'] },
			h('b', { id: 'one' }, 'one'),
			h(mark.popup, {}, h('div', { id: 'tip' }, 'help')))));

	const one = byId(document.body.firstChild, 'one')!;
	const box = byId(document.body.firstChild, 'tip')!.parentNode as unknown as LightElement;
	const view = laidOut(new Map<unknown, Rect>([
		[one, { left: 10, top: 20, width: 30, height: 10 }],
		[box, { left: 0, top: 300, width: 500, height: 200 }],
	]));
	try {
		open.set(true);
		view.frame();
		assert.match(box.getAttribute('style') ?? '', /left: 10px/);
		assert.match(box.getAttribute('style') ?? '', /top: 30px/,
			'the anchor alone: taking the popup in as well would put this at 500');
	} finally {
		view.stop();
		stop();
	}
});

test('opening an act over one that held a popup renders the act that was opened', () => {
	// The page and the popups share one element, so the page needs an end of its own: without one
	// the act mounted after the swap landed behind the popups, and the sink's list took it for one
	// of its own as the popup left.
	let held: { open(options: Record<string, unknown>): void } | null = null;
	const Home = (props: { stage?: unknown }): unknown => {
		held = props.stage as { open(options: Record<string, unknown>): void };
		return h(Popup as never, { placement: mutable(somewhere) }, 'inside');
	};
	const document = createDocument();
	const stop = mount(document.body, h(PopupContext, {}, h(StageContext as never, {
		acts: { '': Home, other: () => h('p', { id: 'other' }, 'the other act') },
		initial: '',
	}, h(Stage as never, {}))));

	assert.match(toHtml(document.body.childNodes), /inside/, 'the first act put a popup up');
	held!.open({ name: 'other' });
	assert.ok(byId(document.body.firstChild, 'other') !== null, 'the act that was opened is on the page');
	assert.doesNotMatch(toHtml(document.body.childNodes), /inside/, 'and the popup went with the act that held it');
	stop();
});

test('every shape of popup under a PopupContext renders, parses and hydrates', async () => {
	// A popup mounts at the sink, which is after the page, and a hydration takes the server's
	// marker regions in the order the mounts ask for them. Mount the sink before the page and
	// the sink takes the region belonging to a popup written beside the page.
	const shapes: Record<string, () => unknown> = {
		'closed, last': () => {
			const where = mutable<typeof somewhere | null>(null);
			return h(PopupContext, {},
				h('div', { id: 'page' }, 'body'),
				h(Popup as never, { placement: where }, h('div', {}, 'contents')));
		},
		'open at render, last': () => {
			const where = mutable<typeof somewhere | null>(somewhere);
			return h(PopupContext, {},
				h('div', { id: 'page' }, 'body'),
				h(Popup as never, { placement: where }, h('div', {}, 'contents')));
		},
		'closed, first': () => {
			const where = mutable<typeof somewhere | null>(null);
			return h(PopupContext, {},
				h(Popup as never, { placement: where }, h('div', {}, 'contents')),
				h('div', { id: 'page' }, 'body'));
		},
		'inside an element': () => {
			const where = mutable<typeof somewhere | null>(null);
			return h(PopupContext, {},
				h('div', { id: 'page' }, 'body', h(Popup as never, { placement: where }, h('div', {}, 'contents'))));
		},
		'a Detached inside the page': () => {
			const open = mutable(false);
			return h(PopupContext, {},
				h('div', { id: 'page' },
					h(Detached as never, { enabled: open },
						h('button', {}, 'menu'),
						h(mark.popup, {}, h('div', { class: 'menu-body' }, 'contents')))));
		},
		'no popup at all': () => h(PopupContext, {}, h('div', { id: 'page' }, 'body')),
	};

	for (const [name, page] of Object.entries(shapes)) {
		const markup = await render(h(page), { context: context() });
		const document = createDocument();
		for (const node of parseHtml(markup, document)) document.body.appendChild(node);
		const stop = hydrate(document.body, page);
		assert.equal(toHtml(document.body.childNodes), markup, `${name}: hydration changed the page`);
		stop();
	}
});
