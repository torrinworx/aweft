// The behavioral corpus for the value surface.
//
// Each case is a requirement this stack must meet, taken from a class of failure this problem
// domain is known to contain: transforms that throw, transforms that write, watchers that
// throw during a delivery, and chains that re-target what they follow. The corpus is
// append-only. Removing a case needs a design note, because each one is here for a
// reason someone paid for.

import test from 'node:test';
import assert from 'node:assert/strict';

import { spawnSync } from 'node:child_process';

import { all, createArray, createObject, fromEvent, mutable, observer } from '../src/index.ts';

interface Doc extends Record<string, unknown> {
	title?: string;
	n?: number;
}

test('a throwing transform poisons nothing: every read recomputes and rethrows', () => {
	const cell = mutable(1);
	let runs = 0;
	const risky = cell.map((v) => {
		runs += 1;
		if (v === 13) throw new Error('unlucky');
		return v * 2;
	});

	cell.set(13);
	assert.throws(() => risky.get(), /unlucky/);
	const after = runs;
	// The failure was not cached as if it were a value: the next read computes again.
	assert.throws(() => risky.get(), /unlucky/);
	assert.equal(runs, after + 1);

	cell.set(4);
	assert.equal(risky.get(), 8);
});

test('a transform throwing during delivery leaves the chain consistent after', () => {
	const cell = mutable(1);
	const seen: number[] = [];
	const risky = cell.map((v) => {
		if (v === 13) throw new Error('unlucky');
		return v * 2;
	});

	const stop = risky.watch((v) => seen.push(v));

	// The error reaches whoever made the write, once delivery has finished.
	assert.throws(() => cell.set(13), /unlucky/);

	// A read after the failure tries again and rethrows. Serving the value from before the
	// failure here would be a silently stale cache wearing a cache's clothes.
	assert.throws(() => risky.get(), /unlucky/);

	// The failed recompute was not recorded as done: the next change recomputes and delivers.
	cell.set(5);
	assert.deepEqual(seen, [10]);
	stop();
});

test('one watcher throwing does not decide whether the others hear the value', () => {
	const cell = mutable(1);
	const seen: number[] = [];
	const doubled = cell.map((v) => v * 2);

	const stopA = doubled.watch(() => {
		throw new Error('bad watcher');
	});
	const stopB = doubled.watch((v) => seen.push(v));

	assert.throws(() => cell.set(2), /bad watcher/);
	assert.deepEqual(seen, [4]);
	stopA();
	stopB();
});

test('a transform that writes its own source converges instead of recursing', () => {
	const doc = createObject<Doc>({ n: 5 });
	const scope = observer(doc).path('n');
	const seen: number[] = [];

	// Clamping is the honest version of this pattern: the transform pushes the source toward
	// a fixed point, and the fixed point ends the cascade.
	const clamped = scope.map((v) => {
		const n = Number(v);
		if (n > 10) scope.set(10);
		return Math.min(n, 10);
	});

	const stop = clamped.watch((v) => seen.push(v as number));
	doc.n = 50;

	assert.equal(doc.n, 10);
	assert.equal(clamped.get(), 10);
	stop();
});

test('unwrap lets go of the inner chain when the outer value stops being one', () => {
	const inner = mutable('a');
	const outer = mutable<unknown>(inner);
	const seen: unknown[] = [];

	const stop = outer.unwrap().watch((v) => seen.push(v));

	outer.set('plain');
	assert.deepEqual(seen, ['plain']);

	// The released inner chain no longer reaches this watcher.
	inner.set('b');
	assert.deepEqual(seen, ['plain']);
	stop();
});

test('a selection watcher throwing does not corrupt which key is selected', () => {
	const active = mutable<string | undefined>('a');
	const select = active.selector();
	const bSeen: boolean[] = [];

	const stopA = select('a').watch(() => {
		throw new Error('bad selection watcher');
	});
	const stopB = select('b').watch((v) => bSeen.push(v));

	assert.throws(() => active.set('b'), /bad selection watcher/);
	assert.deepEqual(bSeen, [true]);
	stopA();

	// The selector's own bookkeeping moved exactly once: the next move still flips this key.
	active.set('a');
	assert.deepEqual(bSeen, [true, false]);
	stopB();
});

