// What deciding a commit costs on the shipped validator.
//
// G1a measured a prototype and produced the two choices this package was built on: a resident
// index rather than a rebuild, and parent pointers rather than cached paths. Those numbers do
// not carry over to shipped code on their own, so this measures the same questions against
// what actually runs, on the same document shape.
//
// Run: node bench/authority.ts
//
// CI does not gate on this. A performance claim cites this script and its recorded output.

import { createId } from '@aweftjs/codec';
import type { Commit, Delta } from '@aweftjs/codec';
import { ANY, REST, SELF, createIndex, pathOf, record, validate } from '@aweftjs/schema';
import type { Policy } from '@aweftjs/schema';

const measure = (label: string, runs: number, step: (iteration: number) => void): void => {
	for (let i = 0; i < Math.max(10, runs / 5); i++) step(i);

	let best = Infinity;
	for (let attempt = 0; attempt < 3; attempt++) {
		const started = process.hrtime.bigint();
		for (let i = 0; i < runs; i++) step(i);
		const took = Number(process.hrtime.bigint() - started) / 1e6;
		if (took < best) best = took;
	}

	console.log(`  ${label.padEnd(48)} ${((best / runs) * 1000).toFixed(3).padStart(9)} us`);
};

const attach = (holder: Uint8Array, slot: string, child: Uint8Array): Delta => ({
	type: 'add',
	id: holder,
	ref: { kind: 'object', key: slot },
	value: { edge: 'attach', kind: 'object', id: child },
});

const write = (holder: Uint8Array, slot: string): Delta => ({
	type: 'add', id: holder, ref: { kind: 'object', key: slot }, value: 'x',
});

const FANOUT = 13;
const DEPTH = 4;

const root = createId();
const index = createIndex(root);

let level = [root];
let total = 1;
let branch = root;
for (let d = 0; d < DEPTH; d++) {
	const next: Uint8Array[] = [];
	const deltas: Delta[] = [];

	for (const parent of level) {
		for (let i = 0; i < FANOUT; i++) {
			const child = createId();
			deltas.push(attach(parent, `c${i}`, child));
			next.push(child);
		}
	}

	record(index, { deltas });
	level = next;
	total += next.length;
	// The root's own first child, and everything under it: the branch moved below.
	if (d === 0) branch = next[0]!;
}

const leaves = level;
const branchSize = 1 + FANOUT + FANOUT ** 2 + FANOUT ** 3;

console.log(`\nauthority: ${total} observables, depth ${DEPTH}, fanout ${FANOUT}\n`);

const open: Policy = [{ effect: 'allow', path: [REST] }];

// Twenty patterns of the shapes a policy actually holds: literal prefixes, single wildcards,
// per-actor regions, subtree grants, and one deny.
const twenty: Policy = [
	{ effect: 'allow', path: ['c0', REST] },
	{ effect: 'allow', path: ['c1', ANY, 'c2', REST] },
	{ effect: 'allow', path: ['c2', SELF, REST] },
	{ effect: 'deny', path: ['c3', ANY, 'secret'] },
	...Array.from({ length: 16 }, (_, i): Policy[number] => (
		{ effect: 'allow', path: [`c${i % FANOUT}`, ANY, ANY, `c${i % 7}`] }
	)),
];

const actor = { id: 'bench' };
const commits: Commit[] = leaves.slice(0, 500).map((leaf) => ({ deltas: [write(leaf, 'title')] }));
const wide: Commit = { deltas: leaves.slice(0, 100).map((leaf) => write(leaf, 'body')) };

measure(`path of a leaf, walking up ${DEPTH}`, 200_000, (i) => {
	pathOf(index, leaves[i % leaves.length]!);
});

measure('one delta, one pattern', 200_000, (i) => {
	validate(commits[i % commits.length]!, { index, policy: open, actor });
});

measure('one delta, twenty patterns', 200_000, (i) => {
	validate(commits[i % commits.length]!, { index, policy: twenty, actor });
});

measure('a hundred deltas, twenty patterns', 20_000, () => {
	validate(wide, { index, policy: twenty, actor });
});

const off: Commit = { deltas: [{ type: 'remove', id: root, ref: { kind: 'object', key: 'c0' } }] };
const on: Commit = { deltas: [attach(root, 'c0', branch)] };

let detached = false;
measure(`moving a ${branchSize} entry branch, one commit each way`, 50_000, () => {
	record(index, detached ? on : off);
	detached = !detached;
});

if (detached) record(index, on);
console.log('');
