// Components: props and children, the deferred body, cleanup, mounted, pending, context.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createArray, mutable, mutableArray } from '@aweftjs/core';

import type { Cleanup, Mounted, Pending } from '../src/index.ts';
import { createDocument, getFirst, h, html, mount, toHtml } from '../src/index.ts';

test('a component gets its props with children as an array, and its result is mounted', () => {
	const doc = createDocument();
	let seen: unknown;
	const Box = (props: { title?: string; children: unknown[] }) => {
		seen = props;
		return h('section', { title: props.title }, ...props.children);
	};
	mount(doc.body, h(Box, { title: 't' }, 'a', h('i')));
	assert.deepEqual(Object.keys(seen as object), ['title', 'children']);
	assert.equal((seen as { children: unknown[] }).children.length, 2);
	assert.equal(toHtml(doc.body), '<body><section title="t">a<i></i></section></body>');
	mount(doc.body, h(Box));
	assert.equal(toHtml(doc.body), '<body><section title="t">a<i></i></section><section></section></body>');
});

test('the body runs after the walk, and siblings mount in document order', () => {
	const doc = createDocument();
	const order: string[] = [];
	const A = () => { order.push('A'); return 'a'; };
	const B = () => { order.push('B'); return h('b', {}, h(A)); };
	order.push('before');
	mount(doc.body, [h(A), 'mid', h(B)]);
	order.push('after');
	assert.deepEqual(order, ['before', 'A', 'B', 'A', 'after']);
	assert.equal(toHtml(doc.body), '<body>amid<b>a</b></body>');
});

test('mounted runs after the component and its descendants are in place, children first', () => {
	const doc = createDocument();
	const order: string[] = [];
	const Leaf = ({ name }: { name: string }, _c: Cleanup, mounted: Mounted) => {
		mounted(() => order.push(`mounted ${name} ${doc.body.textContent}`));
		return name;
	};
	const Tree = (_p: unknown, _c: Cleanup, mounted: Mounted) => {
		mounted(() => order.push(`mounted tree ${doc.body.textContent}`));
		return h('div', {}, h(Leaf, { name: 'x' }), h(Leaf, { name: 'y' }));
	};
	mount(doc.body, h(Tree));
	assert.deepEqual(order, ['mounted x xy', 'mounted y xy', 'mounted tree xy']);
	mount(doc.body, h((_p: unknown, _c: Cleanup, mounted: Mounted) => {
		mounted(() => order.push('late registration is fine while mounting'));
		return null;
	}));
	assert.equal(order.length, 4);
});

test('cleanup runs after unmount, descendants first, and at once when already unmounted', () => {
	const doc = createDocument();
	const order: string[] = [];
	let lateCleanup: Cleanup | null = null;
	const Inner = (_p: unknown, cleanup: Cleanup) => {
		cleanup(() => order.push('inner'));
		return 'in';
	};
	const Outer = (_p: unknown, cleanup: Cleanup) => {
		lateCleanup = cleanup;
		cleanup(() => order.push('outer 1'), () => order.push('outer 2'));
		return h('div', {}, h(Inner));
	};
	const stop = mount(doc.body, h(Outer));
	stop();
	assert.deepEqual(order, ['inner', 'outer 1', 'outer 2']);
	lateCleanup!(() => order.push('late'));
	assert.deepEqual(order, ['inner', 'outer 1', 'outer 2', 'late']);
	stop();
	assert.deepEqual(order.length, 4, 'a second removal runs nothing again');
});

test('mounted is refused after mounting, and a component removed before its body never runs', () => {
	const doc = createDocument();
	let escaped: Mounted | null = null;
	mount(doc.body, h((_p: unknown, _c: Cleanup, mounted: Mounted) => { escaped = mounted; return null; }));
	assert.throws(() => escaped!(() => undefined), /while the component is mounting/);

	let ran = false;
	const Late = () => { ran = true; return 'late'; };
	const Host = () => {
		const stop = mount(doc.body, h(Late));
		stop();
		return null;
	};
	mount(doc.body, h(Host));
	assert.equal(ran, false);
	assert.equal(toHtml(doc.body), '<body></body>');
});

