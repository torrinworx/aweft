// render and hydrate: static markup out, adopted in place back in.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { createArray, createObject, mutable, observer } from '@aweftjs/core';
import { recordingDocument } from '@aweftjs/testing';

import type { Cleanup, LightElement, Mounted, Pending } from '../src/index.ts';
import { createDocument, getFirst, h, hydrate, hydrating, mount, render, toHtml } from '../src/index.ts';

interface Row extends Record<string, unknown> { label?: string }
const row = (label: string): Row => createObject<Row>({ label });

test('render brackets every dynamic part and returns markup with no document', async () => {
	const count = mutable(1);
	const rows = createArray<Row>([row('a'), row('b')]);
	const Item = ({ each }: { each: Row }) => h('li', {}, observer(each).path('label'));
	const App = () => h('main', {}, h('p', {}, 'hello ', count), h('ul', {}, h(Item, { each: rows })));
	const markup = await render(h(App));
	assert.equal(markup,
		'<!--[--><main><p>hello <!--[-->1<!--]--></p><ul><!--[-->'
		+ '<!--[--><!--[--><li><!--[-->a<!--]--></li><!--]--><!--]-->'
		+ '<!--[--><!--[--><li><!--[-->b<!--]--></li><!--]--><!--]-->'
		+ '<!--]--></ul></main><!--]-->');
	assert.equal(await render('plain'), 'plain');
	assert.equal(await render([h('i'), null, 'x']), '<i></i>x');
});

test('render waits for pending content, and the mount is live while it waits', async () => {
	const text = mutable('loading');
	const Loader = (_p: unknown, _c: Cleanup, _m: Mounted, pending: Pending) => {
		pending(new Promise<void>((resolve) => setTimeout(() => {
			text.set('loaded');
			// A settled promise may register another; render waits for that one too.
			pending(new Promise<void>((r) => setTimeout(() => { text.set('done'); r(); }, 5)));
			resolve();
		}, 5)));
		return h('p', {}, text);
	};
	assert.equal(await render(h(Loader)), '<!--[--><p><!--[-->done<!--]--></p><!--]-->');
	const rejected = (_p: unknown, _c: Cleanup, _m: Mounted, pending: Pending) => {
		pending(Promise.reject(new Error('fetch failed')));
		return 'fallback';
	};
	assert.equal(await render(h(rejected)), '<!--[-->fallback<!--]-->', 'a rejected promise does not hang the render');
});

test('render hands its context to every mounter below', async () => {
	const Reader = () => (elem: never, _i: unknown, before: (a: typeof getFirst) => unknown, context: { site: string }) =>
		mount(elem, context.site, before as never, context);
	assert.equal(await render(h(Reader), { context: { site: 'here' } }), '<!--[-->here<!--]-->');
});

test('hydrate adopts the server nodes in place and the page stays live', async () => {
	const count = mutable(1);
	const rows = createArray<Row>([row('a'), row('b')]);
	let clicks = 0;
	const Item = ({ each }: { each: Row }) => h('li', {}, observer(each).path('label'));
	const App = () => h('main', {},
		h('p', { class: 'x', $onclick: () => { clicks += 1; } }, 'hello ', count, ' ', 'there'),
		h('ul', {}, h(Item, { each: rows })),
	);

	const markup = await render(h(App));
	const { document, ops } = recordingDocument();
	document.body.innerHTML = markup;
	const main = (document.body as LightElement).children[0]!;
	const p = main.children[0]!;
	const firstLi = main.children[1]!.children[0]!;
	ops.length = 0;

	const stop = hydrate(document.body, h(App));
	assert.equal((document.body as LightElement).children[0], main, 'the main element is the server node');
	assert.equal(main.children[0], p);
	assert.equal(main.children[1]!.children[0], firstLi);
	assert.equal(toHtml(document.body), `<body>${markup}</body>`, 'nothing in the tree changed');
	assert.deepEqual(ops.filter((op) => op.startsWith('remove') || op.startsWith('clear')), [],
		`nothing was removed: ${ops.join(' | ')}`);
	assert.equal(stop(getFirst)!.nodeName, '#comment', 'the outer region marker is the first node');

	p.dispatchEvent({ type: 'click' });
	assert.equal(clicks, 1, 'the listener is on the adopted node');

	count.set(2);
	rows.push(row('c'));
	rows[0]!.label = 'A';
	assert.equal(main.children[0]!.textContent, 'hello 2 there');
	assert.equal(main.children[1]!.textContent, 'Abc');
	assert.equal(main.children[1]!.children[0], firstLi, 'the first row is still the adopted node');

	stop();
	assert.equal(toHtml(document.body), '<body></body>');
});

