// A second reading of what a store must answer, written the slow obvious way and sharing no
// code with the store: a map of names to the state the live document has, the commits it made
// in order, and how many of those were truncated off the front. Random operations go through
// the public store API and through this at once, and every answer the store gives is held to
// what this says. An implementation agreeing with itself is the risk this exists to remove.

import assert from 'node:assert/strict';

import { type Commit } from '@aweftjs/codec';
import { atomic, createArray, createObject, idOf, isObservable, observer, snapshot, textIdOf } from '@aweftjs/core';
import { canonicalJson, randomBelow, randomFrom } from '@aweftjs/testing';

import type { Declaration, Driver, Handle, Indexable, Store } from '../src/index.ts';
import { createStore } from '../src/index.ts';

type Doc = Record<string, unknown>;

/** The store under test, and how to make a second one over the same storage. */
export interface Target {
	readonly store: Store;
	readonly again: () => Store;
}

const NAMES = ['alpha', 'beta', 'gamma', 'delta'];
const SLOTS = ['a', 'b', 'c'];
export const DECLARE: Declaration = { title: ['title'], inner: ['child', 'n'] };

interface Truth {
	/** The live document, as the model reads it: what a reopen has to rebuild. */
	state: string;
	/** Every commit since the document was created, oldest first. Sequence is index + 1. */
	history: Commit[];
	/** How many commits at the front of `history` were truncated away. */
	gone: number;
	/** The declared fields as the model reads them off the live document. */
	fields: Record<string, Indexable>;
}

/**
 * The declared fields of a live document, read by walking it, not by any projection code. The
 * rule the index states: a path that is missing, or that runs into a value or into bytes part
 * way down, holds null, so a document in the index answers for every declared field; an
 * observable at the end of a path is indexed as its id.
 */
const fieldsOf = (root: Doc): Record<string, Indexable> => {
	const out: Record<string, Indexable> = {};
	for (const [field, path] of Object.entries(DECLARE)) {
		let at: unknown = root;
		for (const step of path) at = at !== null && typeof at === 'object' && !(at instanceof Uint8Array) ? (at as Doc)[step] : undefined;
		if (at === undefined || at instanceof Uint8Array) out[field] = null;
		else if (isObservable(at)) out[field] = textIdOf(at);
		else out[field] = at as Indexable;
	}
	return out;
};

const primitive = (random: () => number): unknown => {
	switch (randomBelow(random, 4)) {
		case 0: return randomBelow(random, 5);
		case 1: return `t${String(randomBelow(random, 5))}`;
		case 2: return random() < 0.5;
		default: return null;
	}
};

/**
 * Drive one store with seeded random operations and hold every answer to the model.
 *
 * Params:
 *   target: the store, and a way to open a second store over the same storage
 *   seed: the stream; a failure names it
 *   steps: how many operations
 */
