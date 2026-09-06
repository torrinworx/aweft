// A commit read back as what it did.
//
// A delta names an observable by id and a slot by ref, which is what a wire needs and not what
// a reader needs. Given the document the commit landed in, the ids become paths; without one,
// the id text is all there is to say and saying it is better than guessing.

import { idToText, slotKeyOf, type Commit, type Delta } from '@aweftjs/codec';
import { snapshot } from '@aweftjs/core';

import type { Described, Fact } from './described.ts';

// Every id in the document, mapped to the path that reaches it. Built once per call, because a
// commit touching n slots would otherwise walk the document n times.
const paths = (document: unknown): Map<string, string> => {
	const found = new Map<string, string>();
	let snap;
	try {
		snap = snapshot(document);
	} catch {
		// The caller passed something that is not a document. That is not worth throwing over
		// inside a debug call: the commit still reads, just without paths.
		return found;
	}

	const walk = (id: string, path: string): void => {
		if (found.has(id)) return;
		found.set(id, path);
		const node = snap.observables[id];
		if (node === undefined) return;

		// Array slots are position keys, ordered as byte strings. Sorting them recovers the
		// index, which is the only part of an array address a reader can use.
		const entries = Object.entries(node.slots);
		if (node.kind === 'array') entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

		let index = 0;
		for (const [slot, held] of entries) {
			const step = node.kind === 'array' ? `[${index++}]` : slot;
			if (typeof held === 'object' && held !== null && !(held instanceof Uint8Array)) {
				walk(held.ref, node.kind === 'array' ? `${path}${step}` : path === '' ? step : `${path}.${step}`);
			}
		}
	};
	walk(snap.root, '');
	return found;
};

// The slot an array delta names is a position key. Unlike a walk of the document, a delta on its
// own carries no way to turn one into an index: the index depends on every other position in
// that array, which the delta does not carry. So it prints as the key, marked as one.
const stepFor = (delta: Delta): string =>
	delta.ref.kind === 'array' ? `[at ${slotKeyOf(delta.ref)}]` : slotKeyOf(delta.ref);

const deltaOf = (delta: Delta, where: ReadonlyMap<string, string>): Described => {
	const id = idToText(delta.id);
	const at = where.get(id);
	const step = stepFor(delta);
	const path = at === undefined || at === ''
		? step
		: delta.ref.kind === 'array' ? `${at}${step}` : `${at}.${step}`;

	const facts: Fact[] = [];
	if (delta.value !== undefined) facts.push(['value', delta.value]);
	if (at === undefined) facts.push(['in', id]);

	return { kind: delta.type, id: path, facts };
};

/**
 * A commit as the list of what it changed.
 *
 * Params:
 *   commit: the commit, as a watcher receives it or as `inverse()` returns it
 *   document: optional, the document it landed in. With it, every id becomes the path that
 *     reaches it; without it, each delta names its observable by id text
 *
 * Returns: the described commit, ready for `render`.
 *
 * Example:
 *   observer(doc).watch((change) => console.log(render(commitOf(change, doc))));
 */
export const commitOf = (commit: Commit, document?: unknown): Described => {
	const where = document === undefined ? new Map<string, string>() : paths(document);
	const facts: Fact[] = [['deltas', commit.deltas.length]];
	if (commit.tag !== undefined) facts.push(['tag', commit.tag]);

	return { kind: 'commit', facts, children: commit.deltas.map((d) => deltaOf(d, where)) };
};
