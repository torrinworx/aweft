// Convergence: whatever order a handful of ends write in, they all end at one document.
//
// The property the package rests on, over shapes nobody chose by hand. Every end runs the
// same code, so there is nothing here that decides a winner: edits that commute converge on
// their own, and the one edit that does not commute is refused by the end that will not take
// it and yielded by the end that made it, with the undo the refusal came with.
//
// Seeds are committed for the named cases, so a failure repeats exactly. The sweep runs a
// hundred more and says how many.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { apply, atomic, createArray, createObject, idOf, snapshot } from '@aweftjs/core';
import { canonicalJson, randomBelow, randomFrom } from '@aweftjs/testing';
import { asCommit, connect, inProcess } from '@aweftjs/sync';
import type { Commit, Link, Refused, Shared, WireReason } from '@aweftjs/sync';

type Doc = Record<string, unknown>;

/** The one value the refusing end will hold in `sealed`. Anything else it turns away. */
const SEALED = 'held by the first end';

const REASON: WireReason = {
	code: 'not-here', message: 'sealed is not written from anywhere else', path: ['sealed'],
};

const settle = async (rounds: number): Promise<void> => {
	for (let i = 0; i < rounds; i++) await new Promise((done) => setTimeout(done, 0));
};

/** The first end's rule, and nobody else's: `sealed` keeps the value it has here. */
const guard = (commit: Commit): readonly WireReason[] =>
	commit.deltas.some((delta) =>
		delta.ref.kind === 'object' && delta.ref.key === 'sealed'
		&& (delta.type !== 'replace' || delta.value !== SEALED))
		? [REASON]
		: [];

const shape = (size: number): Doc => {
	const document = createObject<Doc>();
	atomic(() => {
		document.list = createArray<string>(['first', 'last']);
		document.sealed = SEALED;
		for (let i = 0; i < size; i++) document[`s${i}`] = 0;
	});
	return document;
};

/** A second end holding the same document: the same root id, and the same state in it. */
const copyOf = (source: Doc): Doc => {
	const held = createObject<Doc>(undefined, idOf(source));
	apply(held, asCommit(source)!);
	return held;
};

interface Wire {
	readonly a: number;
	readonly b: number;
	links: [Link, Link];
	shares: [Shared<Doc>, Shared<Doc>];
}

const edgesOf = (kind: 'chain' | 'star', size: number): [number, number][] =>
	kind === 'chain'
		? Array.from({ length: size - 1 }, (_, i) => [i, i + 1] as [number, number])
		: Array.from({ length: size - 1 }, (_, i) => [0, i + 1] as [number, number]);

