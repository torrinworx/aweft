// The coalescing property: a block's one commit, applied to a copy, leaves the copy where the
// block left the document, and the same edits made one at a time reach the same place.
//
// A block coalesces by slot (design 003): a slot written twice appears once, a slot that came
// and went does not appear at all, and the commit is the difference between where the block
// started and where it ended. That is a claim about every sequence of edits, so it is checked
// over seeded random ones rather than the few a hand would think of. A failure prints its
// seed; the run repeats exactly.

import test from 'node:test';
import assert from 'node:assert/strict';

import { assertId, type Id } from '@aweftjs/codec';
import { canonicalJson, randomBelow, randomFrom } from '@aweftjs/testing';

import {
	apply, atomic, createArray, createMap, createObject, fromSnapshot, observer, snapshot,
} from '../src/index.ts';
import type { Commit, ObservableMap } from '../src/index.ts';

interface Doc extends Record<string, unknown> {
	list: unknown[];
	entries: ObservableMap<unknown>;
	child: Record<string, unknown>;
}

type Edit = (doc: Doc) => void;

const SLOTS = ['a', 'b', 'c', 'd'];

/**
 * Twelve bytes from the stream, so the two documents an edit list is replayed on mint the
 * same ids for the observables the edits create.
 */
const idFrom = (random: () => number): Id =>
	assertId(Uint8Array.from({ length: 12 }, () => randomBelow(random, 256)));

const primitive = (random: () => number): unknown => {
	switch (randomBelow(random, 5)) {
		case 0: return randomBelow(random, 100);
		case 1: return `s${String(randomBelow(random, 100))}`;
		case 2: return random() < 0.5;
		case 3: return null;
		default: return random();
	}
};

/** A document every seed starts from, built with the ids the stream hands out. */
const start = (random: () => number): Doc => createObject<Doc>({
	a: 1,
	list: createArray<unknown>([1, 2, 3], idFrom(random)),
	entries: createMap<unknown>(undefined, idFrom(random)),
	child: createObject<Record<string, unknown>>({ n: 0 }, idFrom(random)),
}, idFrom(random));

/** One edit, with every choice drawn now so the same edit lands the same way on two documents. */
const edit = (random: () => number, keys: readonly Id[]): Edit => {
	const slot = SLOTS[randomBelow(random, SLOTS.length)]!;
	const value = primitive(random);
	const key = keys[randomBelow(random, keys.length)]!;
	const at = random();
	const count = randomBelow(random, 3);
	const id = idFrom(random);

	switch (randomBelow(random, 9)) {
		case 0: return (doc) => { doc[slot] = value; };
		case 1: return (doc) => { delete doc[slot]; };
		case 2: return (doc) => { doc.list.push(value); };
		case 3: return (doc) => {
			const index = Math.floor(at * (doc.list.length + 1));
			doc.list.splice(index, count, value);
		};
		case 4: return (doc) => {
			if (doc.list.length === 0) return;
			doc.list[Math.floor(at * doc.list.length)] = value;
		};
		case 5: return (doc) => { doc.entries.set(key, value); };
		case 6: return (doc) => { doc.entries.delete(key); };
		case 7: return (doc) => { doc.child[slot] = value; };
		default: return (doc) => { doc.child = createObject<Record<string, unknown>>({ n: value }, id); };
	}
};

/** The document as values, so two documents whose array positions differ still compare. */
const shape = (value: unknown): unknown => {
	if (Array.isArray(value)) return value.map(shape);
	if (value !== null && typeof value === 'object') {
		if ('entries' in value && typeof (value as ObservableMap<unknown>).entries === 'function') {
			return Object.fromEntries([...(value as ObservableMap<unknown>).entries()].sort().map(([k, v]) => [k, shape(v)]));
		}
		return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shape(v)]));
	}
	return value;
};

const commitsOf = (doc: object, run: () => void): Commit[] => {
	const commits: Commit[] = [];
	const stop = observer(doc).watch((change) => commits.push({ deltas: change.deltas }));
	run();
	stop();
	return commits;
};

for (const seed of [1, 2, 3, 20260913, 41, 42, 43, 99, 100, 7777]) {
	test(`a block's one commit equals its edits made one at a time, seed ${String(seed)}`, () => {
		const random = randomFrom(seed);
		const keys = [idFrom(random), idFrom(random), idFrom(random)];
		const edits = Array.from({ length: 30 }, () => edit(random, keys));

		// The same starting document twice, id for id, and a copy of each to apply commits to.
		const stream = randomFrom(seed);
		const blocked = start(stream);
		const blockedCopy = fromSnapshot(snapshot(blocked)) as Doc;
		const stepped = start(randomFrom(seed));
		const steppedCopy = fromSnapshot(snapshot(stepped)) as Doc;

		const one = commitsOf(blocked, () => atomic(() => { for (const apply_ of edits) apply_(blocked); }));
		assert.ok(one.length <= 1, `a block is at most one commit, seed ${String(seed)}`);
		for (const commit of one) apply(blockedCopy, commit);
		assert.equal(
			canonicalJson(snapshot(blockedCopy)), canonicalJson(snapshot(blocked)),
			`the coalesced commit applied to a copy is the document, seed ${String(seed)}`,
		);

		const many = commitsOf(stepped, () => { for (const apply_ of edits) apply_(stepped); });
		for (const commit of many) apply(steppedCopy, commit);
		assert.equal(
			canonicalJson(snapshot(steppedCopy)), canonicalJson(snapshot(stepped)),
			`the commits applied in order are the document, seed ${String(seed)}`,
		);

		assert.deepEqual(shape(blocked), shape(stepped), `both ways reach one state, seed ${String(seed)}`);
		assert.ok(one.length <= many.length, `coalescing never makes more commits, seed ${String(seed)}`);
		if (one.length === 1) {
			const slots = one[0]!.deltas.map((d) => `${String(d.id)}:${JSON.stringify(d.ref)}`);
			assert.equal(new Set(slots).size, slots.length, `one delta per slot, seed ${String(seed)}`);
		}
	});
}