test('a throwing body names the component, the rest still mounts, and the queue survives', () => {
	const doc = createDocument();
	const Bad = () => { throw new Error('boom'); };
	const Good = () => 'good';
	assert.throws(() => mount(doc.body, [h(Bad), h(Good)]), /in Bad: boom/);
	assert.equal(toHtml(doc.body), '<body>good</body>');
	mount(doc.body, h(Good));
	assert.equal(toHtml(doc.body), '<body>goodgood</body>', 'the next mount works');

	const anonymous = () => { throw new Error('anon'); };
	assert.throws(() => mount(doc.body, h(anonymous)), /in anonymous: anon/);
	assert.throws(() => mount(doc.body, h(() => { throw new Error('inline'); })), /in an anonymous component: inline/);
});

test('a component may return a mounter, and the context flows through it', () => {
	const doc = createDocument();
	const heard: unknown[] = [];
	const Provider = ({ children }: { children: unknown[] }) =>
		(elem: typeof doc.body, _item: unknown, before: (a: typeof getFirst) => unknown, context: Record<string, unknown> | undefined) =>
			mount(elem, children, before as never, { ...context, depth: (context?.['depth'] as number ?? 0) + 1 });
	const Reader = () => (elem: typeof doc.body, _i: unknown, before: (a: typeof getFirst) => unknown, context: unknown) => {
		heard.push(context);
		return mount(elem, 'r', before as never, context);
	};
	mount(doc.body, h(Provider, {}, h(Provider, {}, h(Reader))), undefined, { app: 1 });
	assert.deepEqual(heard, [{ app: 1, depth: 2 }]);
	assert.equal(toHtml(doc.body), '<body>r</body>');
});

test('each with a document array, a cell, and a mutable array passes each item as props.each', () => {
	const doc = createDocument();
	const rows = createArray<string>(['a']);
	const Name = ({ each, tag }: { each: string; tag: string }) => h(tag, {}, each);
	mount(doc.body, [h(Name, { each: rows, tag: 'i' }), h(Name, { each: mutable(['m']), tag: 'b' }), h(Name, { each: mutableArray(['x']), tag: 'u' })]);
	rows.push('b');
	assert.equal(toHtml(doc.body), '<body><i>a</i><i>b</i><b>m</b><u>x</u></body>');
});

test('pending is tracked by the root; on a page nothing waits on it', async () => {
	const doc = createDocument();
	let resolve: () => void = () => undefined;
	const Loader = (_p: unknown, _c: Cleanup, _m: Mounted, pending: Pending) => {
		pending(new Promise<void>((r) => { resolve = r; }));
		return 'loading';
	};
	mount(doc.body, h(Loader));
	assert.equal(toHtml(doc.body), '<body>loading</body>');
	resolve();
	await Promise.resolve();
});

test('a mutation made from a cleanup during a commit-driven removal does not corrupt the list', () => {
	const doc = createDocument();
	const rows = createArray<string>(['a', 'b', 'c']);
	const log = mutableArray<string>();
	const Row = ({ each }: { each: string }, cleanup: Cleanup) => {
		cleanup(() => log.push(`gone ${each}`));
		return h('li', {}, each);
	};
	mount(doc.body, [h('ul', {}, h(Row, { each: rows })), h('p', {}, log)]);
	rows.splice(1, 1);
	assert.equal(toHtml(doc.body), '<body><ul><li>a</li><li>c</li></ul><p>gone b</p></body>');
	rows.splice(0, 2);
	assert.equal(toHtml(doc.body), '<body><ul></ul><p>gone bgone agone c</p></body>');
});

test('html and components together: the basic counter', () => {
	const doc = createDocument();
	const count = mutable(0);
	mount(doc.body, html`
		<button $onclick=${() => count.set(count.get() + 1)}>
			Button clicked ${count} times
		</button>
		<button $onclick=${() => count.set(0)}>Reset</button>
	`);
	const [add, reset] = doc.body.children;
	add!.dispatchEvent({ type: 'click' });
	add!.dispatchEvent({ type: 'click' });
	assert.equal(toHtml(doc.body), '<body><button>Button clicked 2 times</button><button>Reset</button></body>');
	reset!.dispatchEvent({ type: 'click' });
	assert.equal(add!.textContent, 'Button clicked 0 times');
});