test('an effect whose first call throws leaves no subscription behind', () => {
	const cell = mutable(1);
	const seen: number[] = [];

	assert.throws(() => cell.effect(() => {
		throw new Error('first call refuses');
	}), /first call refuses/);

	// The failed effect held no handle anyone could stop; the subscription must be gone.
	cell.watch((v) => seen.push(v));
	cell.set(2);
	assert.deepEqual(seen, [2]);

	const doc = createObject<Doc>({ title: 'a' });
	const scope = observer(doc).path('title');
	assert.throws(() => scope.effect(() => {
		throw new Error('scope first call refuses');
	}), /scope first call refuses/);

	let heard = 0;
	const stop = scope.watch(() => heard += 1);
	doc.title = 'b';
	stop();
	assert.equal(heard, 1, 'the leaked scope listener would make delivery run twice');
});

test('an effect that writes its scope during its initial call still unsubscribes cleanly', () => {
	const doc = createObject<Doc>({ title: 'raw' });
	const scope = observer(doc).path('title');
	const seen: unknown[] = [];

	const stop = scope.map((v) => v).effect((v) => {
		seen.push(v);
		if (v === 'raw') scope.set('cooked');
	});

	assert.deepEqual(seen, ['raw', 'cooked']);
	stop();

	doc.title = 'later';
	assert.deepEqual(seen, ['raw', 'cooked']);
});

test('a watcher stopped by another watcher in one delivery hears that value and no later one', () => {
	// Two watchers share one derived value, so they share one node. The first stops the second
	// while the value is being handed round. The second was already owed this value, and the
	// bookkeeping that records what it was told must not put it back to hear the next.
	const cell = mutable(1);
	const doubled = cell.map((v) => v * 2);
	const seen: string[] = [];
	let stopSecond: (() => void) | null = null;

	const stopFirst = doubled.watch((v) => {
		seen.push(`first ${String(v)}`);
		if (v === 4) stopSecond?.();
	});
	stopSecond = doubled.watch((v) => seen.push(`second ${String(v)}`));

	cell.set(2);
	cell.set(3);
	assert.deepEqual(seen, ['first 4', 'second 4', 'first 6']);
	stopFirst();

	// The same on a bare cell, where each watcher has a node of its own.
	const bare = mutable(1);
	const heard: string[] = [];
	let stopB: (() => void) | null = null;
	const stopA = bare.watch((v) => {
		heard.push(`a ${String(v)}`);
		if (v === 2) stopB?.();
	});
	stopB = bare.watch((v) => heard.push(`b ${String(v)}`));
	bare.set(2);
	bare.set(3);
	assert.deepEqual(heard.filter((h) => h.startsWith('b')), [], 'the stopped watcher hears nothing after');
	assert.deepEqual(heard.filter((h) => h.startsWith('a')), ['a 2', 'a 3']);
	stopA();
});

test('a watcher added by another watcher in one delivery hears only the values after it', () => {
	const cell = mutable(1);
	const doubled = cell.map((v) => v * 2);
	const seen: string[] = [];
	let stopLate: (() => void) | null = null;

	const stopEarly = doubled.watch((v) => {
		seen.push(`early ${String(v)}`);
		if (v === 4 && stopLate === null) stopLate = doubled.watch((w) => seen.push(`late ${String(w)}`));
	});

	cell.set(2);
	cell.set(3);
	assert.deepEqual(seen, ['early 4', 'early 6', 'late 6']);
	stopEarly();
	stopLate!();
});

test('a map watcher that throws does not stop the next change from being computed and delivered', () => {
	const cell = mutable(1);
	let runs = 0;
	const doubled = cell.map((v) => {
		runs += 1;
		return v * 2;
	});
	const seen: number[] = [];

	const stop = doubled.watch((v) => {
		seen.push(v);
		if (v === 4) throw new Error('once');
	});
	const before = runs;

	assert.throws(() => cell.set(2), /once/);
	cell.set(3);
	assert.deepEqual(seen, [4, 6]);
	assert.equal(runs, before + 2, 'one recompute per change, and none retrying the throw');
	stop();
});

