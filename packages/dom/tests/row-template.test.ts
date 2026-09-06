// The row template and the hydration recording gate: what designs 098 and 099 promise, and
// what they cost. Everything here goes through the public exports, as a page would.

import test from 'node:test';
import assert from 'node:assert/strict';
import v8 from 'node:v8';
import vm from 'node:vm';

import { createArray, createObject, observer } from '@aweftjs/core';
import { recordingDocument } from '@aweftjs/testing';

import type { Cleanup, LightElement, Mounted } from '../src/index.ts';
import { createDocument, h, hydrate, mount, render, toHtml } from '../src/index.ts';

interface Row extends Record<string, unknown> { label?: string; cls?: string }
const row = (label: string, cls?: string): Row => createObject<Row>(cls === undefined ? { label } : { label, cls });

test('a row after the first is cloned, so what the first row wrote is not written again', () => {
	const { document, ops } = recordingDocument();
	const rows = createArray<Row>([row('a')]);
	const Item = ({ each }: { each: Row }) =>
		h('li', { class: 'row' }, h('span', { class: 'tag' }, 'x'), observer(each).path('label'));
	mount(document.body, h('ul', {}, h(Item, { each: rows })));
	assert.ok(ops.some((op) => op.startsWith('attr class="row"')), 'the first row writes its attributes');

	ops.length = 0;
	rows.push(row('b'));
	assert.deepEqual(ops.filter((op) => op.startsWith('attr ')), [], 'a cloned row writes no attribute the first row already wrote');
	assert.equal(
		toHtml(document.body),
		'<body><ul><li class="row"><span class="tag">x</span>a</li><li class="row"><span class="tag">x</span>b</li></ul></body>',
	);
});

test('a value that differs per row is written onto the clone', () => {
	const document = createDocument();
	const rows = createArray<Row>([row('a', 'first'), row('b', 'second'), row('c', 'third')]);
	const Item = ({ each }: { each: Row }) => h('li', { class: each['cls'] }, String(each['label']));
	mount(document.body, h('ul', {}, h(Item, { each: rows })));
	assert.equal(
		toHtml(document.body),
		'<body><ul><li class="first">a</li><li class="second">b</li><li class="third">c</li></ul></body>',
	);
});

test('the template is one per call site, not one per component', () => {
	const document = createDocument();
	const left = createArray<Row>([row('a'), row('b')]);
	const right = createArray<Row>([row('c'), row('d')]);
	// The same component at two call sites, where a prop of the list decides the markup. A cache
	// keyed on the component function hands the second list the first list's row.
	const Cell = ({ each, tag }: { each: Row; tag: string }) => h(tag, {}, observer(each).path('label'));
	mount(document.body, h('ul', {}, h(Cell, { each: left, tag: 'li' })));
	mount(document.body, h('div', {}, h(Cell, { each: right, tag: 'p' })));
	assert.equal(
		toHtml(document.body),
		'<body><ul><li>a</li><li>b</li></ul><div><p>c</p><p>d</p></div></body>',
	);
});

test('a component whose shape varies per row still renders, and its callbacks fire once each', () => {
	const document = createDocument();
	const seen: string[] = [];
	const rows = createArray<Record<string, unknown>>([
		createObject({ n: 0 }), createObject({ n: 1 }), createObject({ n: 2 }), createObject({ n: 3 }),
	]);
	// Breaks the shape contract deliberately: an even row is an element and an odd row is text.
	// The binding sees the break on row 1 and stops templating this call site.
	let runs = 0;
	const Mixed = ({ each }: { each: Record<string, unknown> }, cleanup: Cleanup, mounted: Mounted) => {
		runs += 1;
		mounted(() => seen.push(`up ${each['n']}`));
		cleanup(() => seen.push(`down ${each['n']}`));
		return (each['n'] as number) % 2 === 0 ? h('li', {}, `row ${each['n']}`) : `row ${each['n']}`;
	};
	const stop = mount(document.body, h('ul', {}, h(Mixed, { each: rows })));
	assert.equal(toHtml(document.body), '<body><ul><li>row 0</li>row 1<li>row 2</li>row 3</ul></body>');
	assert.deepEqual(seen, ['up 0', 'up 1', 'up 2', 'up 3'], 'a row whose body ran twice still mounts once');
	// Four rows and one second run: row 1 broke the shape and the call site stopped cloning
	// there, so rows 2 and 3 each ran once. Leaving it on would cost row 3 a second run too.
	assert.equal(runs, 5, 'only the row that broke the shape pays a second run');

	seen.length = 0;
	stop();
	assert.deepEqual(seen, ['down 0', 'down 1', 'down 2', 'down 3'], 'and it cleans up once');
});

