// Random commits against random descriptions, judged twice.
//
// `check` answers from a commit and a path walk. The oracle answers from the finished
// document and nothing else. If the two ever disagree, one of them is wrong, and the seed
// printed by the failure runs the same commits again.

import test from 'node:test';
import assert from 'node:assert/strict';

import { randomBelow, randomFrom } from '@aweftjs/testing';
import {
	createArray, createMap, createObject, fromSnapshot, isObservable, kindOf, observer, parentOf,
	snapshot, textIdOf,
} from '@aweftjs/core';
import type { ObservableKind, ObservableMap } from '@aweftjs/core';

import { check, list, shape, table } from '../src/index.ts';
import type { Commit, Shape } from '../src/index.ts';
import { flag, number, text } from './validators.ts';
import { disagreements } from './oracle.ts';

type Field = Extract<Shape, { kind: 'array' }>['item'];
type Random = () => number;
/** What a valid value for one described slot looks like, kept beside the description. */
type Makers = Map<object, () => unknown>;

const NAMES = ['a', 'b', 'c'];
const WORDS = ['plan', 'ship', 'draft', 'read'];

const one = <T>(random: Random, from: readonly T[]): T => from[randomBelow(random, from.length)]!;

const isLeaf = (field: Field): boolean => '~standard' in field;

const randomLeaf = (random: Random, makers: Makers): Field => {
	const pick = randomBelow(random, 3);

	if (pick === 0) {
		const form = text({ min: 1, max: 8 });
		makers.set(form, () => one(random, WORDS));
		return form;
	}
	if (pick === 1) {
		const form = number({ min: 0, max: 100 });
		makers.set(form, () => randomBelow(random, 101));
		return form;
	}

	const form = flag();
	makers.set(form, () => randomBelow(random, 2) === 1);
	return form;
};

const randomShape = (random: Random, makers: Makers, depth: number): Shape => {
	const pick = randomBelow(random, 3);

	if (pick === 0) {
		const fields: Record<string, Field> = {};
		const count = 1 + randomBelow(random, NAMES.length);
		for (let i = 0; i < count; i++) fields[NAMES[i]!] = randomField(random, makers, depth - 1);

		const form = shape(fields);
		makers.set(form, () => createObject(Object.fromEntries(
			Object.entries(fields).map(([name, field]) => [name, makers.get(field)!()]),
		)));
		return form;
	}

	if (pick === 1) {
		const item = randomField(random, makers, depth - 1);
		const form = list(item);
		makers.set(form, () => createArray(
			Array.from({ length: randomBelow(random, 3) }, () => makers.get(item)!()),
		));
		return form;
	}

	const value = randomField(random, makers, depth - 1);
	const form = table(value);
	makers.set(form, () => {
		const made = createMap<unknown>();
		const count = randomBelow(random, 3);
		for (let i = 0; i < count; i++) made.set(textIdOf(createObject({})), makers.get(value)!());
		return made;
	});
	return form;
};

const randomField = (random: Random, makers: Makers, depth: number): Field =>
	depth <= 0 || randomBelow(random, 2) === 0
		? randomLeaf(random, makers)
		: randomShape(random, makers, depth);

// --- reading the document a description was made for ------------------------------------

interface Holder {
	readonly at: object;
	readonly kind: ObservableKind;
	/** The description of this observable, when the document still matches it here. */
	readonly described: Shape | undefined;
}

interface Spot extends Holder {
	readonly slot: string;
	/** Where in an array, or -1. A position is what an array is keyed by; an index writes it. */
	readonly index: number;
	readonly field: Field | undefined;
}

const fieldOf = (described: Shape | undefined, slot: string): Field | undefined => {
	if (described === undefined) return undefined;
	if (described.kind === 'object') return described.fields[slot];
	return described.kind === 'array' ? described.item : described.value;
};

const survey = (root: object, form: Shape): { holders: Holder[]; spots: Spot[] } => {
	const holders: Holder[] = [];
	const spots: Spot[] = [];
	const stack: Holder[] = [{ at: root, kind: kindOf(root), described: form }];

	while (stack.length > 0) {
		const holder = stack.pop()!;
		const described = holder.described?.kind === holder.kind ? holder.described : undefined;
		holders.push({ ...holder, described });

		const record = (slot: string, index: number, value: unknown): void => {
			const field = fieldOf(described, slot);
			spots.push({ ...holder, described, slot, index, field });

			if (!isObservable(value) || parentOf(value) !== holder.at) return;
			stack.push({
				at: value as object,
				kind: kindOf(value),
				described: field !== undefined && !isLeaf(field) ? (field as Shape) : undefined,
			});
		};

		if (holder.kind === 'object') {
			const at = holder.at as Record<string, unknown>;
			for (const key of Object.keys(at)) record(key, -1, at[key]);
		} else if (holder.kind === 'array') {
			const at = holder.at as unknown[];
			for (let i = 0; i < at.length; i++) record(String(i), i, at[i]);
		} else {
			for (const [key, value] of (holder.at as ObservableMap<unknown>).entries()) {
				record(key, -1, value);
			}
		}
	}

	return { holders, spots };
};

