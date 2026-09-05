// Random trees under random edits, checked against a model of what the tree should read as.
// Seeded, so a failure prints its seed and the run repeats exactly; a failing seed becomes a
// named case here.

import test from 'node:test';
import assert from 'node:assert/strict';

import { atomic, createArray, createObject, mutable, mutableArray, observer } from '@aweftjs/core';
import { randomBelow, randomFrom } from '@aweftjs/testing';

import type { Cleanup, Mounted } from '../src/index.ts';
import { createDocument, h, mount, toHtml } from '../src/index.ts';

interface Row extends Record<string, unknown> { label?: string; kind?: string }

/** Every row renders as its kind says, so the model can say what the tree must read as. */
const Rowc = ({ each }: { each: Row }, cleanup: Cleanup, mounted: Mounted) => {
	const label = observer(each).path('label');
	switch (each.kind) {
		case 'text': return label;
		case 'pair': return [h('b', {}, label), h('i', {}, label)];
		case 'empty': return null;
		default: {
			mounted(() => undefined);
			cleanup(() => undefined);
			return h('li', {}, label);
		}
	}
};

const expected = (rows: readonly Row[]): string => rows.map((r) => {
	const label = String(r.label);
	if (r.kind === 'text') return label;
	if (r.kind === 'pair') return `<b>${label}</b><i>${label}</i>`;
	if (r.kind === 'empty') return '';
	return `<li>${label}</li>`;
}).join('');

const KINDS = ['li', 'text', 'pair', 'empty'];

test('a document list under random atomic edits reads as its model', () => {
	for (const seed of [1, 42, 20260904, 0x5f3759df]) {
		const next = randomFrom(seed);
		const doc = createDocument();
		const rows = createArray<Row>();
		let made = 0;
		const make = (): Row => createObject<Row>({ label: `r${made++}`, kind: KINDS[randomBelow(next, KINDS.length)]! });
		for (let i = 0; i < 5; i++) rows.push(make());
		mount(doc.body, h('ul', {}, h(Rowc, { each: rows })));

		for (let step = 0; step < 120; step++) {
			atomic(() => {
				const edits = 1 + randomBelow(next, 3);
				for (let e = 0; e < edits; e++) {
					const roll = randomBelow(next, 7);
					const at = rows.length === 0 ? 0 : randomBelow(next, rows.length);
					if (roll === 0 || rows.length === 0) rows.push(make());
					else if (roll === 1) rows.splice(at, 0, make());
					else if (roll === 2) rows.splice(at, 1);
					else if (roll === 3) rows[at]!.label = `e${step}`;
					else if (roll === 4 && rows.length > 1) {
						const other = randomBelow(next, rows.length);
						const t = rows[at]!;
						rows[at] = rows[other]!;
						rows[other] = t;
					} else if (roll === 5) rows.splice(0, rows.length);
					else rows[at] = make();
				}
			});
			assert.equal(toHtml(doc.body), `<body><ul>${expected([...rows])}</ul></body>`, `seed ${seed} step ${step}`);
		}
	}
});

test('a cell of an array under random replacement reads as its model, duplicates and all', () => {
	for (const seed of [3, 777, 20260904]) {
		const next = randomFrom(seed);
		const doc = createDocument();
		const pool: unknown[] = ['a', 'b', 'c', h('p', {}, 'p1'), h('p', {}, 'p2'), null];
		const items = mutable<unknown[]>([]);
		mount(doc.body, items);
		const label = (v: unknown): string => (v === null ? '' : typeof v === 'string' ? v : toHtml(v as never));

		for (let step = 0; step < 80; step++) {
			const count = randomBelow(next, 6);
			const picked: unknown[] = [];
			const usedNodes = new Set<unknown>();
			for (let i = 0; i < count; i++) {
				const v = pool[randomBelow(next, pool.length)];
				if (typeof v === 'object' && v !== null) {
					if (usedNodes.has(v)) continue;
					usedNodes.add(v);
				}
				picked.push(v);
			}
			items.set(picked);
			assert.equal(toHtml(doc.body), `<body>${picked.map(label).join('')}</body>`, `seed ${seed} step ${step}`);
		}
	}
});

test('a mutable array under random edits reads as its model', () => {
	for (const seed of [9, 20260904]) {
		const next = randomFrom(seed);
		const doc = createDocument();
		const list = mutableArray<string>();
		mount(doc.body, h('div', {}, list));
		let n = 0;
		for (let step = 0; step < 150; step++) {
			const roll = randomBelow(next, 6);
			const at = list.length === 0 ? 0 : randomBelow(next, list.length);
			if (roll === 0 || list.length === 0) list.push(`v${n++}`);
			else if (roll === 1) list.splice(at, 0, `v${n++}`);
			else if (roll === 2) list.splice(at, 1);
			else if (roll === 3) list[at] = `v${n++}`;
			else if (roll === 4) list.splice(at, randomBelow(next, 3), `v${n++}`, `v${n++}`);
			else list.length = at;
			assert.equal(toHtml(doc.body), `<body><div>${[...list].join('')}</div></body>`, `seed ${seed} step ${step}`);
		}
	}
});
