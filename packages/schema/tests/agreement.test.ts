// The index against a living document.
//
// The conformance suite checks the index against a rebuild of the same commit stream. This
// checks it against the other thing the stream produced: the document itself. Core applies
// the commits and holds the tree; this package folds the same commits into parent pointers
// and never sees the tree. If they ever disagree about where something lives, one of them is
// wrong about a document that is in front of both of them.
//
// A failure prints its seed, and the seed is what repeats the run exactly.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
	atomic, createArray, createMap, createObject, idOf, observer, snapshot, textIdOf,
} from '@aweftjs/core';
import type { Snapshot } from '@aweftjs/core';
import { randomBelow, randomFrom } from '@aweftjs/testing';

import { createIndex, pathOf, record } from '../src/index.ts';
import { idFromText } from '@aweftjs/testing';

/** Where each observable sits, read off the document itself, walking down from the root. */
const placesIn = (state: Snapshot): Map<string, readonly string[]> => {
	const places = new Map<string, readonly string[]>([[state.root, []]]);
	const queue = [state.root];

	while (queue.length > 0) {
		const at = queue.shift()!;
		const here = places.get(at)!;

		for (const [slot, value] of Object.entries(state.observables[at]?.slots ?? {})) {
			if (value === null || typeof value !== 'object' || value instanceof Uint8Array) continue;
			if (value.edge !== 'attach' || places.has(value.ref)) continue;

			places.set(value.ref, [...here, slot]);
			queue.push(value.ref);
		}
	}

	return places;
};

interface Bag extends Record<string, unknown> {}

const run = (seed: number): void => {
	const random = randomFrom(seed);
	const doc = createObject<Bag>();
	const index = createIndex(idOf(doc));

	const stop = observer(doc).watch((change) => record(index, change));

	// Every observable the run has made, so a mutation can reach for one that already exists
	// and produce moves, aliases and second references rather than only fresh trees.
	const made: object[] = [doc];
	const pick = (): object => made[randomBelow(random, made.length)]!;

	const holders = (): Array<Record<string, unknown>> =>
		made.filter((o) => !Array.isArray(o) && !(o instanceof Map)) as Array<Record<string, unknown>>;

	for (let step = 0; step < 120; step++) {
		const choice = randomBelow(random, 10);
		const where = holders()[randomBelow(random, holders().length)]!;
		const name = `k${randomBelow(random, 6)}`;

		try {
			if (choice < 3) {
				where[name] = randomBelow(random, 1000);
			} else if (choice < 5) {
				const child = createObject<Bag>({});
				made.push(child);
				where[name] = child;
			} else if (choice === 5) {
				const list = createArray<unknown>([]);
				made.push(list);
				where[name] = list;
			} else if (choice === 6) {
				const map = createMap<unknown>();
				made.push(map);
				where[name] = map;
			} else if (choice === 7) {
				delete where[name];
			} else if (choice === 8) {
				// A move: take it out of wherever it is and put it somewhere else, in one commit.
				const moving = pick();
				const target = holders()[randomBelow(random, holders().length)]!;
				if (moving !== doc && moving !== target) {
					atomic(() => {
						for (const holder of holders()) {
							for (const [slot, value] of Object.entries(holder)) {
								if (value === moving) delete holder[slot];
							}
						}
						target[name] = moving;
					});
				}
			} else {
				const list = made.find((o) => Array.isArray(o)) as unknown[] | undefined;
				if (list !== undefined) list.push(randomBelow(random, 100));
			}
		} catch {
			// A mutation core refuses (writing through something detached, attaching into itself)
			// produces no commit, so the index hears nothing and the two stay in step. That is
			// the property under test, not an exception to it.
			continue;
		}

		const places = placesIn(snapshot(doc));
		for (const [id, path] of places) {
			assert.deepEqual(
				pathOf(index, idFromText(id)),
				path,
				`seed ${seed}, step ${step}: the index and the document disagree about ${id}`,
			);
		}

		// Anything the document no longer reaches, the index must not place either.
		for (const observable of made) {
			const id = textIdOf(observable);
			if (places.has(id)) continue;
			assert.equal(
				pathOf(index, idFromText(id)),
				undefined,
				`seed ${seed}, step ${step}: the index still places ${id}, which the document dropped`,
			);
		}
	}

	stop();
};

test('the index agrees with the document it was fed, over a random edit stream', () => {
	for (let seed = 1; seed <= 40; seed++) run(seed * 20260901);
});
