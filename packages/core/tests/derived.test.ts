// Derived values: the value surface of the chain (designs 023, 027, 028).

import test from 'node:test';
import assert from 'node:assert/strict';

import {
	all, atomic, createObject, immutable, mutable, observer,
} from '../src/index.ts';

interface Doc extends Record<string, unknown> {
	title?: string;
	width?: number;
	height?: number;
	user?: Record<string, unknown>;
}

test('map reads through the scope and recomputes on change', () => {
	const doc = createObject<Doc>({ title: 'plan' });
	const caps = observer(doc).path('title').map((v) => String(v).toUpperCase());

	assert.equal(caps.get(), 'PLAN');
	doc.title = 'draft';
	assert.equal(caps.get(), 'DRAFT');
});

test('watch delivers the new value after the commit, not during it', () => {
	const doc = createObject<Doc>({ title: 'a' });
	const seen: string[] = [];
	const order: string[] = [];

	observer(doc).watch(() => order.push('commit'));
	const stop = observer(doc).path('title').map((v) => `${v}!`).watch((v) => {
		order.push('derived');
		seen.push(v as string);
	});

	doc.title = 'b';
	assert.deepEqual(seen, ['b!']);
	// The derived flush is queued behind the commit's own deliveries (design 023).
	assert.deepEqual(order, ['commit', 'derived']);
	stop();
});

test('an atomic block is one recompute however much it writes', () => {
	const doc = createObject<Doc>({ width: 1, height: 1 });
	let runs = 0;
	const area = all([observer(doc).path('width'), observer(doc).path('height')])
		.map(([w, h]) => {
			runs += 1;
			return Number(w) * Number(h);
		});

	const seen: number[] = [];
	area.watch((v) => seen.push(v as number));
	const after = runs;

	atomic(() => {
		doc.width = 3;
		doc.height = 4;
	});

	assert.deepEqual(seen, [12]);
	assert.equal(runs, after + 1);
});

test('a diamond settles once per burst and never against half a commit', () => {
	const doc = createObject<Doc>({ width: 2, height: 3 });
	const w = observer(doc).path('width').map((v) => Number(v));
	const h = observer(doc).path('height').map((v) => Number(v));
	const seen: unknown[] = [];

	all([w, h]).map(([x, y]) => `${x}x${y}`).watch((v) => seen.push(v));

	atomic(() => {
		doc.width = 10;
		doc.height = 20;
	});

	// Never '10x3': both branches settle after the whole commit has been delivered.
	assert.deepEqual(seen, ['10x20']);
});

test('an equal value does not propagate', () => {
	const doc = createObject<Doc>({ title: 'abc' });
	let downstream = 0;
	const seen: unknown[] = [];

	const length = observer(doc).path('title').map((v) => String(v).length);
	length.map((n) => {
		downstream += 1;
		return n;
	}).watch((v) => seen.push(v));

	const runsAfterSetup = downstream;
	doc.title = 'xyz'; // same length, so the change stops at the transform
	assert.equal(downstream, runsAfterSetup);
	assert.deepEqual(seen, []);

	doc.title = 'wxyz';
	assert.deepEqual(seen, [4]);
});

test('while observed the value is cached; the transform does not run per read', () => {
	const doc = createObject<Doc>({ title: 'a' });
	let runs = 0;
	const chain = observer(doc).path('title').map((v) => {
		runs += 1;
		return v;
	});

	const stop = chain.watch(() => undefined);
	const warm = runs;
	chain.get();
	chain.get();
	assert.equal(runs, warm);
	stop();
});

test('while unobserved a shared subgraph costs its size, and only until something is written', () => {
	const doc = createObject<Doc>({ width: 2 });
	let runs = 0;
	const shared = observer(doc).path('width').map((v) => {
		runs += 1;
		return Number(v);
	});
	const sum = all([shared.map((n) => n + 1), shared.map((n) => n + 2)])
		.map(([a, b]) => Number(a) + Number(b));

	assert.equal(sum.get(), 7);
	assert.equal(runs, 1);

	// Nothing has been written since, so the idle cache is still trusted.
	assert.equal(sum.get(), 7);
	assert.equal(runs, 1);

	// Any write anywhere moves the write clock, and the next read computes again.
	doc.width = 3;
	assert.equal(sum.get(), 9);
	assert.equal(runs, 2);
});

test('unsubscribing the last watcher releases the upstream subscription', () => {
	const doc = createObject<Doc>({ title: 'a' });
	let runs = 0;
	const chain = observer(doc).path('title').map((v) => {
		runs += 1;
		return v;
	});

	const stop = chain.watch(() => undefined);
	stop();
	stop(); // letting go twice is a no-op

	const after = runs;
	doc.title = 'b';
	assert.equal(runs, after);
});

test('effect runs now and after every change, and subscribes before it reads', () => {
	const doc = createObject<Doc>({ title: 'a' });
	const seen: unknown[] = [];

	const stop = observer(doc).path('title').map((v) => v).effect((v) => seen.push(v));
	assert.deepEqual(seen, ['a']);

	doc.title = 'b';
	assert.deepEqual(seen, ['a', 'b']);
	stop();
});

