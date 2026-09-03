// The behavioral corpus for core.
//
// Each case is a requirement this stack must meet, taken from a class of failure this problem
// domain is known to contain: reentrancy during delivery, listeners that change the listener
// set while it is being walked, removing the same thing twice, and reading state from inside a
// callback. The corpus is append-only. Removing a case needs a design note, because each
// one is here for a reason someone paid for.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
	RefusedError, alias, atomic, createArray, createObject, intercept, isReachable, observer,
	parentOf, snapshot, textIdOf,
} from '../src/index.ts';
import type { Change } from '../src/index.ts';

interface Doc extends Record<string, unknown> {
	a?: number;
	b?: number;
	held?: Record<string, unknown>;
	list?: number[];
}

test('a listener that mutates does not reenter the delivery it is inside', () => {
	const doc = createObject<Doc>();
	const order: string[] = [];

	observer(doc).watch((change) => {
		order.push(`first ${change.deltas.length}`);
		if (doc.b === undefined) doc.b = 1;
	});
	observer(doc).watch(() => order.push('second'));

	doc.a = 1;

	assert.deepEqual(order, ['first 1', 'second', 'first 1', 'second'],
		'both listeners hear the first commit before either hears the one made inside it');
});

test('a listener added during delivery does not hear the commit already in flight', () => {
	const doc = createObject<Doc>();
	const late: Change[] = [];

	observer(doc).watch(() => {
		observer(doc).watch((change) => late.push(change));
	});

	doc.a = 1;
	assert.equal(late.length, 0);

	doc.b = 2;
	assert.ok(late.length >= 1, 'and hears the next one');
});

test('a listener removed during delivery stops, and the one in flight still completes', () => {
	const doc = createObject<Doc>();
	const seen: string[] = [];

	const stop = observer(doc).watch(() => seen.push('second'));
	observer(doc).watch(() => {
		seen.push('first');
		stop();
	});

	doc.a = 1;
	doc.b = 2;

	assert.deepEqual(seen, ['second', 'first', 'first'],
		'the removed listener heard the commit that was already being delivered, and no later one');
});

test('a listener that throws does not decide whether the others hear the commit', () => {
	const doc = createObject<Doc>();
	const seen: string[] = [];

	observer(doc).watch(() => { throw new Error('listener'); });
	observer(doc).watch(() => seen.push('heard'));

	assert.throws(() => { doc.a = 1; }, /listener/);
	assert.deepEqual(seen, ['heard']);
	assert.equal(doc.a, 1, 'the mutation itself stands; only the listener failed');
});

test('a listener reads the state the commit produced, not the one before it', () => {
	const doc = createObject<Doc>({ a: 1 });
	const read: unknown[] = [];

	observer(doc).watch(() => read.push(doc.a));
	doc.a = 2;

	assert.deepEqual(read, [2]);
});

test('removing the same thing twice is not an error and is not a second commit', () => {
	const doc = createObject<Doc>({ a: 1, list: createArray<number>([1]) });
	const seen: Change[] = [];
	observer(doc).watch((change) => seen.push(change));

	delete doc.a;
	delete doc.a;
	assert.equal(seen.length, 1);

	assert.equal(doc.list!.pop(), 1);
	assert.equal(doc.list!.pop(), undefined);
	assert.equal(doc.list!.shift(), undefined);
	assert.deepEqual(doc.list!.splice(3, 2), []);
	assert.equal(seen.length, 2, 'only the pop that removed something was a commit');
});

test('a watcher hears the removal of the subtree it was watching', () => {
	const doc = createObject<Doc>({ held: createObject<Record<string, unknown>>({ x: 1 }) });
	const seen: Change[] = [];
	observer(doc).path('held').watch((change) => seen.push(change));

	delete doc.held;

	assert.equal(seen.length, 1);
	assert.equal(seen[0]!.deltas[0]!.type, 'remove');
});

test('a delta written into a subtree being detached still reaches the root', () => {
	const doc = createObject<Doc>({ held: createObject<Record<string, unknown>>({ x: 1 }) });
	const seen: Change[] = [];
	observer(doc).watch((change) => seen.push(change));
	const held = doc.held!;

	// The format allows writing into a subtree in the same commit that detaches it, so a
	// receiver will apply both deltas. A watcher on the root that heard only the detach would
	// send half the commit, and the two documents would drift apart with nothing to notice it.
	atomic(() => {
		delete held.x;
		delete doc.held;
	});

	assert.equal(seen.length, 1);
	assert.equal(seen[0]!.deltas.length, 2, 'the removed slot and the removed edge');
	assert.equal(seen[0]!.inverse().deltas.length, 2, 'and both come back on undo');
});

