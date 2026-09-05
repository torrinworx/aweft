// The behavioral corpus for the DOM binding: the hard-won cases this problem domain is known
// to contain, each stated as a requirement this binding meets. Append-only; removing a case
// needs a design note. Design 083 names the classes that do not carry over.

import test from 'node:test';
import assert from 'node:assert/strict';

import { atomic, createArray, createObject, mutable, mutableArray, observer } from '@aweftjs/core';
import { recordingDocument } from '@aweftjs/testing';

import type { Cleanup, LightElement, Mounted } from '../src/index.ts';
import { createDocument, getFirst, h, html, mount, toHtml } from '../src/index.ts';

interface Row extends Record<string, unknown> { label?: string }
const row = (label: string): Row => createObject<Row>({ label });
const Item = ({ each }: { each: Row }) => h('li', {}, observer(each).path('label'));

// --- teardown and destroy order -----------------------------------------------------------

test('destroying a list of components asks no destroyed mount for its first node', () => {
	const doc = createDocument();
	const rows = createArray<Row>([row('a'), row('b'), row('c')]);
	const stop = mount(doc.body, h('ul', {}, h(Item, { each: rows }), 'trailer'));
	stop();
	assert.equal(toHtml(doc.body), '<body></body>');
});

test('a destroyed list drops a commit that was queued before its removal', () => {
	const doc = createDocument();
	const rows = createArray<Row>([row('a')]);
	let stop: (() => void) | null = null;
	// This watcher runs first and unmounts the list; the list's own watcher then hears the
	// same commit and must do nothing with it. The list sits in the body itself, so a row it
	// wrongly mounted would show.
	observer(rows).watch(() => { stop?.(); });
	stop = mount(doc.body, h(Item, { each: rows }));
	rows.push(row('b'));
	assert.equal(toHtml(doc.body), '<body></body>');

	const local = mutableArray<string>(['a']);
	let stopLocal: (() => void) | null = null;
	local.watch(() => { stopLocal?.(); });
	stopLocal = mount(doc.body, local);
	local.push('b');
	assert.equal(toHtml(doc.body), '<body></body>');
});

test('a cleanup that edits the list being torn down by a commit cannot corrupt it', () => {
	const doc = createDocument();
	const rows = createArray<Row>([row('a'), row('b'), row('c')]);
	const Rowc = ({ each }: { each: Row }, cleanup: Cleanup) => {
		cleanup(() => { if (rows.length === 2) rows.push(row('added by cleanup')); });
		return h('li', {}, observer(each).path('label'));
	};
	mount(doc.body, h('ul', {}, h(Rowc, { each: rows })));
	rows.splice(0, 1);
	assert.equal(toHtml(doc.body), '<body><ul><li>b</li><li>c</li><li>added by cleanup</li></ul></body>');
});

test('a mount is dead before its cleanups run, so a cleanup that removes it again does nothing', () => {
	const doc = createDocument();
	let runs = 0;
	let stop: (() => void) | null = null;
	const Comp = (_p: unknown, cleanup: Cleanup) => {
		cleanup(() => { runs += 1; stop?.(); });
		return 'c';
	};
	stop = mount(doc.body, h(Comp));
	stop();
	assert.equal(runs, 1);
	assert.equal(toHtml(doc.body), '<body></body>');
});

test('asking a mount for its first node runs no cleanup', () => {
	const doc = createDocument();
	let runs = 0;
	const Comp = (_p: unknown, cleanup: Cleanup) => {
		cleanup(() => { runs += 1; });
		return h('p', {}, 'c');
	};
	const stop = mount(doc.body, h(Comp));
	assert.equal((stop(getFirst) as LightElement).localName, 'p');
	assert.equal(runs, 0);
});

test('unmounting an element unbinds every reactive part below it, however deep', () => {
	const doc = createDocument();
	const deep = mutable('x');
	const stop = mount(doc.body, h('div', {}, h('section', {}, h('p', {}, h('b', { title: deep }, deep)))));
	stop();
	const before = toHtml(doc.body);
	deep.set('y');
	assert.equal(toHtml(doc.body), before);
	assert.equal(before, '<body></body>');
});