test('a list of components renders statically and hydrates in place', async () => {
	const rows = createArray<Row>([row('a'), row('b'), row('c')]);
	const Item = ({ each }: { each: Row }) => h('li', { class: 'row' }, observer(each).path('label'));
	const App = () => h('ul', {}, h(Item, { each: rows }));
	const markup = await render(h(App));

	const document = createDocument();
	document.body.innerHTML = markup;
	const ul = (document.body as LightElement).children[0]!;
	const server = ul.children.slice();
	hydrate(document.body, h(App));
	assert.deepEqual((ul as LightElement).children, server, 'the server rows are adopted, not rebuilt');

	rows[1]!['label'] = 'B';
	assert.equal(server[1]!.textContent, 'B', 'and the adopted rows are live');
});

test('a node built under a mount is not claimed by a later hydrate; one built outside still is', async () => {
	const document = createDocument();
	let inside: unknown;
	const Grab = (): unknown => {
		inside = h('p', {}, 'x');
		return inside;
	};
	const kept = mount(document.createElement('div'), h(Grab, {}));
	kept();
	const markup = await render(h('p', {}, 'x'));

	// The cost design 098 names: the binding no longer knows it made this node, so hydration
	// treats it as the application's and inserts it over the server's.
	const target = document.createElement('div');
	target.innerHTML = markup;
	hydrate(target, inside);
	assert.equal(target.firstChild, inside, 'a node built under a mount is inserted, not claimed');

	const outside = h('p', {}, 'x');
	const other = document.createElement('div');
	other.innerHTML = markup;
	const rendered = other.firstChild;
	hydrate(other, outside);
	assert.equal(other.firstChild, rendered, 'a node built outside every mount is still claimed');
	assert.notEqual(other.firstChild, outside);
});

test('a reactive child in a cloned row lands before its static neighbour', () => {
	const document = createDocument();
	const rows = createArray<Row>([row('a'), row('b')]);
	const Item = ({ each }: { each: Row }) => h('li', {}, '#', observer(each).path('label'), '!');
	mount(document.body, h('ul', {}, h(Item, { each: rows })));
	assert.equal(toHtml(document.body), '<body><ul><li>#a!</li><li>#b!</li></ul></body>');
});

test('a row that brings in a node from outside is never templated', () => {
	const document = createDocument();
	// There is only one of this node, so no row after the first may hold a copy of it.
	const own = document.createElement('canvas');
	const rows = createArray<Row>([row('a'), row('b')]);
	const Item = ({ each }: { each: Row }) => h('li', {}, own, observer(each).path('label'));
	mount(document.body, h('ul', {}, h(Item, { each: rows })));
	const markup = toHtml(document.body);
	assert.equal(markup.split('<canvas>').length - 1, 1, `the application node is in the page once: ${markup}`);
});

test('a row built on an element the application made is never templated either', () => {
	const document = createDocument();
	const own = document.createElement('li');
	const rows = createArray<Row>([row('a'), row('b')]);
	// `h` takes an existing node as its tag, so the row's own root is the application's node.
	// Refusing to template it means the second row meets the binding's existing refusal to mount
	// one node twice, rather than quietly being handed a copy of the application's element.
	const Item = ({ each }: { each: Row }) => h(own, { class: 'row' }, observer(each).path('label'));
	assert.throws(
		() => mount(document.body, h('ul', {}, h(Item, { each: rows }))),
		/cannot mount a node that is already mounted elsewhere/,
	);
});