test('a commit is delivered whole, so no listener sees half of it', () => {
	const doc = createObject<Doc>({ a: 1, b: 1 });
	const torn: string[] = [];

	// The invariant is that a and b are equal. A listener that sees the state mid-commit would
	// catch them apart, which is what commit delivery exists to prevent.
	observer(doc).watch(() => {
		if (doc.a !== doc.b) torn.push(`${String(doc.a)} ${String(doc.b)}`);
	});

	atomic(() => {
		doc.a = 2;
		doc.b = 2;
	});

	assert.deepEqual(torn, []);
});

test('the same invariant breaks without a block, which is the honest reading of two commits', () => {
	const doc = createObject<Doc>({ a: 1, b: 1 });
	const torn: string[] = [];

	observer(doc).watch(() => {
		if (doc.a !== doc.b) torn.push(`${String(doc.a)} ${String(doc.b)}`);
	});

	doc.a = 2;
	doc.b = 2;

	assert.deepEqual(torn, ['2 1'], 'two assignments outside a block are two commits');
});

test('a document that was never watched still reads back as itself', () => {
	const doc = createObject<Doc>({ a: 1 });
	doc.b = 2;
	doc.list = createArray<number>([1, 2]);
	doc.list.push(3);

	assert.deepEqual(snapshot(doc).observables[snapshot(doc).root]?.slots.b, 2);
	assert.deepEqual([...doc.list], [1, 2, 3]);
});


// --- delivery under reentrancy ------------------------------------------------------------

test('a listener that throws a falsy value hands that exact value back', () => {
	const doc = createObject<Doc>();
	observer(doc).watch(() => { throw undefined; });

	let caught: unknown = 'nothing was thrown';
	try {
		doc.a = 1;
	} catch (error) {
		caught = error;
	}

	// Delivery holds the first failure and rethrows it once everyone has been told. Holding it
	// in a variable and testing that variable for undefined would swallow this throw entirely,
	// and the mutation would look like it succeeded.
	assert.equal(caught, undefined);

	const other = createObject<Doc>();
	observer(other).watch(() => { throw 0; });

	let zero: unknown = 'nothing was thrown';
	try {
		other.a = 1;
	} catch (error) {
		zero = error;
	}
	assert.equal(zero, 0);
});

test('a mutation made inside a listener is its own commit, not part of the one that made it', () => {
	const doc = createObject<Doc>();
	const sizes: number[] = [];

	observer(doc).watch((change) => {
		sizes.push(change.deltas.length);
		if (doc.note === undefined) doc.note = 'written by a listener';
	});

	atomic(() => {
		doc.a = 1;
		doc.b = 2;
	});

	// The block closes before user code runs, so a listener's own write opens a new commit. If
	// it joined the open one the far side would receive a commit the sender never bounded.
	assert.deepEqual(sizes, [2, 1]);
});

test('a block hands back what it returned', () => {
	const doc = createObject<Doc>();
	const out = atomic(() => {
		doc.a = 1;
		return 'the block decided this';
	});

	assert.equal(out, 'the block decided this');
});

test('a listener that mutates its own observable runs the change out, one commit a step', () => {
	const doc = createObject<Doc>({ a: 0 });
	const steps: unknown[] = [];

	observer(doc).watch(() => {
		steps.push(doc.a);
		if ((doc.a as number) < 4) doc.a = (doc.a as number) + 1;
	});

	doc.a = 0 + 1;

	assert.deepEqual(steps, [1, 2, 3, 4], 'each step is delivered, and the cascade ends');
});

test('a listener reads the tree as it stands, which a cascade may have moved past its commit', () => {
	const doc = createObject<Doc>();
	const pairs: Array<[unknown, unknown]> = [];

	observer(doc).watch(() => {
		if ((doc.a as number) < 3) doc.a = (doc.a as number) + 1;
	});
	observer(doc).watch((change) => {
		pairs.push([change.deltas[0]!.value, doc.a]);
	});

	doc.a = 0;

	// A mutation lands in the tree as it is written, so a listener earlier in this delivery has
	// already moved the tree on by the time a later one runs. The tree is never seen between
	// the deltas of one commit, but it is not pinned to the commit a listener was handed. Read
	// the deltas when the exact state of your own commit is what matters.
	assert.deepEqual(pairs, [[0, 1], [1, 2], [2, 3], [3, 3]]);
});

test('two listeners on one commit each write a third observable, in the order they registered', () => {
	const source = createObject<Doc>({ a: 0, b: 0 });
	const target = createObject<Doc>();
	const commits: unknown[][] = [];

	observer(target).watch((change) => commits.push(change.deltas.map((delta) => delta.value)));
	observer(source).path('a').watch(() => { target.a = 1; });
	observer(source).path('b').watch(() => { target.a = 2; });

	atomic(() => {
		source.a = 1;
		source.b = 1;
	});

	// Each listener's write is its own commit, and neither is folded into the other. Two writes
	// coalescing here would hide one of them from a receiver.
	assert.equal(commits.length, 2);
	assert.deepEqual(commits, [[1], [2]]);
	assert.equal(target.a, 2, 'the later listener wrote last');
});

