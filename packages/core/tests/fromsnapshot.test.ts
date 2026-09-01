// Rebuilding a document from a snapshot (design 029).

import test from 'node:test';
import assert from 'node:assert/strict';

import {
	alias, apply, createArray, createMap, createObject, fromSnapshot, observer, snapshot,
	textIdOf, type Snapshot,
} from '../src/index.ts';

const document = (): Record<string, unknown> => {
	const author = createObject({ name: 'ada' });
	return createObject({
		title: 'notes',
		count: 3,
		flag: true,
		nothing: null,
		bytes: new Uint8Array([1, 2, 3]),
		blocks: createArray(['a', createObject({ text: 'b' })]),
		people: (() => {
			const map = createMap<Record<string, unknown>>();
			map.add(author);
			return map;
		})(),
		author: alias(author),
	});
};

test('snapshot, rebuild, snapshot again: the same document', () => {
	const doc = document();
	const copy = fromSnapshot(snapshot(doc));
	assert.deepStrictEqual(snapshot(copy), snapshot(doc));
});

test('the rebuilt document accepts commits addressed to the original ids', () => {
	const doc = document();
	const copy = fromSnapshot(snapshot(doc)) as Record<string, unknown>;

	observer(doc).watch((change) => apply(copy, change));
	doc.title = 'renamed';
	((doc.blocks as unknown[])[1] as Record<string, unknown>).text = 'c';

	assert.deepStrictEqual(snapshot(copy), snapshot(doc));
	assert.equal(copy.title, 'renamed');
});

test('positions and order survive the rebuild', () => {
	const list = createArray(['x', 'y', 'z']);
	const doc = createObject({ list });
	const copy = fromSnapshot(snapshot(doc)) as { list: string[] };

	assert.deepEqual([...copy.list], ['x', 'y', 'z']);
	copy.list.splice(1, 1);
	assert.deepEqual([...copy.list], ['x', 'z']);
});

test('an alias survives as an alias: it grants nothing', () => {
	const doc = document();
	const copy = fromSnapshot(snapshot(doc)) as Record<string, unknown>;

	// The alias reads as the same observable that lives in the map.
	const people = copy.people as { values(): Array<Record<string, unknown>> };
	assert.equal(copy.author, people.values()[0]);
});

const base = (): Snapshot => snapshot(document());

const edit = (change: (snap: {
	root: string;
	observables: Record<string, { kind: string; slots: Record<string, unknown> }>;
}) => void): Snapshot => {
	const snap = structuredClone(base()) as unknown as {
		root: string;
		observables: Record<string, { kind: string; slots: Record<string, unknown> }>;
	};
	change(snap);
	return snap as unknown as Snapshot;
};

test('a ref naming an id the snapshot does not hold is refused', () => {
	const broken = edit((snap) => {
		const root = snap.observables[snap.root]!;
		(root.slots.blocks as { ref: string }).ref = 'aaaaaaaaaaaaaaaa';
	});
	assert.throws(() => fromSnapshot(broken), /unreachable/);
});

test('an observable attached twice is refused', () => {
	const broken = edit((snap) => {
		const root = snap.observables[snap.root]!;
		root.slots.second = structuredClone(root.slots.blocks);
	});
	assert.throws(() => fromSnapshot(broken), /multiple-attach/);
});

test('an observable nothing attaches is refused', () => {
	const broken = edit((snap) => {
		const root = snap.observables[snap.root]!;
		delete root.slots.blocks;
	});
	assert.throws(() => fromSnapshot(broken), /unreachable/);
});

test('a kind that disagrees with its target is refused', () => {
	const broken = edit((snap) => {
		const root = snap.observables[snap.root]!;
		(root.slots.blocks as { kind: string }).kind = 'object';
	});
	assert.throws(() => fromSnapshot(broken), /kind-conflict/);
});

test('an attach edge pointing at the root is refused', () => {
	const broken = edit((snap) => {
		const root = snap.observables[snap.root]!;
		root.slots.self = { ref: snap.root, kind: 'object', edge: 'attach' };
	});
	assert.throws(() => fromSnapshot(broken), /multiple-attach/);
});

test('an array slot that is not a position key is refused', () => {
	const doc = createObject({ list: createArray(['x']) });
	const snap = structuredClone(snapshot(doc)) as unknown as {
		root: string;
		observables: Record<string, { kind: string; slots: Record<string, unknown> }>;
	};
	const listKey = textIdOf((doc as { list: unknown }).list);
	const list = snap.observables[listKey]!;
	list.slots['not hex'] = 'y';

	assert.throws(() => fromSnapshot(snap as unknown as Snapshot), /invalid-key/);
});