test('a cleanup runs after the element has left the document', () => {
	const doc = createDocument();
	let connected: boolean | null = null;
	const Comp = (_p: unknown, cleanup: Cleanup) => {
		const p = h('p', {}, 'c') as LightElement;
		cleanup(() => { connected = p.isConnected; });
		return p;
	};
	const stop = mount(doc.body, h(Comp));
	stop();
	assert.equal(connected, false);
});

// --- reentrancy and deferral ---------------------------------------------------------------

test('a component that edits a sibling list while it mounts does not corrupt the tree', () => {
	const doc = createDocument();
	const log = mutableArray<string>();
	const Loud = ({ name }: { name: string }) => {
		log.push(`${name} mounted`);
		return h('i', {}, name);
	};
	mount(doc.body, [h('ul', {}, log), h(Loud, { name: 'a' }), h(Loud, { name: 'b' })]);
	assert.equal(toHtml(doc.body), '<body><ul>a mountedb mounted</ul><i>a</i><i>b</i></body>');
});

test('overwriting a list from a cleanup while its clear is in progress lands after the clear', () => {
	const doc = createDocument();
	const items = mutable<unknown[]>([]);
	const Rowc = ({ each }: { each: string }, cleanup: Cleanup) => {
		cleanup(() => { if (items.get().length === 0) items.set(['after']); });
		return h('li', {}, each);
	};
	mount(doc.body, h('ul', {}, h(Rowc, { each: items })));
	items.set(['a', 'b']);
	items.set([]);
	assert.equal(toHtml(doc.body), '<body><ul><li>after</li></ul></body>');
});

test('a component that throws while mounting never has its mounted callbacks run', () => {
	const doc = createDocument();
	let ran = false;
	const Bad = (_p: unknown, _c: Cleanup, mounted: Mounted) => {
		mounted(() => { ran = true; });
		throw new Error('nope');
	};
	assert.throws(() => mount(doc.body, h(Bad)), /nope/);
	assert.equal(ran, false);
});

test('every list pass has its own mounted bookkeeping: nested lists fire each callback once', () => {
	const doc = createDocument();
	const fired: string[] = [];
	const Leaf = ({ each }: { each: string }, _c: Cleanup, mounted: Mounted) => {
		mounted(() => fired.push(each));
		return each;
	};
	const Branch = ({ each }: { each: string[] }) => h('div', {}, h(Leaf, { each }));
	mount(doc.body, h(Branch, { each: [['a', 'b'], ['c']] }));
	assert.deepEqual(fired.sort(), ['a', 'b', 'c']);
});

test('an item inserted into an already mounted list gets its mounted callback', () => {
	const doc = createDocument();
	const fired: string[] = [];
	const rows = createArray<string>(['a']);
	const Leaf = ({ each }: { each: string }, _c: Cleanup, mounted: Mounted) => {
		mounted(() => fired.push(each));
		return each;
	};
	mount(doc.body, h(Leaf, { each: rows }));
	rows.push('b');
	assert.deepEqual(fired, ['a', 'b']);
});

test('a throw from one row of a list update leaves the list usable', () => {
	const doc = createDocument();
	const rows = createArray<string>(['ok']);
	const Rowc = ({ each }: { each: string }) => {
		if (each === 'bad') throw new Error('bad row');
		return h('li', {}, each);
	};
	mount(doc.body, h('ul', {}, h(Rowc, { each: rows })));
	assert.throws(() => rows.push('bad'), /bad row/);
	rows.push('fine');
	rows.splice(1, 1);
	assert.equal(toHtml(doc.body), '<body><ul><li>ok</li><li>fine</li></ul></body>');
});

// --- list reconciliation, ordering and anchors ---------------------------------------------

test('a remove and inserts at the same edge in one commit keep document order', () => {
	const doc = createDocument();
	const rows = createArray<string>(['a', 'b', 'c', 'd']);
	mount(doc.body, h('ul', {}, rows));
	atomic(() => {
		rows.splice(1, 1);
		rows.splice(1, 0, 'x', 'y');
		rows[0] = 'A';
	});
	assert.equal(toHtml(doc.body), '<body><ul>Axycd</ul></body>');
	atomic(() => {
		rows.splice(0, 2);
		rows.push('e');
		rows.unshift('s');
	});
	assert.equal(toHtml(doc.body), '<body><ul>sycde</ul></body>');
});

