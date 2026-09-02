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
	apply, atomic, createArray, createMap, createObject, idOf, observer, snapshot, textIdOf,
} from '@aweftjs/core';
import type { Snapshot } from '@aweftjs/core';
import { randomBelow, randomFrom } from '@aweftjs/testing';
import { createId } from '@aweftjs/codec';
import type { Commit, Delta } from '@aweftjs/codec';

import { REST, createIndex, pathOf, record, validate } from '../src/index.ts';
import type { Policy } from '../src/index.ts';
import { idFromText } from '@aweftjs/testing';

const OPEN: Policy = [{ effect: 'allow', path: [REST] }];

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

// --- the validator against the applier ---------------------------------------------------
//
// Design 035 claimed the two shared reason tokens refuse the same input for the same cause,
// and nothing checked it, so it drifted: the applier does not count a commit's own detachments
// and the validator did, which refused a commit one ordinary atomic block produces. Design 037
// settles which one follows the other. This is the check that fails when they part again.
//
// The suites either side of it cannot see this. The conformance suite feeds the validator only
// commits the fixtures already accept, and the index-versus-document check above never calls
// validate at all. Each half was checked against something and the seam against nothing.

const SHARED = ['unreachable', 'multiple-attach'];

/** A pile of deltas of the shapes that make the two disagree, if anything does. */
const commitsFor = (
	seed: number,
	doc: Record<string, unknown>,
	known: object[],
): Commit[] => {
	const random = randomFrom(seed);
	const pick = <T>(from: readonly T[]): T => from[randomBelow(random, from.length)]!;
	const name = (): string => `k${randomBelow(random, 5)}`;
	const out: Commit[] = [];

	for (let i = 0; i < 60; i++) {
		const deltas: Delta[] = [];
		const count = 1 + randomBelow(random, 3);

		for (let d = 0; d < count; d++) {
			const holder = pick(known);
			const slot = name();
			const shape = randomBelow(random, 6);

			if (shape === 0) {
				deltas.push({ type: 'remove', id: idOf(holder), ref: { kind: 'object', key: slot } });
			} else if (shape === 1) {
				deltas.push({
					type: pick(['add', 'replace'] as const),
					id: idOf(holder),
					ref: { kind: 'object', key: slot },
					value: randomBelow(random, 100),
				});
			} else {
				// A reference: to something already in the document, or to an id nothing holds.
				const target = shape === 5 ? createId() : idOf(pick(known));
				deltas.push({
					type: pick(['add', 'replace'] as const),
					id: idOf(holder),
					ref: { kind: 'object', key: slot },
					value: { edge: pick(['attach', 'alias'] as const), kind: 'object', id: target },
				});
			}
		}

		out.push({ deltas });
	}

	// Two shapes worth guaranteeing rather than hoping the generator reaches: writing into a
	// subtree the same commit detaches, and moving an observable and writing it in one breath.
	const child = known.find((o) => o !== doc);
	if (child !== undefined) {
		out.push({ deltas: [
			{ type: 'remove', id: idOf(doc), ref: { kind: 'object', key: 'k0' } },
			{ type: 'add', id: idOf(child), ref: { kind: 'object', key: 'late' }, value: 1 },
		] });
	}

	return out;
};

test('the validator and the applier refuse the same commits for the same reasons', () => {
	for (let run = 1; run <= 12; run++) {
		const seed = run * 7717;
		const doc = createObject<Record<string, unknown>>();
		const index = createIndex(idOf(doc));
		observer(doc).watch((change) => record(index, change));

		const known: object[] = [doc];
		atomic(() => {
			for (let i = 0; i < 4; i++) {
				const child = createObject<Record<string, unknown>>();
				doc[`k${i}`] = child;
				known.push(child);
			}
		});
		for (const child of known.slice(1)) {
			(child as Record<string, unknown>).leaf = 'x';
		}

		let judged = 0;
		let refusedBoth = 0;

		for (const commit of commitsFor(seed, doc, known)) {
			const verdict = validate(commit, { index, policy: OPEN, actor: { id: 'anyone' } });

			let refusal: string | undefined;
			try {
				apply(doc, commit);
			} catch (error) {
				refusal = (error as { reason?: string }).reason;
			}
			judged += 1;

			// No false refusal: a commit the validator turns away must be one the applier turns
			// away too, because a refusal costs the client the edit under design 011.
			if (!verdict.ok) {
				const code = verdict.reasons[0]!.code;
				assert.ok(
					refusal !== undefined,
					`seed ${seed}: the validator refused ${code} and the applier accepted the commit`,
				);
				// When the applier refuses for a cause the validator also decides, the cause has
				// to be the same one. When it refuses for a cause the validator cannot see, such
				// as a slot that is taken or empty, it has simply found something first.
				if (SHARED.includes(refusal!)) {
					assert.equal(
						refusal,
						code,
						`seed ${seed}: the two refused one commit for two different stated causes`,
					);
				}
				refusedBoth += 1;
				continue;
			}

			// No false acceptance: the two causes the validator decides are the two it must
			// never let past.
			assert.ok(
				refusal === undefined || !SHARED.includes(refusal),
				`seed ${seed}: the validator accepted a commit the applier refused as ${String(refusal)}`,
			);
		}

		assert.ok(judged >= 60, `seed ${seed}: only ${judged} commits judged`);
		assert.ok(refusedBoth > 0, `seed ${seed}: nothing was refused, so the check proved nothing`);
	}
});
