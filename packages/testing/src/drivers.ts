// The suite a `store` driver passes rather than claims.
//
// A driver is correct by passing this, not by inspection. Each check is a named function that
// throws on failure, so a consumer runs them in whatever test runner it already has and this
// package needs no runner of its own.
//
// The case this exists for is the last one. A concurrency test can pass while two of four
// writers silently lose every edit, if it runs two writers SEQUENTIALLY on the SAME field and
// asserts the loser was discarded. A suite that encodes
// the loss as the specification cannot catch it, so this one runs writers concurrently, on
// slots that do not overlap, and asserts every one of them survives.

import assert from 'node:assert/strict';

/** What a check needs: a driver nobody else is using, and a way to be rid of it. */
export type MakeDriver = () => Promise<StoreDriver> | StoreDriver;

/**
 * The part of a `store` driver this suite exercises.
 *
 * Stated structurally rather than imported, so `testing` does not depend on `store`: an
 * integrator may know everything, but a suite that forced a dependency edge would make the
 * package it checks unable to depend on it in turn.
 */
export interface StoreDriver {
	write(write: {
		doc: string; root: string; rootKind: string;
		rows: readonly { id: string; kind: string; edge?: { parent: string; slot: string } | null; set: Record<string, unknown>; unset: readonly string[] }[];
		dropped: readonly string[]; actor: string; body: Uint8Array;
	}): Promise<number>;
	create(doc: string, root: string, rootKind: string): Promise<boolean>;
	read(doc: string): Promise<{ root: string; rootKind: string; rows: unknown[] } | null>;
	since(doc: string, seq: number): Promise<{ seq: number; actor: string; body: Uint8Array }[]>;
	head(doc: string): Promise<number>;
	truncate(doc: string, seq: number): Promise<void>;
	remove(doc: string): Promise<void>;
	close(): Promise<void>;
}

/** One named obligation a driver has to meet. */
export interface DriverCheck {
	readonly name: string;
	run(make: MakeDriver): Promise<void>;
}

const ROOT = 'AAAAAAAAAAAAAAAA';
const row = (id: string, set: Record<string, unknown> = {}, parent: string | null = ROOT) => ({
	id, kind: 'object', set, unset: [] as string[],
	...(id === ROOT ? {} : { edge: parent === null ? null : { parent, slot: id } }),
});
const body = (n: number) => new Uint8Array([n & 0xff, (n >> 8) & 0xff]);
const write = (doc: string, rows: ReturnType<typeof row>[], n: number, actor = 'a') =>
	({ doc, root: ROOT, rootKind: 'object', rows, dropped: [], actor, body: body(n) });

/**
 * Every obligation a `store` driver has.
 *
 * Returns: the checks, each of which takes a factory for a driver nobody else is using and
 * throws on failure.
 *
 * Example:
 *   for (const check of driverChecks()) test(check.name, () => check.run(() => memoryDriver()));
 */
