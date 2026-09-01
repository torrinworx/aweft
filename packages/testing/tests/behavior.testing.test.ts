// The behavioral corpus for the harness.
//
// The corpus is curated from a state library, and most of it is about observables, delivery
// and collections under mutation, none of which this package has. One case does bind it, and
// it is the case that decides whether a property test is worth running at all: a test over
// randomly generated input must be reproducible from what its failure prints, or the test
// gets marked flaky and disabled, and the bug it was catching ships.
//
// The corpus is append-only. Removing a case needs a design note.

import test from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { type Fixture, checkFixture, randomFrom, seedFrom, shuffle } from '../src/index.ts';

const root = join(import.meta.dirname, '..', '..', '..');

test('a generated stream is reproducible from the seed a failure would print', () => {
	// The whole value of a seeded generator is that the seed in a failure message is enough to
	// see the failure again. If it is not, the seed is decoration and the test is a rumour.
	const seed = 20260901;
	const run = (): number[] => {
		const next = randomFrom(seed);
		return Array.from({ length: 200 }, () => next());
	};

	assert.deepEqual(run(), run());
});

test('one reordering is not a reordering check, measured against the real suite', () => {
	const seed = seedFrom('some-fixture');
	assert.deepEqual(shuffle([1, 2, 3, 4, 5, 6], seed), shuffle([1, 2, 3, 4, 5, 6], seed),
		'the same seed has to give the same order, or a printed seed is decoration');

	// A shuffle may return the order it was given, and whether it does depends on the seed and
	// the length together. Measured over the suite as it stands rather than asserted from
	// taste: each commit's seed comes from its fixture name, and for some of them the shuffle
	// is the identity, so a check built on that one permutation silently repeats the check
	// above it. That is why the runner drives the same three orders the apply loop does.
	const dir = join(root, 'spec/fixtures');
	let identity = 0;
	let total = 0;

	for (const name of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
		const fixture = JSON.parse(readFileSync(join(dir, name), 'utf8')) as Fixture;
		const seedOf = seedFrom(fixture.name);

		for (const commit of fixture.commits) {
			total += 1;
			const order = shuffle(commit.deltas.map((_, i) => i), seedOf);
			if (order.every((v, i) => v === i)) identity += 1;
		}
	}

	assert.ok(total > 0, 'no fixtures were read');
	assert.ok(
		identity > 0,
		`the shuffle permuted all ${total} commits, so this case cannot show what it is for`,
	);
});

test('a conformance failure names the fixture it came from', () => {
	// A suite that runs fifty fixtures and reports "re-encoding is not byte equal" with no name
	// makes the reader bisect to find out which one. The name is part of the failure.
	const fixture = JSON.parse(
		readFileSync(join(root, 'spec/fixtures/001-object-slots.json'), 'utf8'),
	) as Fixture;

	const broken = JSON.parse(JSON.stringify(fixture)) as { name: string; final: { observables: Record<string, { slots: Record<string, unknown> }> } };
	const first = Object.keys(broken.final.observables)[0]!;
	broken.final.observables[first]!.slots.neverWritten = 1;

	assert.throws(() => checkFixture(broken as unknown as Fixture), (e: Error) => {
		assert.ok(e.message.includes(fixture.name), `failure does not name the fixture: ${e.message}`);
		return true;
	});
});