test('moving a row onto its own position does nothing to the tree', () => {
	const { document, ops } = recordingDocument();
	const a = h('p', {}, 'a');
	const b = h('p', {}, 'b');
	const items = mutable([a, b]);
	mount(document.body, items);
	ops.length = 0;
	items.set([a, b]);
	assert.deepEqual(ops, []);
});

test('reordering with nulls and repeated primitives terminates and lands in order', () => {
	const doc = createDocument();
	const items = mutable<unknown[]>(['x', null, 'x', 'y']);
	mount(doc.body, items);
	items.set(['y', 'x', null, null, 'x']);
	assert.equal(toHtml(doc.body), '<body>yxx</body>');
	items.set([null]);
	assert.equal(toHtml(doc.body), '<body></body>');
});

test('a row whose body adds to its own list mid-create keeps every row in order', () => {
	const doc = createDocument();
	const rows = createArray<Row>([row('a'), row('b'), row('c')]);
	const Item = ({ each }: { each: Row }) => {
		if (each.label === 'b') rows.push(row('d'));
		return h('li', {}, observer(each).path('label'));
	};
	mount(doc.body, h('ul', {}, h(Item, { each: rows })));
	assert.equal(toHtml(doc.body), '<body><ul><li>a</li><li>b</li><li>c</li><li>d</li></ul></body>');
	rows.push(...[row('e'), row('f')]);
	assert.equal(doc.body.children[0]!.textContent, 'abcdef');
});

test('a row filled from a later row\'s body, during the same create, lands in its own place', () => {
	const doc = createDocument();
	const slot = mutable<unknown>(null);
	const rows = createArray<Row>([row('a'), row('b'), row('c')]);
	const Item = ({ each }: { each: Row }) => {
		if (each.label === 'a') return slot;
		if (each.label === 'c') slot.set(h('i', {}, 'A'));
		return h('li', {}, observer(each).path('label'));
	};
	mount(doc.body, h('ul', {}, h(Item, { each: rows })));
	assert.equal(toHtml(doc.body), '<body><ul><i>A</i><li>b</li><li>c</li></ul></body>');
});

test('a sibling mounted after a deferred component lands after where the component will go', () => {
	const doc = createDocument();
	const Late = () => h('b', {}, 'late');
	mount(doc.body, h('div', {}, h(Late), 'after', h(Late)));
	assert.equal(toHtml(doc.body), '<body><div><b>late</b>after<b>late</b></div></body>');
});

test('an empty document array is mounted and subscribed, and fills like a full one', () => {
	const { document, ops } = recordingDocument();
	const rows = createArray<string>();
	mount(document.body, h('ul', {}, rows, 'tail'));
	ops.length = 0;
	rows.push('a');
	assert.deepEqual(ops, ['insert "a" into <ul> before "tail"']);
});

test('each accepts any iterable, and an iterable with no length works', () => {
	const doc = createDocument();
	const Name = ({ each }: { each: string }) => h('i', {}, each);
	function* names(): Generator<string> { yield 'g1'; yield 'g2'; }
	mount(doc.body, [h(Name, { each: new Set(['s1']) }), h(Name, { each: names() }), h(Name, { each: mutable(new Set(['c1'])) })]);
	assert.equal(toHtml(doc.body), '<body><i>s1</i><i>g1</i><i>g2</i><i>c1</i></body>');
});

test('a component list over a cell answers first-node queries through the live list', () => {
	const doc = createDocument();
	const names = mutable(['a']);
	const Name = ({ each }: { each: string }) => h('i', {}, each);
	const stop = mount(doc.body, h(Name, { each: names }));
	assert.equal(stop(getFirst), doc.body.firstChild);
	names.set([]);
	assert.equal(stop(getFirst), null, 'an empty list answers its anchor');
	names.set(['b']);
	assert.equal((stop(getFirst) as LightElement).textContent, 'b');
});

test('a removed list stays out of the source: later edits reach nothing and hold nothing', () => {
	const doc = createDocument();
	const rows = createArray<string>(['a']);
	const local = mutableArray<string>(['x']);
	const stop = mount(doc.body, [rows, local]);
	stop();
	rows.push('b');
	local.push('y');
	assert.equal(toHtml(doc.body), '<body></body>');
});