test('delivery to one observable does not recurse into another listener set', () => {
	const first = createObject<Doc>({ a: 0 });
	const second = createObject<Doc>({ a: 0 });
	const order: string[] = [];

	observer(first).watch(() => {
		order.push('first');
		second.a = (second.a as number) + 1;
	});
	observer(second).watch(() => order.push('second'));

	first.a = 1;

	// One observable's listeners firing another's must queue rather than nest. Nesting here is
	// how a deep chain of subscriptions overflows the stack instead of running.
	assert.deepEqual(order, ['first', 'second']);
});

// --- references ---------------------------------------------------------------------------

test('a mutation is delivered once however many aliases name the observable', () => {
	const shared = createObject<Doc>();
	const root = createObject<Doc>();
	let heard = 0;

	observer(root).watch(() => { heard += 1; });

	atomic(() => {
		root.held = shared as Record<string, unknown>;
		root.first = alias(shared);
		root.second = alias(shared);
	});

	heard = 0;
	shared.a = 1;
	assert.equal(heard, 1, 'three references, one delivery');

	delete root.first;
	heard = 0;
	shared.a = 2;
	assert.equal(heard, 1, 'an alias going away changes nothing, because it carried nothing');

	delete root.held;
	assert.throws(() => { shared.a = 3; }, { reason: 'unreachable' },
		'the attach edge was the only thing holding it in the document');
});

test('an alias cycle does not make delivery walk forever', () => {
	const first = createObject<Doc>();
	const second = createObject<Doc>();
	let heard = 0;

	observer(first).watch(() => { heard += 1; });

	first.held = second as Record<string, unknown>;
	second.back = alias(first);

	heard = 0;
	first.a = 1;

	// Delivery walks attach edges, and an alias is not one, so a reference cycle cannot become
	// a walk that never ends.
	assert.equal(heard, 1);
});

// --- scopes and slots ---------------------------------------------------------------------

test('ignore filters what a scope hears without changing what it reads and writes', () => {
	const doc = createObject<Doc>({ a: 1, b: 2 });
	let heard = 0;

	observer(doc).ignore('b').watch(() => { heard += 1; });

	doc.b = 3;
	assert.equal(heard, 0, 'the ignored branch is dropped');

	doc.a = 4;
	assert.equal(heard, 1, 'everything else still arrives');

	const ignored = observer(doc).path('b').ignore('anything');
	ignored.set(5);
	assert.equal(ignored.get(), 5, 'ignore only filters delivery; the path still reads and writes');
});

test('a slot may be named the empty string or a digit', () => {
	const doc = createObject<Record<string, unknown>>();

	doc[''] = 'named by nothing';
	doc['0'] = 'named by a digit';

	// A path walks to a slot by name, and a name that is falsy or looks like an index is still
	// a name. Treating either as absent would lose the slot silently.
	assert.equal(observer(doc).path('').get(), 'named by nothing');
	assert.equal(observer(doc).path('0').get(), 'named by a digit');
	assert.equal(snapshot(doc).observables[Object.keys(snapshot(doc).observables)[0]!]!.slots[''], 'named by nothing');
});

test('a splice that removes nothing and adds nothing is not a commit', () => {
	const list = createArray<number>([1, 2, 3]);
	let commits = 0;

	observer(list).watch(() => { commits += 1; });

	assert.deepEqual(list.splice(1, 0), []);
	assert.equal(commits, 0, 'a block that changed no slot closes without telling anyone');
	assert.deepEqual([...list], [1, 2, 3]);
});

test('an object surfaces its own slots and nothing from the prototype', () => {
	const doc = createObject<Doc>({ a: 1 });

	const seen: string[] = [];
	for (const key in doc) seen.push(key);

	// Enumerating must not surface the machinery the proxy is built on. A consumer that walks
	// an observable to copy or serialize it would otherwise pick up names nobody wrote.
	assert.deepEqual(seen, ['a']);
	assert.ok('a' in doc);
	assert.ok(!('constructor' in doc));
	assert.ok(!('toString' in doc));
	assert.ok(Object.hasOwn(doc, 'a'));
});