test('a watcher that mutates gets a fresh delivery, not a re-entered one', () => {
	const doc = createObject<Doc>({ width: 1 });
	const seen: number[] = [];

	observer(doc).path('width').map((v) => Number(v)).watch((v) => {
		seen.push(v as number);
		if (v === 2) doc.width = 3;
	});

	doc.width = 2;
	assert.deepEqual(seen, [2, 3]);
});

test('unwrap follows a chain-valued value and retargets when it changes', () => {
	const a = mutable('left');
	const b = mutable('right');
	const which = mutable<unknown>(a);
	const seen: unknown[] = [];

	const flat = which.unwrap();
	const stop = flat.watch((v) => seen.push(v));
	assert.equal(flat.get(), 'left');

	a.set('left2');
	assert.deepEqual(seen, ['left2']);

	which.set(b);
	assert.deepEqual(seen, ['left2', 'right']);

	// The old inner subscription is released: its changes no longer arrive.
	a.set('left3');
	assert.deepEqual(seen, ['left2', 'right']);

	b.set('right2');
	assert.deepEqual(seen, ['left2', 'right', 'right2']);
	stop();
});

test('unwrap passes a plain value through', () => {
	const which = mutable<unknown>('just a string');
	assert.equal(which.unwrap().get(), 'just a string');
});

test('bool, def and defined are sugar over map', () => {
	const doc = createObject<Doc>({ title: 'x' });
	const scope = observer(doc).path('title');

	assert.equal(scope.bool('yes', 'no').get(), 'yes');
	assert.equal(scope.defined().get(), true);
	assert.equal(scope.def('fallback').get(), 'x');

	delete doc.title;
	assert.equal(scope.bool('yes', 'no').get(), 'no');
	assert.equal(scope.defined().get(), false);
	assert.equal(scope.def('fallback').get(), 'fallback');
});

test('map is read-only until a setter is declared', () => {
	const doc = createObject<Doc>({ width: 4 });
	const scope = observer(doc).path('width');
	const doubled = scope.map((v) => Number(v) * 2);

	assert.equal(doubled.isImmutable(), true);
	assert.throws(() => doubled.set(10), /read-only/);

	const writable = doubled.setter((v) => scope.set(Number(v) / 2));
	assert.equal(writable.isImmutable(), false);
	writable.set(10);
	assert.equal(doc.width, 5);
	assert.equal(writable.get(), 10);
});

test('a scope reads as writable, and immutability propagates through derivation', () => {
	const doc = createObject<Doc>({ title: 'a' });
	const scope = observer(doc).path('title');

	assert.equal(scope.isImmutable(), false);
	assert.equal(immutable(scope).isImmutable(), true);
	assert.equal(immutable(scope).map((v) => v).isImmutable(), true);
});

test('all mixes scopes, cells, chains and plain values, in order', () => {
	const doc = createObject<Doc>({ width: 2 });
	const factor = mutable(10);

	const combined = all([
		observer(doc).path('width'),
		factor,
		factor.map((f) => f + 1),
		'constant',
	]);

	assert.deepEqual(combined.get(), [2, 10, 11, 'constant']);

	const seen: unknown[] = [];
	combined.watch((v) => seen.push(v));
	factor.set(20);
	assert.deepEqual(seen, [[2, 20, 21, 'constant']]);
});

test('a late subscriber does not reset what an earlier watcher is owed', () => {
	const doc = createObject<Doc>({ width: 1 });
	const chain = observer(doc).path('width').map((v) => Number(v) * 10);
	const early: number[] = [];
	const late: number[] = [];

	chain.watch((v) => early.push(v as number));

	// A peer listener on the same commit reads the chain, settling it, and then subscribes.
	// The early watcher is still owed the delivery that read forced.
	observer(doc).watch(() => {
		chain.get();
		chain.watch((v) => late.push(v as number));
	});

	doc.width = 2;
	assert.deepEqual(early, [20]);
	assert.deepEqual(late, []);
});

test('an effect started beside a settling read delivers its value once', () => {
	const doc = createObject<Doc>({ width: 1 });
	const chain = observer(doc).path('width').map((v) => Number(v) * 10);
	const seen: number[] = [];

	observer(doc).watch(() => {
		chain.get();
		chain.effect((v) => seen.push(v as number));
	});

	doc.width = 2;
	assert.deepEqual(seen, [20]);
});

test('setter cannot reopen a chain that is immutable by construction', () => {
	const cell = mutable(1);
	assert.throws(() => immutable(cell).setter(() => undefined), /read-only/);

	const doc = createObject<Doc>({ title: 'a' });
	assert.throws(() => observer(doc).skip().setter(() => undefined), /read-only/);
});

test('a cell or derived value cannot be written into a document slot', () => {
	const doc = createObject<Doc>();
	assert.throws(() => {
		doc.user = mutable(1) as unknown as Record<string, unknown>;
	}, /cell-in-document/);
	assert.throws(() => {
		doc.user = observer(doc).path('title') as unknown as Record<string, unknown>;
	}, /cell-in-document/);
});