test('a swap keeps the rows themselves, so an input inside keeps what it holds', () => {
	const doc = createDocument();
	const rows = createArray<Row>([row('a'), row('b')]);
	const Field = ({ each }: { each: Row }) => h('input', { $value: observer(each).path('label') });
	mount(doc.body, h(Field, { each: rows }));
	const [first] = doc.body.children;
	first!['value'] = 'typed by the user';
	atomic(() => {
		const t = rows[0]!;
		rows[0] = rows[1]!;
		rows[1] = t;
	});
	assert.equal(doc.body.children[1], first);
	assert.equal(first!['value'], 'typed by the user');
});

// --- idempotent removal and a hostile DOM --------------------------------------------------

test('removing a node mount, a text mount or a null mount twice is a no-op', () => {
	const doc = createDocument();
	const node = mount(doc.body, h('p'));
	const text = mount(doc.body, 'text');
	const empty = mount(doc.body, null);
	const after = mount(doc.body, h('i'));
	node(); node();
	text(); text();
	empty(); empty();
	assert.equal(toHtml(doc.body), '<body><i></i></body>');
	after();
	assert.equal(toHtml(doc.body), '<body></body>');
});

test('a removal after something else took the node does not crash', () => {
	const doc = createDocument();
	const cell = mutable<unknown>('t');
	const stopText = mount(doc.body, cell);
	const stopNode = mount(doc.body, h('p', {}, mutable('inner')));
	// A browser extension, or a parent cleared by the application.
	doc.body.textContent = '';
	stopText();
	stopNode();
	cell.set('late');
	assert.equal(toHtml(doc.body), '<body></body>');
});

test('replacing a text mount\'s content keeps tracking the node that is live', () => {
	const doc = createDocument();
	const cell = mutable<unknown>('a');
	mount(doc.body, cell);
	cell.set(h('i'));
	cell.set('b');
	const live = doc.body.firstChild as LightElement;
	cell.set('c');
	assert.equal(doc.body.firstChild, live);
	assert.equal(live.textContent, 'c');
});

// --- the fast clear -------------------------------------------------------------------------

test('a list that is not the whole parent never clears the parent', () => {
	const { document, ops } = recordingDocument();
	const rows = createArray<string>(['a', 'b']);
	mount(document.body, h('ul', {}, 'head', rows));
	ops.length = 0;
	rows.splice(0, 2);
	assert.ok(!ops.some((op) => op.startsWith('clear')), ops.join(' | '));
	assert.equal(toHtml(document.body), '<body><ul>head</ul></body>');
});

test('a nested list under a cleared row stays quiet afterwards', () => {
	const doc = createDocument();
	const outer = createArray<Row>([row('r')]);
	const inner = createArray<string>(['i']);
	const Outer = ({ each }: { each: Row }) => h('li', {}, observer(each).path('label'), h('ul', {}, inner));
	mount(doc.body, h('ul', {}, h(Outer, { each: outer })));
	outer.splice(0, 1);
	inner.push('late');
	inner.splice(0, 2);
	assert.equal(toHtml(doc.body), '<body><ul></ul></body>');
});

// --- values, props and attributes ----------------------------------------------------------

test('falsy primitives render as text, null renders nothing, undefined is refused', () => {
	const doc = createDocument();
	mount(doc.body, [0, false, '', null]);
	assert.equal(doc.body.childNodes.length, 3);
	assert.equal(toHtml(doc.body), '<body>0false</body>');
	assert.throws(() => mount(doc.body, [undefined]), /undefined/);
});

test('a property set to undefined stays undefined until the DOM boundary', () => {
	const doc = createDocument();
	mount(doc.body, h('input', { $value: undefined, $custom: undefined }));
	const input = doc.body.firstChild as LightElement;
	assert.equal(input['value'], undefined);
	assert.ok('custom' in input);
});

test('an array-valued property is a value, not a set of nested bindings', () => {
	const doc = createDocument();
	const list = [1, 2];
	mount(doc.body, h('div', { $data: list }));
	assert.equal((doc.body.firstChild as LightElement)['data'], list);
});