test('hydrate sets properties and listeners, and splits a server text that serialized two client texts', async () => {
	const App = () => h('label', {}, h('input', { $value: 'typed', $checked: true, type: 'checkbox' }), 'a', 'b');
	const markup = await render(h(App));
	const doc = createDocument();
	doc.body.innerHTML = markup;
	const label = doc.body.children[0]!;
	const input = label.children[0]!;
	assert.equal(label.childNodes.length, 2, 'the server has one text node for a and b');

	hydrate(doc.body, h(App));
	assert.equal(input['value'], 'typed');
	assert.equal(input['checked'], true);
	assert.equal(label.childNodes.length, 3, 'split so each client text node has a server one');
	assert.equal(label.textContent, 'ab');
});

test('hydrate refuses a structural mismatch and heals an attribute or text difference loudly', async () => {
	// The server renders the same maker the client hydrates, so both sides bracket the same
	// region (design 157).
	const Page = (): unknown => h('main', {}, h('p', { class: 'x' }, 'hi'));
	const markup = await render(h(Page));
	const doc = createDocument();
	doc.body.innerHTML = markup;
	assert.throws(() => hydrate(doc.body, () => h('main', {}, h('div', {}, 'hi'))), /expected a <div> and found a <p>/);

	doc.body.innerHTML = markup;
	assert.throws(() => hydrate(doc.body, () => h('main', {}, h('p', { class: 'y' }, 'hi'))), /attribute mismatch/);

	doc.body.innerHTML = markup;
	assert.throws(() => hydrate(doc.body, () => h('main', {}, h('p', { class: 'x' }, 'bye'))), /text mismatch/);

	doc.body.innerHTML = markup;
	assert.throws(() => hydrate(doc.body, () => h('main', {}, h('p', { class: 'x' }, 'hi'), h('i'))), /ran out/);

	doc.body.innerHTML = markup;
	assert.throws(() => hydrate(doc.body, () => h('main', {}, h('p', { class: 'x' }))), /did not render/);

	doc.body.innerHTML = markup;
	assert.throws(() => hydrate(doc.body, () => h('main', {}, mutable('hi'))), /no marker region/);

	// The server nested one more element than the client builds, so the client's `p` meets it.
	doc.body.innerHTML = await render(h(() => h('main', {}, h('main', {}, h('p', { class: 'x' }, 'hi')))));
	assert.throws(() => hydrate(doc.body, Page), /expected a <p> and found a <main>/);
});

test('an attribute a cell drives is set on the adopted node, not read as a mismatch', async () => {
	const done = mutable(true);
	const App = () => h('li', { class: done.bool('done', null), id: 'row' }, 'x');
	const markup = await render(h(App));
	assert.equal(markup, '<!--[--><li id="row" class="done">x</li><!--]-->');
	const doc = createDocument();
	doc.body.innerHTML = markup;
	const li = doc.body.children[0]!;
	hydrate(doc.body, h(App));
	assert.equal(doc.body.children[0], li);
	assert.equal(li.getAttribute('class'), 'done');
	done.set(false);
	assert.equal(li.hasAttribute('class'), false);
});

test('a $style object survives render and hydrate: the markup has the attribute, the client sets the property', async () => {
	const App = () => h('div', { $style: { color: 'red' }, class: 'c' }, 'x');
	const markup = await render(h(App));
	assert.equal(markup, '<!--[--><div class="c" style="color: red;">x</div><!--]-->');
	const doc = createDocument();
	doc.body.innerHTML = markup;
	const div = doc.body.children[0]!;
	div.style.cssText = '';
	hydrate(doc.body, h(App));
	assert.equal(doc.body.children[0], div, 'the server element is adopted, not read as a mismatch');
	assert.equal(div.style.cssText, 'color: red;', 'the property is set on the adopted node');
});

test('a second hydrate over a live one is refused, and works again once the first is removed', async () => {
	const Page = (): unknown => h('p', {}, 'x');
	const markup = await render(h(Page));
	const doc = createDocument();
	doc.body.innerHTML = markup;
	const stop = hydrate(doc.body, Page);
	assert.throws(() => hydrate(doc.body, Page), /already holds a live hydration/);
	assert.equal(toHtml(doc.body), '<body><!--[--><p>x</p><!--]--></body>', 'the first hydration still holds its nodes');
	stop();
	doc.body.innerHTML = markup;
	const again = hydrate(doc.body, Page);
	assert.equal(toHtml(doc.body), '<body><!--[--><p>x</p><!--]--></body>');
	again();
});