test('an unwrap watcher that re-points the outer value is handed the value it was told, then the new target', () => {
	const a = mutable('a1');
	const b = mutable('b1');
	const outer = mutable<unknown>(a);
	const seen: unknown[] = [];

	const stop = outer.unwrap().watch((v) => {
		seen.push(v);
		if (v === 'a2') outer.set(b);
	});

	// The retarget made inside the delivery is its own delivery, after this one.
	a.set('a2');
	assert.deepEqual(seen, ['a2', 'b1']);
	// The old inner chain was let go.
	a.set('a3');
	assert.deepEqual(seen, ['a2', 'b1']);
	b.set('b2');
	assert.deepEqual(seen, ['a2', 'b1', 'b2']);
	stop();
});

test('two watchers on one derived value share one transform run per change, and reads cost nothing', () => {
	const cell = mutable(1);
	let runs = 0;
	const plusOne = cell.map((v) => {
		runs += 1;
		return v + 1;
	});
	const heard: number[] = [];

	const stopA = plusOne.watch((v) => heard.push(v));
	const stopB = plusOne.watch((v) => heard.push(v));
	const live = runs;

	cell.set(2);
	assert.equal(runs, live + 1);
	assert.deepEqual(heard, [3, 3]);

	plusOne.get();
	plusOne.get();
	assert.equal(runs, live + 1, 'a live value is read from its cache');
	stopA();
	stopB();
});

test('a watcher subscribing to its own chain inside its first delivery does not keep the upstream live', () => {
	let listeners = 0;
	const target = {
		handlers: new Set<(event: string) => void>(),
		addEventListener(_type: string, fn: (event: string) => void) {
			listeners += 1;
			this.handlers.add(fn);
		},
		removeEventListener(_type: string, fn: (event: string) => void) {
			listeners -= 1;
			this.handlers.delete(fn);
		},
		fire(event: string) {
			for (const fn of [...this.handlers]) fn(event);
		},
	};
	const events = fromEvent<string>(target, 'tick').map((e) => e ?? 'none');
	let stopInner: (() => void) | null = null;

	const stopOuter = events.watch(() => {
		if (stopInner === null) stopInner = events.watch(() => undefined);
	});
	target.fire('one');
	assert.notEqual(stopInner, null, 'the inner subscription was made during the delivery');
	assert.equal(listeners, 1, 'one listener on the target however many watchers');

	stopOuter();
	assert.equal(listeners, 1, 'the inner watcher still holds the upstream');
	stopInner!();
	assert.equal(listeners, 0, 'and the last one to leave releases it');
});

test('a wildcard scope reads as undefined through all and effect rather than throwing', () => {
	const doc = createObject<Record<string, unknown>>({ list: createArray([1]) });
	const wild = observer(doc).skip(1);

	assert.deepEqual(all([wild, 'plain']).get(), [undefined, 'plain']);

	const seen: unknown[] = [];
	const stop = wild.effect((v) => seen.push(v));
	(doc['list'] as number[]).push(2);
	assert.deepEqual(seen, [undefined, undefined], 'it runs for the change it heard, with no single value');
	stop();
});

test('a derived value over a path nothing holds yet reads undefined, hears the path arrive, and stops clean', () => {
	const doc = createObject<Record<string, unknown>>();
	let runs = 0;
	const named = observer(doc).path('a', 'b').map((v) => {
		runs += 1;
		return v === undefined ? 'none' : v;
	});
	const seen: unknown[] = [];

	const stop = named.watch((v) => seen.push(v));
	assert.equal(named.get(), 'none');

	doc['a'] = createObject<Record<string, unknown>>({ b: 1 });
	assert.deepEqual(seen, [1]);

	stop();
	const after = runs;
	(doc['a'] as Record<string, unknown>)['b'] = 2;
	assert.deepEqual(seen, [1]);
	assert.equal(runs, after, 'nothing is left registered to run the transform');
});

test('a stopped watcher and a drained delivery hold nothing: what the watcher closed over is collectable', () => {
	// Run in a child with the collector exposed, so the check is a real collection and not a
	// guess about what a queue still points at.
	const run = spawnSync(process.execPath, [
		'--conditions=aweft-source', '--expose-gc', '--import', '@aweftjs/build/loader',
		new URL('./held.ts', import.meta.url).pathname,
	], { encoding: 'utf8', timeout: 30_000 });
	assert.equal(run.status, 0, run.stderr);
	assert.deepEqual(run.stdout.trim().split('\n'), ['cell watcher: released', 'document listener: released']);
});