test('a bound element as a child of another element is one tree, and a node is not mutated by mounting', () => {
	const doc = createDocument();
	const cell = mutable('v');
	const inner = h('span', { title: cell });
	const own = doc.createElement('em');
	const keys = Object.keys(own);
	mount(doc.body, h('div', {}, inner, own));
	assert.equal(toHtml(doc.body), '<body><div><span title="v"></span><em></em></div></body>');
	assert.deepEqual(Object.keys(own), keys, 'nothing was written onto the application node');
	assert.deepEqual(Object.getOwnPropertySymbols(own), []);
	cell.set('w');
	assert.equal(toHtml(doc.body), '<body><div><span title="w"></span><em></em></div></body>');
});

test('replacing one mounted node by another moves the bindings to the new node only', () => {
	const doc = createDocument();
	const title = mutable('t');
	const which = mutable<unknown>(h('a', { title }));
	mount(doc.body, which);
	const first = doc.body.firstChild as LightElement;
	which.set(h('b', { title }));
	const second = doc.body.firstChild as LightElement;
	title.set('u');
	assert.equal(second.getAttribute('title'), 'u');
	assert.equal(first.getAttribute('title'), 't', 'the old node is no longer bound');
});

test('a bound subtree is built before it is inserted, so nothing lands one node at a time', () => {
	const { document, ops } = recordingDocument();
	const cell = mutable('x');
	mount(document.body, h('p', {}, cell, h('i', {}, cell)));
	assert.deepEqual(ops.slice(-1), ['insert <p> into <body> before end']);
	assert.ok(ops.slice(0, -1).every((op) => !op.includes('<body>')), ops.join(' | '));
});

// --- state pollution and memory -----------------------------------------------------------

test('mounting writes nothing onto core observables or onto the hooks it is handed', () => {
	const doc = createDocument();
	const rows = createArray<Row>([row('a')]);
	const cleanupFn = () => undefined;
	const Comp = ({ each }: { each: Row }, cleanup: Cleanup) => {
		cleanup(cleanupFn);
		return h('li', {}, observer(each).path('label'));
	};
	mount(doc.body, h(Comp, { each: rows }));
	assert.deepEqual(Object.keys(rows[0]!), ['label']);
	assert.deepEqual(Object.getOwnPropertySymbols(rows[0]!), []);
	assert.deepEqual(Object.getOwnPropertySymbols(rows), []);
	assert.deepEqual(Object.keys(cleanupFn), []);
});

test('no document is captured at load: the page has none here and everything still works', () => {
	assert.equal(typeof (globalThis as { document?: unknown }).document, 'undefined');
	const doc = createDocument();
	mount(doc.body, html`<p>${'works'}</p>`);
	assert.equal(toHtml(doc.body), '<body><p>works</p></body>');
});

// --- context ----------------------------------------------------------------------------------

test('the binding never reads the context: one that refuses every read still arrives whole', () => {
	const doc = createDocument();
	const refuse = (): never => { throw new Error('the binding read the context'); };
	const context = new Proxy({}, { get: refuse, has: refuse, ownKeys: refuse, getPrototypeOf: refuse, getOwnPropertyDescriptor: refuse });
	let heard: unknown;
	const Reader = () => (elem: LightElement, _i: unknown, before: (a: typeof getFirst) => unknown, ctx: unknown) => {
		heard = ctx;
		return mount(elem, 'r', before as never, ctx);
	};
	const rows = createArray<Row>([row('a')]);
	const Item = ({ each }: { each: Row }) => h('li', {}, observer(each).path('label'), h(Reader));
	mount(doc.body, h('ul', {}, h(Item, { each: rows })), undefined, context);
	rows.push(row('b'));
	assert.equal(heard, context);
	assert.equal(toHtml(doc.body), '<body><ul><li>ar</li><li>br</li></ul></body>');
});

test('the mount context reaches a component under a raw element', () => {
	const doc = createDocument();
	let heard: unknown;
	const Reader = () => (elem: LightElement, _i: unknown, before: (a: typeof getFirst) => unknown, context: unknown) => {
		heard = context;
		return mount(elem, 'r', before as never, context);
	};
	mount(doc.body, h('div', {}, h('p', {}, h(Reader))), undefined, { site: 1 });
	assert.deepEqual(heard, { site: 1 });
});
