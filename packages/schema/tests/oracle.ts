// A second reading of what a description means, done the slow obvious way.
//
// It resolves nothing and applies nothing: it takes a document that already holds whatever
// happened and walks it from the root, holding every slot it finds against the description at
// that place. It shares no code with `check`, which is the whole point. An expected value
// taken from the thing under test compares that thing against its own past behaviour and
// cannot see it disagree with what was specified.

import { snapshot } from '@aweftjs/core';
import type { SnapshotValue } from '@aweftjs/core';

import type { Shape } from '../src/index.ts';

/** What a slot may hold, named by pulling it back out of the exported description type. */
type Field = Extract<Shape, { kind: 'array' }>['item'];

const isRef = (value: SnapshotValue): value is Extract<SnapshotValue, { ref: string }> =>
	value !== null && typeof value === 'object' && !(value instanceof Uint8Array);

const isLeaf = (field: Field): field is Extract<Field, { '~standard': unknown }> =>
	'~standard' in field;

/** Every place the document disagrees with the description, as a path and a word for why. */
export const disagreements = (document: object, form: Shape): string[] => {
	const snap = snapshot(document);
	const problems: string[] = [];

	const walk = (id: string, described: Shape, at: readonly string[]): void => {
		const entry = snap.observables[id]!;
		if (entry.kind !== described.kind) {
			problems.push(`${at.join('/')}: kind`);
			return;
		}

		// An object says which slots it has, so a slot the description names and the document
		// does not is as much a disagreement as the other way round. An array or a map has
		// whatever elements it has.
		const names = described.kind === 'object'
			? new Set([...Object.keys(described.fields), ...Object.keys(entry.slots)])
			: new Set(Object.keys(entry.slots));

		for (const slot of names) {
			const path = [...at, slot].join('/');
			const wanted: Field | undefined = described.kind === 'object'
				? described.fields[slot]
				: described.kind === 'array' ? described.item : described.value;

			if (wanted === undefined) {
				problems.push(`${path}: unexpected`);
				continue;
			}

			const held = entry.slots[slot];

			if (isLeaf(wanted)) {
				if (held !== undefined && isRef(held)) {
					problems.push(`${path}: kind`);
					continue;
				}
				const answer = wanted['~standard'].validate(held);
				const issues = (answer as { issues?: ReadonlyArray<unknown> }).issues;
				if (issues !== undefined) problems.push(`${path}: invalid`);
				continue;
			}

			if (held === undefined || !isRef(held) || held.kind !== wanted.kind) {
				problems.push(`${path}: kind`);
				continue;
			}
			if (held.edge === 'attach') walk(held.ref, wanted, [...at, slot]);
		}
	};

	walk(snap.root, form, []);
	return problems;
};