const run = async (
	seed: number, kind: 'chain' | 'star', size: number, rounds: number, cuts: boolean,
): Promise<void> => {
	const rng = randomFrom(seed);
	const documents: Doc[] = [shape(size)];
	for (let i = 1; i < size; i++) documents.push(copyOf(documents[0]!));

	// One end refuses what it will not hold; the end beside it yields with the undo the
	// refusal carried. Nothing in the link decides which of the two that is.
	let yielding = false;
	const handlers = (at: number) => ({
		accept: at === 0 ? guard : undefined,
		refused: (report: Refused) => {
			if (!report.mine || report.undo === undefined || yielding) return;
			yielding = true;
			apply(documents[at]!, report.undo);
			yielding = false;
		},
	});

	const join = (a: number, b: number): Wire => {
		const [x, y] = inProcess();
		const links: [Link, Link] = [connect(x), connect(y)];
		return {
			a, b, links,
			shares: [
				links[0].share<Doc>('board', documents[a], handlers(a)),
				links[1].share<Doc>('board', documents[b], handlers(b)),
			],
		};
	};

	const wires = edgesOf(kind, size).map(([a, b]) => join(a, b));
	await settle(6);

	// The ends with one link are the ones that can throw their copy away and ask for it back:
	// nothing else holds the document they would be discarding. The first end is left out of
	// that, because it is the one whose rule the run checks and a state it asked for would move
	// it past its own rule.
	const leaves = Array.from({ length: size }, (_, i) => i)
		.filter((i) => i !== 0
			&& wires.filter((wire) => wire.a === i || wire.b === i).length === 1);

	const edit = (at: number, round: number): void => {
		const document = documents[at]!;
		const list = document.list as string[];
		const roll = randomBelow(rng, 100);

		if (roll < 45) {
			list.splice(randomBelow(rng, list.length + 1), 0, `${at}:${round}`);
		} else if (roll < 90) {
			document[`s${at}`] = round;
		} else if (at === 1 && document.sealed === SEALED) {
			// The one edit that does not commute, and the only one anybody refuses. It is only
			// ever made from the value the first end holds, so the undo the refusal comes with
			// puts the slot back to a value that end takes. Yielding with an undo of an undo
			// would be two ends arguing, which is what the second write of a pair produces.
			document.sealed = `written from end ${at} at ${round}`;
		}
	};

	for (let round = 0; round < rounds; round++) {
		const writers = 1 + randomBelow(rng, size);
		for (let i = 0; i < writers; i++) edit(randomBelow(rng, size), round);

		if (cuts && leaves.length > 0 && randomBelow(rng, 100) < 8) {
			const leaf = leaves[randomBelow(rng, leaves.length)]!;
			const wire = wires.find((held) => held.a === leaf || held.b === leaf)!;
			const far = wire.a === leaf ? wire.b : wire.a;

			for (const link of wire.links) link.close();
			await settle(2);

			const [x, y] = inProcess();
			const near = connect(x);
			const other = connect(y);
			wire.links = [near, other];
			// The end that was cut throws its copy away and asks for the document back.
			const asking = near.share<Doc>('board', undefined, handlers(leaf));
			const holding = other.share<Doc>('board', documents[far], handlers(far));
			wire.shares = [asking, holding];
			documents[leaf] = await asking.ready;
			await settle(6);
		}

		if (randomBelow(rng, 100) < 30) await settle(1 + randomBelow(rng, 3));
	}

	await settle(40);

	const truth = canonicalJson(snapshot(documents[0]!));
	for (let i = 1; i < size; i++) {
		assert.equal(
			canonicalJson(snapshot(documents[i]!)), truth,
			`end ${i} of a ${kind} of ${size} converged (seed ${seed})`,
		);
	}
	assert.equal(documents[0]!.sealed, SEALED, 'the slot the first end holds is untouched');

	for (const wire of wires) for (const link of wire.links) link.close();
};

// Named cases, so a failure the sweep found repeats exactly and stays checked.
const named: [number, 'chain' | 'star', number, boolean][] = [
	[20260903, 'chain', 3, false],
	[20260903, 'star', 4, false],
	[424242, 'chain', 5, false],
	[7, 'star', 5, true],
	[909090, 'chain', 4, true],
];

for (const [seed, kind, size, cuts] of named) {
	test(`a ${kind} of ${size} converges${cuts ? ' with the link cut under it' : ''}, seed ${seed}`, async () => {
		await run(seed, kind, size, 90, cuts);
	});
}

test('the convergence sweep: a hundred seeds over both shapes', async (t) => {
	const failures: string[] = [];
	let ran = 0;

	for (let seed = 1; seed <= 100; seed++) {
		const kind = seed % 2 === 0 ? 'chain' : 'star';
		const size = 3 + (seed % 3);
		ran += 1;
		try {
			await run(seed, kind, size, 30, seed % 4 === 0);
		} catch (error) {
			failures.push(`seed ${seed} (${kind} of ${size}): ${(error as Error).message}`);
		}
	}

	t.diagnostic(`convergence sweep: ${ran} runs, ${failures.length} failed`);
	assert.deepEqual(failures, [], 'every seed converged');
});
