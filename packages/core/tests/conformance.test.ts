// The fixtures again, through real observables.
//
// The suite already runs against the harness's model of the format. This run is what makes it
// worth having: two independent readings of the same bytes, one plain data and one a live
// reactive tree, have to reach the same document from the same commits, in every order the
// deltas can arrive in. A disagreement between them is a defect in one of the two, and until
// there were two there was nothing to disagree.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { bytesFromHex, bytesToHex, idFromText } from '@aweftjs/codec';
import type {
	Applier, DocumentJson, Fixture, InvalidFixture, ObservableJson, ValueJson,
} from '@aweftjs/testing';
import { checkFixture, checkInvalidFixture } from '@aweftjs/testing';

import { alias, apply, createArray, createMap, createObject, insertAt, snapshot } from '../src/index.ts';

const dir = new URL('../../../spec/fixtures/', import.meta.url);
const invalidDir = new URL('invalid/', dir);

const jsonFiles = (at: URL): string[] => readdirSync(at).filter((f) => f.endsWith('.json')).sort();

const read = <T>(at: URL, file: string): T => JSON.parse(readFileSync(new URL(file, at), 'utf8')) as T;

interface MapLike {
	set(key: string, value: unknown): void;
}

const valueOf = (value: ValueJson, made: Map<string, object>): unknown => {
	if (value === null || typeof value !== 'object') return value;
	if ('bytes' in value) return bytesFromHex(value.bytes);

	const observable = made.get(value.ref)!;
	return value.edge === 'attach' ? observable : alias(observable);
};

/** Build a live document from the plain one a fixture states. */
const build = (initial: DocumentJson): object => {
	const made = new Map<string, object>();

	for (const [key, observable] of Object.entries(initial.observables)) {
		const id = idFromText(key);
		made.set(
			key,
			observable.kind === 'object'
				? createObject(undefined, id)
				: observable.kind === 'array'
					? createArray(undefined, id)
					: createMap(undefined, id),
		);
	}

	for (const [key, observable] of Object.entries(initial.observables)) {
		const holder = made.get(key)!;

		for (const [slot, value] of Object.entries(observable.slots)) {
			const held = valueOf(value, made);

			if (observable.kind === 'object') (holder as Record<string, unknown>)[slot] = held;
			else if (observable.kind === 'array') insertAt(holder, bytesFromHex(slot), held);
			else (holder as MapLike).set(slot, held);
		}
	}

	return made.get(initial.root)!;
};

/** Read the live document back into the plain shape a fixture is stated in. */
const plain = (document: object): DocumentJson => {
	const taken = snapshot(document);
	const observables: Record<string, ObservableJson> = {};

	for (const [key, observable] of Object.entries(taken.observables)) {
		const slots: Record<string, ValueJson> = {};
		for (const [slot, value] of Object.entries(observable.slots)) {
			slots[slot] = value instanceof Uint8Array ? { bytes: bytesToHex(value) } : value;
		}
		observables[key] = { kind: observable.kind, slots };
	}

	return { root: taken.root, observables };
};

const live: Applier = (initial, commits) => {
	const document = build(initial);
	for (const commit of commits) apply(document, commit);
	return plain(document);
};

const fixtures = jsonFiles(dir);
const rejections = jsonFiles(invalidDir);

test('there are fixtures to run', () => {
	assert.ok(fixtures.length >= 10, `found ${fixtures.length} fixtures`);
	assert.ok(rejections.length >= 20, `found ${rejections.length} rejection fixtures`);
});

for (const file of fixtures) {
	test(`fixture ${file} through observables`, () => {
		checkFixture(read<Fixture>(dir, file), live);
	});
}

for (const file of rejections) {
	test(`observables reject ${file}`, () => {
		checkInvalidFixture(read<InvalidFixture>(invalidDir, file), live);
	});
}
