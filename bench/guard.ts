// What a guard costs per commit as the document grows.
//
// `check` resolves every delta to its path by reading the document, so the question is
// whether that read scales with the commit or with the document. Run: node bench/guard.ts

import { createArray, createObject, idOf, snapshot } from '@aweftjs/core';
import { type StandardSchema, check, list, shape } from '@aweftjs/schema';
import type { Commit } from '@aweftjs/schema';

const leaf = (ok: (value: unknown) => boolean, message: string): StandardSchema => ({
	'~standard': {
		version: 1,
		vendor: 'bench',
		validate: (value) => (ok(value) ? { value } : { issues: [{ message }] }),
	},
});
const text = leaf((v) => typeof v === 'string', 'expected text');
const flag = leaf((v) => typeof v === 'boolean', 'expected a flag');

const Board = shape({ tasks: list(shape({ title: text, done: flag })) });

const build = (n: number): { board: object; commit: Commit } => {
	const tasks = createArray<object>();
	const board = createObject<{ tasks: object }>({ tasks });
	let first: object | undefined;
	for (let i = 0; i < n; i++) {
		const task = createObject({ title: `task ${i}`, done: false });
		tasks.push(task);
		first ??= task;
	}
	const commit: Commit = {
		deltas: [{ type: 'replace', id: idOf(first!), ref: { kind: 'object', key: 'title' }, value: 'renamed' }],
	};
	return { board, commit };
};

const time = (rounds: number, fn: () => void): number => {
	fn();
	const start = performance.now();
	for (let i = 0; i < rounds; i++) fn();
	return ((performance.now() - start) / rounds) * 1000;
};

console.log('one replace delta checked against a board of n tasks (n+2 observables)');
console.log('n\tcheck us\tsnapshot us');
for (const n of [100, 1_000, 10_000, 30_000]) {
	const { board, commit } = build(n);
	const rounds = n >= 10_000 ? 20 : 200;
	const checkUs = time(rounds, () => { check(Board, board, commit); });
	const snapUs = time(rounds, () => { snapshot(board); });
	console.log(`${n}\t${checkUs.toFixed(1)}\t${snapUs.toFixed(1)}`);
}
