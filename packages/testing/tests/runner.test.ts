// The conformance runner's own failure paths.
//
// This runner decides whether an implementation of the wire format is correct, so a check in
// it that cannot fail is worse than a missing check: every package downstream reads its
// silence as a pass. Each of these corrupts a fixture one way and asserts the runner says so,
// and names which check is being held to account.

import test from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { type Fixture, type InvalidFixture, checkFixture, checkInvalidFixture } from '../src/index.ts';

const root = join(import.meta.dirname, '..', '..', '..');

const load = (name: string): Fixture =>
	JSON.parse(readFileSync(join(root, 'spec/fixtures', name), 'utf8')) as Fixture;

const loadInvalid = (name: string): InvalidFixture =>
	JSON.parse(readFileSync(join(root, 'spec/fixtures/invalid', name), 'utf8')) as InvalidFixture;

/** The fixture types are deeply readonly, which is right everywhere except here. */
type Mutable<T> = T extends readonly (infer U)[]
	? Mutable<U>[]
	: T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;

/** A deep copy, so a corruption in one case cannot leak into the next. */
const copy = <T>(value: T): Mutable<T> => JSON.parse(JSON.stringify(value)) as Mutable<T>;

const refuses = (fn: () => void, contains: string): void => {
	assert.throws(fn, (e: Error) => {
		assert.ok(
			e.message.includes(contains),
			`expected a failure mentioning ${JSON.stringify(contains)}, got: ${e.message}`,
		);
		return true;
	});
};

test('the runner passes the suite it is pointed at', () => {
	checkFixture(load('001-object-slots.json'));
	checkInvalidFixture(loadInvalid('001-non-canonical-integer.json'));
});

test('a fixture whose bytes do not mean what it says is caught', () => {
	const f = copy(load('001-object-slots.json'));
	f.commits[0]!.deltas[0]!.id = 'AAAAAAAAAAAAAAB_';

	refuses(() => checkFixture(f as Fixture), 'the bytes do not mean what the fixture says');
});

test('a fixture whose stated bytes are not what its deltas encode to is caught', () => {
	const f = copy(load('001-object-slots.json'));
	// Truncating the hex keeps it parseable and makes the bytes and the deltas disagree.
	f.commits[0]!.bytes = f.commits[0]!.bytes.slice(0, -2);

	assert.throws(() => checkFixture(f as Fixture));
});

test('a fixture whose final document is wrong is caught', () => {
	const f = copy(load('001-object-slots.json'));
	const first = Object.keys(f.final.observables)[0]!;
	f.final.observables[first]!.slots.somethingNobodyWrote = 'x';

	refuses(() => checkFixture(f as Fixture), 'did not reach the stated document');
});

test('an apply-stage rejection fixture with no initial document is caught', () => {
	const f = copy(loadInvalid('029-add-over-existing.json'));
	delete (f as { initial?: unknown }).initial;

	refuses(() => checkInvalidFixture(f as InvalidFixture), 'must state an initial document');
});

test('a rejection fixture that is actually accepted is caught', () => {
	const f = copy(loadInvalid('001-non-canonical-integer.json'));
	// Point it at bytes that decode cleanly, so nothing refuses it.
	f.bytes = load('001-object-slots.json').commits[0]!.bytes;

	refuses(() => checkInvalidFixture(f as InvalidFixture), 'accepted, but must be refused');
});

test('a rejection fixture refused for the wrong reason is caught', () => {
	const f = copy(loadInvalid('001-non-canonical-integer.json'));
	f.reason = 'a-reason-nothing-throws';

	refuses(() => checkInvalidFixture(f as InvalidFixture), 'expected a-reason-nothing-throws');
});