// --- making a change ---------------------------------------------------------------------

const junk = (random: Random): unknown => {
	const pick = randomBelow(random, 8);
	if (pick === 0) return '';
	if (pick === 1) return 'far too long to be a title anywhere';
	if (pick === 2) return -1;
	if (pick === 3) return null;
	if (pick === 4) return true;
	if (pick === 5) return createObject({ z: 1 });
	if (pick === 6) return createArray([1]);
	return createMap<unknown>();
};

/** Half the time something the description would take, so a valid verdict happens too. */
const pick = (field: Field | undefined, random: Random, makers: Makers): unknown => {
	const maker = field === undefined ? undefined : makers.get(field);
	return maker !== undefined && randomBelow(random, 2) === 0 ? maker() : junk(random);
};

const writeAt = (spot: Spot, value: unknown): void => {
	if (spot.kind === 'object') (spot.at as Record<string, unknown>)[spot.slot] = value;
	else if (spot.kind === 'array') (spot.at as unknown[])[spot.index] = value;
	else (spot.at as ObservableMap<unknown>).set(spot.slot, value);
};

const removeAt = (spot: Spot): void => {
	if (spot.kind === 'object') delete (spot.at as Record<string, unknown>)[spot.slot];
	else if (spot.kind === 'array') (spot.at as unknown[]).splice(spot.index, 1);
	else (spot.at as ObservableMap<unknown>).delete(spot.slot);
};

const addTo = (holder: Holder, random: Random, makers: Makers): void => {
	if (holder.kind === 'array') {
		(holder.at as unknown[]).push(pick(fieldOf(holder.described, '0'), random, makers));
		return;
	}
	if (holder.kind === 'map') {
		const key = textIdOf(createObject({}));
		(holder.at as ObservableMap<unknown>).set(key, pick(fieldOf(holder.described, key), random, makers));
		return;
	}

	const described = holder.described;
	const known = described?.kind === 'object' ? Object.keys(described.fields) : [];
	const slot = one(random, [...known, 'zz']);
	(holder.at as Record<string, unknown>)[slot] = pick(fieldOf(described, slot), random, makers);
};

const commitFrom = (doc: object, run: () => void): Commit | undefined => {
	let out: Commit | undefined;
	const stop = observer(doc).watch((change) => {
		out = { deltas: [...change.deltas] };
	});

	try {
		run();
	} catch {
		// A mutation core itself refuses is not a commit, so there is nothing to judge.
	} finally {
		stop();
	}

	return out;
};

const mutate = (doc: object, form: Shape, random: Random, makers: Makers): Commit | undefined => {
	const { holders, spots } = survey(doc, form);
	const roll = randomBelow(random, 10);

	return commitFrom(doc, () => {
		if (roll < 7 && spots.length > 0) {
			const spot = one(random, spots);
			if (roll < 5) writeAt(spot, pick(spot.field, random, makers));
			else removeAt(spot);
			return;
		}
		addTo(one(random, holders), random, makers);
	});
};

// --- the property --------------------------------------------------------------------------

test('check and a whole-document reading never disagree about a commit', () => {
	const seed = Number(process.env.SEED ?? 20260903);
	const random = randomFrom(seed);
	let commits = 0;
	let accepted = 0;

	for (let round = 0; round < 60; round++) {
		const makers: Makers = new Map();
		const form = randomShape(random, makers, 2);
		let doc = makers.get(form)!() as object;

		assert.deepEqual(disagreements(doc, form), [],
			`seed ${seed} round ${round}: the generated document does not match its own description`);

		for (let step = 0; step < 25; step++) {
			const before = fromSnapshot(snapshot(doc));
			const trial = fromSnapshot(snapshot(doc)) as object;
			const commit = mutate(trial, form, random, makers);
			if (commit === undefined) continue;

			commits += 1;
			const where = `seed ${seed} round ${round} step ${step}`;
			const truth = disagreements(trial, form).length === 0;

			assert.equal(check(form, trial, commit).length === 0, truth,
				`${where}: check disagrees with the whole document, read after the commit`);
			assert.equal(check(form, before, commit).length === 0, truth,
				`${where}: check disagrees with itself, read before the commit`);

			if (truth) {
				accepted += 1;
				doc = trial;
			}
		}
	}

	assert.ok(commits > 800, `only ${commits} commits were generated`);
	assert.ok(accepted > 50, `only ${accepted} of ${commits} commits were valid: the generator refuses everything`);
	assert.ok(commits - accepted > 200, `only ${commits - accepted} commits were refused`);
});