export const oracle = async (target: Target, seed: number, steps: number): Promise<void> => {
	const random = randomFrom(seed);
	const truth = new Map<string, Truth>();
	const open = new Map<string, Handle>();
	const { store } = target;
	const where = `seed ${String(seed)}`;

	const record = (name: string, handle: Handle): (() => void) =>
		observer(handle.root).watch((change) => {
			truth.get(name)!.history.push({ deltas: [...change.deltas] });
		});
	const watchers = new Map<string, () => void>();

	/** What a document the store has never held, or has forgotten, opens as: a root with nothing in it. */
	const empty = (handle: Handle): string =>
		canonicalJson(snapshot(createObject(undefined, idOf(handle.root))));

	const openOne = async (name: string): Promise<Handle> => {
		const had = open.get(name);
		if (had !== undefined) return had;
		const handle = await store.open(name);
		if (!truth.has(name)) {
			const state = canonicalJson(snapshot(handle.root));
			assert.equal(state, empty(handle), `a document the store does not hold opens empty, ${where}, ${name}`);
			truth.set(name, { state, history: [], gone: 0, fields: fieldsOf(handle.root as Doc) });
		}
		open.set(name, handle);
		watchers.set(name, record(name, handle));
		return handle;
	};

	const closeOne = async (name: string): Promise<void> => {
		const handle = open.get(name);
		if (handle === undefined) return;
		watchers.get(name)!();
		watchers.delete(name);
		open.delete(name);
		await store.close(handle);
	};

	const settleTruth = async (name: string): Promise<void> => {
		const handle = open.get(name)!;
		await store.settled(handle);
		const known = truth.get(name)!;
		known.state = canonicalJson(snapshot(handle.root));
		known.fields = fieldsOf(handle.root as Doc);
	};

	for (let step = 0; step < steps; step++) {
		const name = NAMES[randomBelow(random, NAMES.length)]!;
		const at = `${where}, step ${String(step)}, ${name}`;

		switch (randomBelow(random, 10)) {
			case 0:
			case 1:
			case 2: {
				// Edit the live document, one commit, and the store has it by the time settled answers.
				const handle = await openOne(name);
				const root = handle.root as Doc;
				const slot = SLOTS[randomBelow(random, SLOTS.length)]!;
				const value = primitive(random);
				switch (randomBelow(random, 8)) {
					case 0: root[slot] = value; break;
					case 1: delete root[slot]; break;
					case 2: root['title'] = `t${String(randomBelow(random, 4))}`; break;
					case 3: root['child'] = createObject<Doc>({ n: randomBelow(random, 4) }); break;
					case 4: {
						if (!Array.isArray(root['list'])) root['list'] = createArray<unknown>();
						(root['list'] as unknown[]).push(value);
						break;
					}
					// Where the index looks, an observable and bytes: indexed as an id and as null.
					case 5: root['title'] = createObject<Doc>({ n: 1 }); break;
					case 6: root['child'] = Uint8Array.of(randomBelow(random, 256)); break;
					default: atomic(() => { root[slot] = value; root['title'] = `t${String(randomBelow(random, 4))}`; });
				}
				await settleTruth(name);
				break;
			}
			case 3: {
				// Close and reopen: what comes back is rebuilt from rows and has to be the state.
				if (!open.has(name)) break;
				await closeOne(name);
				const handle = await openOne(name);
				assert.equal(canonicalJson(snapshot(handle.root)), truth.get(name)!.state, `reopened state, ${at}`);
				break;
			}
			case 4: {
				// A second store over the same storage, as a restarted process would be.
				if (!truth.has(name)) break;
				const other = target.again();
				const handle = await other.open(name);
				assert.equal(canonicalJson(snapshot(handle.root)), truth.get(name)!.state, `state from a second store, ${at}`);
				// Closed, not stopped: stopping releases the driver both stores share.
				await other.close(handle);
				break;
			}
			case 5: {
				// The head is the number of commits, truncation or not.
				if (!truth.has(name)) break;
				assert.equal(await store.head(name), truth.get(name)!.history.length, `head, ${at}`);
				break;
			}
			case 6: {
				// The tail after a sequence: exactly the commits after it, or a refusal when the
				// tail no longer reaches back that far. Never a short answer.
				if (!truth.has(name)) break;
				const known = truth.get(name)!;
				const seq = randomBelow(random, known.history.length + 2);
				const expected = known.history.slice(seq);
				if (seq >= known.history.length) {
					assert.deepEqual(await store.since(name, seq), [], `current, ${at}`);
				} else if (seq < known.gone) {
					await assert.rejects(store.since(name, seq), (error: { reason?: string }) => error.reason === 'truncated', `truncated, ${at}`);
				} else {
					const held = await store.since(name, seq);
					assert.deepEqual(held.map((h) => h.seq), expected.map((_, i) => seq + i + 1), `sequences, ${at}`);
					assert.deepEqual(held.map((h) => h.commit), expected, `commits, ${at}`);
				}
				break;
			}
			case 7: {
				// Truncation drops from the front and never touches the document.
				if (!truth.has(name)) break;
				const known = truth.get(name)!;
				const keep = randomBelow(random, known.history.length + 1);
				await store.truncate(name, keep);
				known.gone = Math.max(known.gone, known.history.length - keep);
				break;
			}
			case 8: {
				// find and scan answer from the index, which has to agree with the documents.
				const value = `t${String(randomBelow(random, 4))}`;
				const found = await store.find({ where: [{ field: 'title', op: 'eq', value }] });
				const expected = [...truth].filter(([, t]) => t.fields['title'] === value).map(([n]) => n).sort();
				assert.deepEqual(found.map((f) => f.doc).sort(), expected, `find title=${value}, ${at}`);
				for (const hit of found) assert.deepEqual(hit.fields, truth.get(hit.doc)!.fields, `fields of ${hit.doc}, ${at}`);

				const limit = 1 + randomBelow(random, NAMES.length);
				const page = await store.scan(limit);
				assert.deepEqual(page.map((f) => f.doc), [...truth.keys()].sort().slice(0, limit), `scan ${String(limit)}, ${at}`);
				break;
			}
			default: {
				// Removal forgets everything, open handles included.
				if (!truth.has(name)) break;
				await closeOne(name);
				await store.remove(name);
				truth.delete(name);
				assert.equal(await store.head(name), 0, `head after remove, ${at}`);
				assert.deepEqual(await store.since(name, 0), [], `tail after remove, ${at}`);
			}
		}
	}

	for (const name of [...open.keys()]) await closeOne(name);
};

/** A target over an in-memory driver, for the suites that need no database. */
export const memoryTarget = (driver: Driver): Target => ({
	store: createStore({ driver, declare: DECLARE }),
	again: () => createStore({ driver, declare: DECLARE }),
});