test('a node the application made is inserted, never claimed', async () => {
	const doc = createDocument();
	const own = doc.createElement('canvas');
	const App = () => h('div', {}, own);
	const markup = await render(h(App));
	assert.equal(markup, '<!--[--><div><canvas></canvas></div><!--]-->');
	doc.body.innerHTML = markup;
	hydrate(doc.body, h(App));
	assert.equal(doc.body.children[0]!.children[0], own, 'the application node itself is in the tree');
});

test('hydrate refuses a top-level node built before the call, in either shape', async () => {
	const Page = (): unknown => h('p', { class: 'x' }, 'hi');
	const markup = await render(h(Page));
	const doc = createDocument();
	doc.body.innerHTML = markup;
	const sent = doc.body.children[0]!;

	// Built outside every mount, so nothing recorded it and there is nothing to claim with.
	const built = doc.createElement('p');
	built.setAttribute('class', 'x');
	built.appendChild(doc.createTextNode('hi'));
	const refused = /cannot claim the server markup with a node it did not make/;

	assert.throws(() => hydrate(doc.body, built), refused, 'handed straight in');
	assert.equal(toHtml(doc.body), `<body>${markup}</body>`, 'nothing was inserted');
	assert.equal(doc.body.children[0], sent, 'the server node is still the one in the page');

	assert.throws(() => hydrate(doc.body, () => built), refused, 'returned by the maker');
	assert.equal(toHtml(doc.body), `<body>${markup}</body>`, 'nothing was inserted');
	assert.equal(doc.body.children[0], sent, 'the server node is still the one in the page');

	const stop = hydrate(doc.body, h(Page));
	assert.equal(doc.body.children[0], sent, 'a component call still claims');
	stop();

	doc.body.innerHTML = markup;
	const second = doc.body.children[0]!;
	const again = hydrate(doc.body, () => h('p', { class: 'x' }, 'hi'));
	assert.equal(doc.body.children[0], second, 'a maker that builds inside the call still claims');
	again();
});

test('hydrate needs a document, and answers getFirst', async () => {
	assert.throws(() => hydrate({ insertBefore: () => null, removeChild: () => null, replaceChild: () => null }, 'x'), /document/);
	const doc = createDocument();
	doc.body.innerHTML = await render('x');
	const stop = hydrate(doc.body, 'x');
	assert.equal(stop(getFirst), doc.body.firstChild);
});

// --- the hydration waits for what the page is still loading (design 243) -----------------------

/** A component whose content arrives when `settle` is called, the way a loaded act arrives. */
const arriving = (make: () => unknown): {
	Late: (p: unknown, c: Cleanup, m: Mounted, pending: Pending) => unknown;
	settle: () => void;
} => {
	const shown = mutable<unknown>(null);
	let go = (): void => undefined;
	const waited = new Promise<void>((resolve) => { go = resolve; });
	const Late = (_p: unknown, _c: Cleanup, _m: Mounted, pending: Pending): unknown => {
		pending(waited.then(() => { shown.set(make()); }));
		return shown;
	};
	return { Late, settle: go };
};

/**
 * The same page on both sides, with its own arrival on each: the server's has already landed.
 *
 * What arrives is a component call rather than an element, because an element built outside a
 * mount is nobody's and hydration inserts it rather than claiming with it (design 157).
 */
const twoSides = (make: () => unknown): { server: () => unknown; client: () => unknown; settle: () => void } => {
	const first = arriving(make);
	first.settle();
	const second = arriving(make);
	const page = (Late: (p: unknown, c: Cleanup, m: Mounted, pending: Pending) => unknown) =>
		(): unknown => h('main', {}, h('span', {}, 'first'), h(Late, {}));
	return { server: page(first.Late), client: page(second.Late), settle: second.settle };
};

test('hydrate keeps the pairing walk open until a pending load has settled', async () => {
	const Arrived = (): unknown => h('p', { id: 'late' }, 'arrived');
	const { server, client, settle } = twoSides(() => h(Arrived, {}));

	const markup = await render(h(server));
	assert.match(markup, /<p id="late">arrived<\/p>/, 'the server rendered the loaded content');

	const { document, ops } = recordingDocument();
	document.body.innerHTML = markup;
	const main = (document.body as LightElement).children[0]!;
	const before = [...main.children];
	assert.equal(before.length, 2, 'the server wrote both the plain element and the loaded one');
	ops.length = 0;

	const page = hydrate(document.body, h(client));
	let finished = false;
	void page.ready.then(() => { finished = true; });
	// Nothing has been checked or taken away yet: the loaded half is still the server's markup.
	assert.deepEqual([...main.children], before, 'the server nodes are all still there');
	assert.deepEqual(ops.filter((op) => op.startsWith('remove') || op.startsWith('clear')), [],
		`nothing was removed while the load was in flight: ${ops.join(' | ')}`);

	// Enough turns for a `ready` that had resolved inside the call to have run its `then`. It has
	// not: the hydration is not over while the load is in flight, which is the whole record.
	for (let i = 0; i < 6; i += 1) await Promise.resolve();
	assert.equal(finished, false, 'ready is still pending while the load is in flight');

	settle();
	await page.ready;
	assert.equal(finished, true, 'and it resolves once the load has landed');
	assert.deepEqual([...main.children], before, 'every element the server wrote was adopted, by identity');
	assert.deepEqual(ops.filter((op) => op.startsWith('remove') || op.startsWith('clear')), [],
		`and nothing was removed once it landed: ${ops.join(' | ')}`);
	page();
});