test('a row that calls h a different number of times asserts, naming both counts', () => {
	const document = createDocument();
	const rows = createArray<Row>([row('a'), row('b')]);
	// The first row makes one element, the second makes two. Nothing lines up after that.
	const Item = ({ each }: { each: Row }) =>
		h('li', {}, each['label'] === 'a' ? 'plain' : h('b', {}, 'bold'));
	assert.throws(
		() => mount(document.body, h('ul', {}, h(Item, { each: rows }))),
		/call h the same number of times on every row: the first row made 1 and this one made 2/,
	);
});

test('a row that mounts into a node of its own is not templated', () => {
	const document = createDocument();
	const rows = createArray<Row>([row('a'), row('b')]);
	// The body writes into the row through `mount`, which a clone would freeze as it stands.
	const Item = ({ each }: { each: Row }) => {
		const box = h('div', {}) as never;
		mount(box, observer(each).path('label'));
		return h('li', {}, box);
	};
	mount(document.body, h('ul', {}, h(Item, { each: rows })));
	assert.equal(toHtml(document.body), '<body><ul><li><div>a</div></li><li><div>b</div></li></ul></body>');
});

test('a row that makes an element it does not use is not templated', () => {
	const document = createDocument();
	const kept: unknown[] = [];
	const rows = createArray<Row>([row('a'), row('b')]);
	// `h` under a replay builds nothing and answers a marker, so a body that keeps what `h`
	// returned would be handed that marker. The first row giving up its template prevents it.
	const Item = ({ each }: { each: Row }) => {
		kept.push(h('em', {}));
		return h('li', {}, String(each['label']));
	};
	mount(document.body, h('ul', {}, h(Item, { each: rows })));
	assert.equal(toHtml(document.body), '<body><ul><li>a</li><li>b</li></ul></body>');
	assert.equal(kept.length, 2);
	for (const node of kept) assert.equal(typeof node, 'object', `h answered ${String(node)}`);
});

test('a cloned row writes its own properties, static, reactive and through $style', () => {
	const document = createDocument();
	const rows = createArray<Row>([row('a', 'red'), row('b', 'blue')]);
	const Item = ({ each }: { each: Row }) => h('li', {
		$title: String(each['label']),
		$style: { color: String(each['cls']) },
		$id: observer(each).path('label'),
	}, String(each['label']));
	mount(document.body, h('ul', {}, h(Item, { each: rows })));
	const [first, second] = (document.body as LightElement).children[0]!.children;
	assert.equal(first!['title'], 'a');
	assert.equal(second!['title'], 'b', 'a property is written on every row, because a clone carries none');
	assert.equal(second!.style.cssText, 'color: blue;');
	assert.equal(second!['id'], 'b', 'and a reactive property binds on the clone');

	rows[1]!['label'] = 'B';
	assert.equal(second!['id'], 'B', 'and stays bound');
});

test('the template holds no source from the row it was recorded on', async () => {
	// A template lives as long as its call site, so anything it keeps outlives every row. The
	// first row's own observers are the thing it must not keep.
	v8.setFlagsFromString('--expose-gc');
	const collect = vm.runInNewContext('gc') as () => void;
	v8.setFlagsFromString('--no-expose-gc');

	const document = createDocument();
	const rows = createArray<Row>([row('a'), row('b')]);
	let first: WeakRef<object> | null = null;
	const Item = ({ each }: { each: Row }) => {
		const source = observer(each).path('label');
		if (first === null) first = new WeakRef(source as unknown as object);
		return h('li', { class: source }, 'x');
	};
	const stop = mount(document.body, h('ul', {}, h(Item, { each: rows })));
	stop();
	rows.splice(0, rows.length);

	await new Promise((resolve) => setTimeout(resolve, 0));
	collect();
	collect();
	assert.equal(first!.deref(), undefined, "the first row's source outlived the list");
});