test('an effect follows the depth of its scope, and narrows only when asked', () => {
	const grandchild = createObject<Doc>({ a: 1 });
	const child = createObject<Doc>({ held: grandchild as Record<string, unknown> });
	const doc = createObject<Doc>({ held: child as Record<string, unknown> });

	let deep = 0;
	let shallow = 0;
	observer(doc).path('held').effect(() => { deep += 1; });
	observer(doc).path('held').shallow().effect(() => { shallow += 1; });

	assert.equal(deep, 1, 'an effect runs once up front');
	assert.equal(shallow, 1);

	child.a = 2;
	assert.equal(deep, 2, "the scoped observable's own slot is in both");
	assert.equal(shallow, 2);

	grandchild.a = 2;

	// The corpus carries a case for an effect that subscribes shallowly on its own. It does not
	// carry over: depth belongs to the scope, so every operator reads it the same way, and
	// shallow() is how a caller asks for the narrower one. Decision design 018.
	assert.equal(deep, 3, 'a change below the scoped observable is still in the scope');
	assert.equal(shallow, 2, 'shallow() is what stops at the scoped observable own slots');
});

test('a long cascade of listener mutations does not grow the stack', () => {
	const doc = createObject<Doc>();
	const depth = 2000;
	let steps = 0;

	observer(doc).watch(() => {
		steps += 1;
		if ((doc.a as number) < depth) doc.a = (doc.a as number) + 1;
	});

	// Delivery queues and drains in a loop rather than calling into itself. A listener that
	// mutates queues its commit behind the one being delivered, so the cost of a cascade is
	// heap, not stack. Delivering the follow-up inside the call that caused it makes the stack
	// depth the length of the cascade, and this runs out of stack in the low hundreds.
	doc.a = 0;

	assert.equal(steps, depth + 1);
	assert.equal(doc.a, depth);
});

test('turning the one attach edge into an alias takes the observable out of the document', () => {
	// The slot stopped attaching the observable while the observable went on believing this
	// slot was its home, so it was outside the document and reported that it was inside:
	// isReachable said true, parentOf named a parent, snapshot did not contain it, and writes
	// into it were accepted. A document in that state cannot be rebuilt from its own snapshot.
	const doc = createObject<Record<string, unknown>>();
	const child = createObject<Record<string, unknown>>();

	doc.k = child;
	child.leaf = 'here';
	assert.equal(isReachable(child), true);

	doc.k = alias(child);

	assert.equal(isReachable(child), false, 'nothing attaches it, so nothing reaches it');
	assert.equal(parentOf(child), undefined, 'and it has no parent to name');
	assert.ok(!(textIdOf(child) in snapshot(doc).observables), 'the document does not contain it');
	assert.throws(
		() => { child.leaf = 'after'; },
		(e: Error & { reason?: string }) => e.reason === 'unreachable',
		'a write into it is refused, the same as any receiver refuses the same delta',
	);
});

test('a refused commit is a commit nobody ever saw', () => {
	// A check that runs after some watchers have been told is not a check, it is a repair
	// job: the deltas are already out and whatever recorded them has to be told to forget.
	// So a refusal has to land in the same place a throwing block lands, before delivery,
	// and leave the document byte for byte where it was.
	const doc = createObject<Doc>({ a: 1, held: createObject({ n: 1 }) });
	const before = snapshot(doc);
	const heard: Change[] = [];

	observer(doc).watch((change) => heard.push(change));
	intercept(doc, () => [{ code: 'test', message: 'no' }]);

	assert.throws(
		() => atomic(() => {
			doc.a = 2;
			doc.b = 3;
			doc.list = createArray([1, 2, 3]);
		}),
		RefusedError,
	);

	assert.deepEqual(snapshot(doc), before, 'the document is exactly what it was');
	assert.deepEqual(heard, [], 'and no watcher was told anything');
});

test('a rule reads the document the commit would leave, not the one it started from', () => {
	// A rule across two slots is the reason the seam runs after the deltas are applied rather
	// than before. Reading the old value of one slot and the new value of another answers a
	// question about a state that never exists.
	const doc = createObject<Doc>({ a: 1, b: 1 });
	const readings: Array<[unknown, unknown]> = [];

	intercept(doc, () => {
		readings.push([doc.a, doc.b]);
		return (doc.a as number) > (doc.b as number) ? [{ code: 'order', message: 'a must not pass b' }] : [];
	});

	atomic(() => {
		doc.a = 5;
		doc.b = 9;
	});
	assert.deepEqual(readings, [[5, 9]], 'both slots read as the commit leaves them');

	assert.throws(() => { doc.a = 20; }, RefusedError);
	assert.equal(doc.a, 5, 'and the rollback puts back the value the rule was reading');
});

test('a rule covers the document, however deep the observable it was registered on', () => {
	// The alternative is a rule per subtree, and then a commit that writes above the subtree
	// closes unchecked while the application believes the document is guarded.
	const leaf = createObject<Record<string, unknown>>({ n: 1 });
	const middle = createObject<Record<string, unknown>>({ leaf });
	const doc = createObject<Doc>({ held: middle });

	intercept(leaf, () => [{ code: 'test', message: 'no' }]);

	assert.throws(() => { doc.a = 1; }, RefusedError, 'a write at the root is refused');
	assert.throws(() => { leaf.n = 2; }, RefusedError, 'and so is one at the leaf');
});