test('ready resolves with nothing pending, and a rejected load still finishes the hydration', async () => {
	const Plain = () => h('main', {}, 'plain');
	const plainMarkup = await render(h(Plain));
	const plain = recordingDocument().document;
	plain.body.innerHTML = plainMarkup;
	const first = hydrate(plain.body, h(Plain));
	await first.ready;
	assert.equal(toHtml(plain.body), `<body>${plainMarkup}</body>`, 'a page with nothing pending is unchanged');
	first();

	// A load that rejects settles like any other: the walk closes and the page keeps what it has.
	const Broken = (_p: unknown, _c: Cleanup, _m: Mounted, pending: Pending): unknown => {
		pending(Promise.reject(new Error('nope')));
		return h('p', {}, 'here anyway');
	};
	const markup = await render(h(Broken));
	const { document } = recordingDocument();
	document.body.innerHTML = markup;
	const kept = (document.body as LightElement).children[0]!;
	const page = hydrate(document.body, h(Broken));
	await page.ready;
	assert.equal((document.body as LightElement).children[0], kept, 'the server node is still the one in the page');
	assert.equal(toHtml(document.body), `<body>${markup}</body>`);
	page();
});

test('a hydration removed while a load is in flight checks nothing when it lands', async () => {
	const Arrived = (): unknown => h('p', {}, 'arrived');
	const { server, client, settle } = twoSides(() => h(Arrived, {}));
	const markup = await render(h(server));
	const { document } = recordingDocument();
	document.body.innerHTML = markup;

	const page = hydrate(document.body, h(client));
	page();
	assert.equal(toHtml(document.body), '<body></body>', 'the page came down');
	settle();
	// The surplus check would assert on everything the server sent, and there is nobody to
	// assert for: `ready` resolves and the removal stands.
	await page.ready;
	assert.equal(toHtml(document.body), '<body></body>');
});

test('hydrating() answers for the mount that is running, not for the page', async () => {
	// The three answers `suspend` depends on: outside every mount, inside a plain mount made while
	// a hydration is open elsewhere, and inside a component that mounts late into the hydrated root.
	assert.equal(hydrating(), false, 'outside every mount there is nothing to be inside');

	let seen: Record<string, boolean> = {};
	const Probe = (props: { name?: string }): unknown => {
		seen[String(props.name)] = hydrating();
		return h('span', {}, String(props.name));
	};

	const { server, client, settle } = twoSides(() => h(Probe, { name: 'late' }));
	const markup = await render(h(server));
	const document = createDocument();
	document.body.innerHTML = markup;

	seen = {};
	const page = hydrate(document.body, h(client));

	// Another root entirely, mounted while the hydration above is still open for its load.
	const other = createDocument();
	const stop = mount(other.body, h(Probe, { name: 'plain' }));
	assert.equal(seen['plain'], false, 'a plain mount on another root is no part of that hydration');

	settle();
	await page.ready;
	assert.equal(seen['late'], true, 'a component mounted late inside the hydrated root still is one');

	stop();
	page();
});

test('a mismatch found after the wait reaches the host rather than a promise nobody reads', () => {
	// In its own process: the guarantee is that the host reports it, and a test runner catches an
	// uncaught error before the host can, so asserting it in process would assert nothing.
	const run = spawnSync(process.execPath, [
		'--import', '@aweftjs/build/loader',
		'packages/dom/tests/fixtures/late-mismatch.ts',
	], { cwd: fileURLToPath(new URL('../../../', import.meta.url)), encoding: 'utf8' });

	assert.equal(run.status, 3, 'the mismatch reached the host rather than nowhere');
	assert.match(run.stderr, /hydration mismatch: the server sent/);
	assert.match(run.stdout, /^READY:resolved$/m, 'and `ready` resolved rather than rejecting');
});
