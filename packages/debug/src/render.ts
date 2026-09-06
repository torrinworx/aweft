// A described thing as lines a person or an agent reads.
//
// One renderer for everything, so a commit, a document and a mounted node are read in the same
// shape and the words mean the same thing in each (design 102). Text goes out of here and
// nowhere else.

import { idToText, isReference, type Value } from '@aweftjs/codec';

import type { Described, Fact } from './described.ts';

const MAX_BYTES = 32;

/** A value as one short line. Bytes print as hex, long text is cut, and nothing throws. */
export const value = (v: unknown): string => {
	try {
		return described(v);
	} catch {
		// Reading a value must never be what fails. A debug call that throws leaves its reader
		// worse off than the one they made it about.
		return '<unreadable>';
	}
};

const described = (v: unknown): string => {
	if (v === null) return 'null';
	if (v === undefined) return 'undefined';
	if (typeof v === 'string') return v.length > 60 ? `'${v.slice(0, 57)}...'` : `'${v}'`;
	if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);

	if (v instanceof Uint8Array) {
		const head = [...v.slice(0, MAX_BYTES)].map((b) => b.toString(16).padStart(2, '0')).join('');
		return v.length > MAX_BYTES ? `0x${head}... (${v.length} bytes)` : `0x${head}`;
	}

	if (typeof v === 'function') return `${v.name === '' ? 'anonymous' : v.name}()`;

	// A slot holding an observable carries a reference to it, not the observable. Saying which
	// one is the whole point; `[object Object]` is what this function exists to avoid.
	// `isReference` checks the shape itself, so narrowing to Value here only satisfies its
	// signature; anything that is not a reference falls through to the lines below.
	if (typeof v === 'object') {
		const held = v as Value;
		if (isReference(held)) {
			return `${held.edge === 'alias' ? 'alias to' : '->'} ${held.kind} ${idToText(held.id)}`;
		}
	}

	// Deliberately not JSON: an observable is a proxy whose own keys are the user's data, and
	// stringifying one here is how a debug call turns into a walk of the whole document.
	if (typeof v === 'object') return Object.prototype.toString.call(v);
	return String(v);
};

const factLine = ([label, held]: Fact): string => `${label}: ${value(held)}`;

const lines = (d: Described, depth: number): string[] => {
	const pad = '  '.repeat(depth);
	const head = d.id === undefined ? `${pad}${d.kind}` : `${pad}${d.kind} ${d.id}`;

	const out = [d.facts.length === 0 ? head : `${head}  (${d.facts.map(factLine).join(', ')})`];
	for (const child of d.children ?? []) out.push(...lines(child, depth + 1));
	return out;
};

/**
 * A described thing as text.
 *
 * Params:
 *   d: what a describe hook or one of this package's readers produced
 *
 * Returns: one line per node, children indented two spaces under their parent, no trailing
 * newline.
 *
 * Example:
 *   console.log(render(documentOf(doc)));
 */
export const render = (d: Described): string => lines(d, 0).join('\n');