export const driverChecks = (): DriverCheck[] => [
	{
		name: 'a document that was never written reads as nothing',
		async run(make) {
			const d = await make();
			try {
				assert.equal(await d.read('absent'), null);
				assert.equal(await d.head('absent'), 0);
				assert.deepEqual(await d.since('absent', 0), []);
			} finally { await d.close(); }
		},
	},
	{
		name: 'sequences start at one and are contiguous within a document',
		async run(make) {
			const d = await make();
			try {
				assert.equal(await d.write(write('a', [row(ROOT)], 1)), 1);
				assert.equal(await d.write(write('a', [row('x')], 2)), 2);
				assert.equal(await d.write(write('a', [row('y')], 3)), 3);
				assert.equal(await d.head('a'), 3);
				// a second document counts on its own
				assert.equal(await d.write(write('b', [row(ROOT)], 1)), 1);
				assert.equal(await d.head('a'), 3);
			} finally { await d.close(); }
		},
	},
	{
		name: 'rows written last are the rows read back',
		async run(make) {
			const d = await make();
			try {
				await d.write(write('a', [row(ROOT), row('x', { v: 1 })], 1));
				await d.write(write('a', [row('x', { v: 2 })], 2));
				const held = await d.read('a');
				assert.ok(held !== null);
				assert.equal(held.root, ROOT);
				const x = (held.rows as { id: string; slots: Record<string, unknown> }[]).find((r) => r.id === 'x');
				assert.deepEqual(x?.slots, { v: 2 });
			} finally { await d.close(); }
		},
	},
	{
		name: 'a row nothing attaches is kept, with its slots',
		async run(make) {
			const d = await make();
			try {
				await d.write(write('a', [row(ROOT), row('x', { title: 'kept' })], 1));
				await d.write({ ...write('a', [row('x', {}, null)], 2), dropped: ['x'] });
				const held = await d.read('a');
				const x = (held!.rows as { id: string; parent: string | null; slots: Record<string, unknown> }[])
					.find((r) => r.id === 'x');
				assert.ok(x !== undefined, 'a detached row is kept, because detaching is not deleting');
				assert.equal(x.parent, null);
				assert.deepEqual(x.slots, { title: 'kept' });
			} finally { await d.close(); }
		},
	},
	{
		name: 'since returns what came after a sequence, oldest first, with its actor',
		async run(make) {
			const d = await make();
			try {
				for (let i = 1; i <= 5; i++) await d.write(write('a', [row(ROOT)], i, `u${i}`));
				const all = await d.since('a', 0);
				assert.deepEqual(all.map((e) => e.seq), [1, 2, 3, 4, 5]);
				assert.deepEqual(all.map((e) => e.actor), ['u1', 'u2', 'u3', 'u4', 'u5']);
				assert.deepEqual([...all[2]!.body], [...body(3)]);
				assert.deepEqual((await d.since('a', 3)).map((e) => e.seq), [4, 5]);
				assert.deepEqual(await d.since('a', 5), []);
			} finally { await d.close(); }
		},
	},
	{
		name: 'truncate drops history without touching the document',
		async run(make) {
			const d = await make();
			try {
				for (let i = 1; i <= 5; i++) await d.write(write('a', [row(ROOT), row('x', { v: i })], i));
				await d.truncate('a', 3);
				assert.deepEqual((await d.since('a', 0)).map((e) => e.seq), [4, 5]);
				assert.equal(await d.head('a'), 5, 'truncating history does not move the head');
				const x = (await d.read('a'))!.rows as { id: string; slots: Record<string, unknown> }[];
				assert.deepEqual(x.find((r) => r.id === 'x')?.slots, { v: 5 });
			} finally { await d.close(); }
		},
	},
	{
		name: 'remove forgets rows and history together',
		async run(make) {
			const d = await make();
			try {
				await d.write(write('a', [row(ROOT), row('x')], 1));
				await d.remove('a');
				assert.equal(await d.read('a'), null);
				assert.equal(await d.head('a'), 0);
				assert.deepEqual(await d.since('a', 0), []);
			} finally { await d.close(); }
		},
	},
	{
		name: 'the tail a driver returns is a copy, not its own storage',
		async run(make) {
			const d = await make();
			try {
				await d.write(write('a', [row(ROOT)], 7));
				const first = await d.since('a', 0);
				first[0]!.body[0] = 0xff;
				const second = await d.since('a', 0);
				assert.deepEqual([...second[0]!.body], [...body(7)], 'a caller must not be able to edit stored bytes');
			} finally { await d.close(); }
		},
	},
	{
		name: 'concurrent writers on slots that do not overlap all survive',
		async run(make) {
			const d = await make();
			try {
				await d.write(write('a', [row(ROOT)], 0));
				const WRITERS = 4, EACH = 20;

				// Each writer owns one slot OF THE SAME OBSERVABLE, which is the case a driver
				// that writes rows whole gets wrong: the writers never touch each other's slots,
				// so every one of them must survive.
				await Promise.all(Array.from({ length: WRITERS }, (_, w) => (async () => {
					for (let i = 1; i <= EACH; i++) {
						await d.write(write('a', [
							{ id: ROOT, kind: 'object', set: { [`w${w}`]: i }, unset: [] },
							row(`w${w}`, { n: i }),
						], i, `w${w}`));
					}
				})()));

				const held = await d.read('a');
				const rows = held!.rows as { id: string; slots: Record<string, unknown> }[];
				const root = rows.find((r) => r.id === ROOT);
				for (let w = 0; w < WRITERS; w++) {
					assert.equal(root?.slots[`w${w}`], EACH,
						`w${w} owns one slot of the root that no other writer touches, and its last write did not survive`);
					const mine = rows.find((r) => r.id === `w${w}`);
					assert.ok(mine !== undefined, `w${w} wrote ${EACH} times and has no row at all`);
					assert.deepEqual(mine.slots, { n: EACH }, `w${w}'s own row did not survive`);
				}

				// and every one of those writes is in the history exactly once
				assert.equal(await d.head('a'), WRITERS * EACH + 1);
				const seqs = (await d.since('a', 0)).map((e) => e.seq);
				assert.equal(new Set(seqs).size, seqs.length, 'two commits were given the same sequence');
			} finally { await d.close(); }
		},
	},
	{
		name: 'only one of many concurrent creates wins the name',
		async run(make) {
			const d = await make();
			try {
				const results = await Promise.all(
					Array.from({ length: 8 }, (_, i) => d.create('raced', `ROOT${i}`, 'object')));
				assert.equal(results.filter(Boolean).length, 1,
					'two callers both created the same document, so it has two roots');
				const held = await d.read('raced');
				assert.ok(held !== null);
				assert.ok(held.root.startsWith('ROOT'));
				assert.equal(await d.create('raced', 'ANOTHER', 'object'), false);
			} finally { await d.close(); }
		},
	},
	{
		name: 'a write that disagrees with the document root is refused',
		async run(make) {
			const d = await make();
			try {
				await d.create('a', ROOT, 'object');
				await d.write(write('a', [row(ROOT)], 1));
				await assert.rejects(() => d.write({ ...write('a', [row('x')], 2), root: 'DIFFERENTROOTAAAA' }));
			} finally { await d.close(); }
		},
	},
	{
		name: 'closing twice is not an error',
		async run(make) {
			const d = await make();
			await d.close();
			await d.close();
		},
	},
];
