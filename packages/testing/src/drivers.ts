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
		dropped: readonly string[]; body: Uint8Array;
		project?: Record<string, unknown>;
	}): Promise<number>;
	declare(fields: readonly string[]): Promise<void>;
	find(lookup: {
		where: { field: string; op: string; value: unknown };
		sort?: { field: string; direction: 'asc' | 'desc' };
		limit?: number; after?: string;
	}): Promise<{ doc: string; fields: Record<string, unknown>; cursor: string }[]>;
	scan(limit: number, after?: string): Promise<{ doc: string; fields: Record<string, unknown>; cursor: string }[]>;
	create(doc: string, root: string, rootKind: string): Promise<boolean>;
	read(doc: string): Promise<{ root: string; rootKind: string; rows: unknown[] } | null>;
	since(doc: string, seq: number): Promise<{ seq: number; body: Uint8Array }[]>;
	head(doc: string): Promise<number>;
	truncate(doc: string, seq: number): Promise<void>;
	forget(doc: string, ids: readonly string[]): Promise<void>;
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
const write = (doc: string, rows: ReturnType<typeof row>[], n: number) =>
	({ doc, root: ROOT, rootKind: 'object', rows, dropped: [], body: body(n) });

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
		name: 'since returns what came after a sequence, oldest first',
		async run(make) {
			const d = await make();
			try {
				for (let i = 1; i <= 5; i++) await d.write(write('a', [row(ROOT)], i));
				const all = await d.since('a', 0);
				assert.deepEqual(all.map((e) => e.seq), [1, 2, 3, 4, 5]);
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
						], i));
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
		name: 'a declared path answers a query through an index',
		async run(make) {
			const d = await make();
			try {
				await d.declare(['owner', 'weight']);
				for (let i = 0; i < 12; i++) {
					await d.create(`d${i}`, `${ROOT}${i}`, 'object');
					await d.write({
						...write(`d${i}`, [{ id: `${ROOT}${i}`, kind: 'object', set: {}, unset: [] }], 1),
						root: `${ROOT}${i}`,
						project: { owner: `u_${i % 3}`, weight: i },
					});
				}
				const mine = await d.find({ where: { field: 'owner', op: 'eq', value: 'u_1' } });
				assert.deepEqual(mine.map((f) => f.doc).sort(), ['d1', 'd10', 'd4', 'd7']);
				assert.equal(mine[0]!.fields.weight !== undefined,
					true, 'a hit carries its declared fields, so a caller can narrow without a second read');

				const heavy = await d.find({ where: { field: 'weight', op: 'gte', value: 10 } });
				assert.deepEqual(heavy.map((f) => f.doc).sort(), ['d10', 'd11']);
				assert.deepEqual((await d.find({ where: { field: 'weight', op: 'lt', value: 2 } })).map((f) => f.doc).sort(),
					['d0', 'd1']);
			} finally { await d.close(); }
		},
	},
	{
		name: 'a projection follows the document, and a removed document leaves the index',
		async run(make) {
			const d = await make();
			try {
				await d.declare(['owner']);
				await d.create('a', ROOT, 'object');
				await d.write({ ...write('a', [row(ROOT)], 1), project: { owner: 'first' } });
				assert.equal((await d.find({ where: { field: 'owner', op: 'eq', value: 'first' } })).length, 1);

				await d.write({ ...write('a', [row(ROOT)], 2), project: { owner: 'second' } });
				assert.equal((await d.find({ where: { field: 'owner', op: 'eq', value: 'first' } })).length, 0,
					'the old value still answers, so the projection was added to rather than moved');
				assert.equal((await d.find({ where: { field: 'owner', op: 'eq', value: 'second' } })).length, 1);

				await d.remove('a');
				assert.equal((await d.find({ where: { field: 'owner', op: 'eq', value: 'second' } })).length, 0,
					'a removed document still answers a query');
			} finally { await d.close(); }
		},
	},
	{
		name: 'sort and cursor pagination cover every document exactly once',
		async run(make) {
			const d = await make();
			try {
				await d.declare(['owner', 'weight']);
				for (let i = 0; i < 20; i++) {
					await d.create(`d${i}`, `${ROOT}${i}`, 'object');
					await d.write({
						...write(`d${i}`, [{ id: `${ROOT}${i}`, kind: 'object', set: {}, unset: [] }], 1),
						root: `${ROOT}${i}`, project: { owner: 'u', weight: i },
					});
				}
				const seen: string[] = [];
				let after: string | undefined;
				for (let page = 0; page < 10; page++) {
					const got = await d.find({
						where: { field: 'owner', op: 'eq', value: 'u' },
						sort: { field: 'weight', direction: 'asc' }, limit: 4,
						...(after === undefined ? {} : { after }),
					});
					if (got.length === 0) break;
					seen.push(...got.map((f) => f.doc));
					after = got.at(-1)!.cursor;
				}
				assert.equal(seen.length, 20, 'paging saw every document');
				assert.equal(new Set(seen).size, 20, 'and saw none of them twice');
				assert.deepEqual(seen.slice(0, 4), ['d0', 'd1', 'd2', 'd3'], 'in the order asked for');

				const desc = await d.find({
					where: { field: 'owner', op: 'eq', value: 'u' },
					sort: { field: 'weight', direction: 'desc' }, limit: 3,
				});
				assert.deepEqual(desc.map((f) => f.doc), ['d19', 'd18', 'd17']);
			} finally { await d.close(); }
		},
	},
	{
		name: 'a field nobody declared is refused rather than scanned',
		async run(make) {
			const d = await make();
			try {
				await d.declare(['owner']);
				await d.create('a', ROOT, 'object');
				await d.write({ ...write('a', [row(ROOT)], 1), project: { owner: 'u' } });
				await assert.rejects(() => d.find({ where: { field: 'title', op: 'eq', value: 'x' } }),
					'a driver must refuse an undeclared field, not fall back to reading everything');
			} finally { await d.close(); }
		},
	},
	{
		name: 'scan stops at its limit and pages without repeating',
		async run(make) {
			const d = await make();
			try {
				await d.declare([]);
				for (let i = 0; i < 10; i++) await d.create(`d${i}`, `${ROOT}${i}`, 'object');
				const first = await d.scan(4);
				assert.equal(first.length, 4);
				const second = await d.scan(4, first.at(-1)!.cursor);
				assert.equal(second.length, 4);
				assert.equal(new Set([...first, ...second].map((f) => f.doc)).size, 8);
			} finally { await d.close(); }
		},
	},
	{
		name: 'an unset slot is removed, not merely overwritten',
		async run(make) {
			const d = await make();
			try {
				await d.declare([]);
				await d.create('a', ROOT, 'object');
				await d.write(write('a', [row(ROOT, { secret: 'gone', keep: 1 })], 1));
				await d.write(write('a', [{ id: ROOT, kind: 'object', set: {}, unset: ['secret'] }], 2));

				const rows = (await d.read('a'))!.rows as { id: string; slots: Record<string, unknown> }[];
				const root = rows.find((r) => r.id === ROOT);
				assert.deepEqual(root?.slots, { keep: 1 },
					'a slot the document deleted is still stored, so a delete does not reach the disk');
			} finally { await d.close(); }
		},
	},
	{
		name: 'a declared field holding null still answers a query for null',
		async run(make) {
			const d = await make();
			try {
				await d.declare(['owner']);
				await d.create('a', ROOT, 'object');
				await d.write({ ...write('a', [row(ROOT)], 1), project: { owner: null } });
				const hits = await d.find({ where: { field: 'owner', op: 'eq', value: null } });
				assert.deepEqual(hits.map((f) => f.doc), ['a'],
					'a document whose declared path is empty must be findable, or it is invisible forever');
			} finally { await d.close(); }
		},
	},
	{
		name: 'the rows a driver returns are a copy, not its own storage',
		async run(make) {
			const d = await make();
			try {
				await d.declare([]);
				await d.create('a', ROOT, 'object');
				await d.write(write('a', [row(ROOT, { title: 'original' })], 1));

				const first = (await d.read('a'))!.rows as { id: string; slots: Record<string, unknown> }[];
				first.find((r) => r.id === ROOT)!.slots.title = 'edited through the returned object';

				const second = (await d.read('a'))!.rows as { id: string; slots: Record<string, unknown> }[];
				assert.equal(second.find((r) => r.id === ROOT)!.slots.title, 'original',
					'a caller must not be able to edit stored rows through what read handed back');
			} finally { await d.close(); }
		},
	},
	{
		name: 'forget frees a row, and dropped does not',
		async run(make) {
			const d = await make();
			try {
				await d.declare([]);
				await d.create('a', ROOT, 'object');
				await d.write(write('a', [row(ROOT), row('x', { title: 'kept' })], 1));

				// dropped says an observable lost its edge. Its row stays: detaching is not deleting.
				await d.write({ ...write('a', [row('x', {}, null)], 2), dropped: ['x'] });
				let rows = (await d.read('a'))!.rows as { id: string }[];
				assert.ok(rows.some((r) => r.id === 'x'), 'dropped must not delete the row');

				// forget is the sweep, and it is the only thing that frees one.
				await d.forget('a', ['x']);
				rows = (await d.read('a'))!.rows as { id: string }[];
				assert.ok(!rows.some((r) => r.id === 'x'), 'forget must actually free the row');
				assert.ok(rows.some((r) => r.id === ROOT), 'and must leave the rest alone');
			} finally { await d.close(); }
		},
	},
	{
		name: 'a cursor that has left the result set does not restart the paging',
		async run(make) {
			const d = await make();
			try {
				await d.declare(['owner', 'weight']);
				for (let i = 0; i < 6; i++) {
					await d.create(`d${i}`, `${ROOT}${i}`, 'object');
					await d.write({
						...write(`d${i}`, [{ id: `${ROOT}${i}`, kind: 'object', set: {}, unset: [] }], 1),
						root: `${ROOT}${i}`, project: { owner: 'u', weight: i },
					});
				}
				const first = await d.find({
					where: { field: 'owner', op: 'eq', value: 'u' },
					sort: { field: 'weight', direction: 'asc' }, limit: 2,
				});
				assert.deepEqual(first.map((f) => f.doc), ['d0', 'd1']);

				// d1 stops matching between the two pages, which is ordinary in a live collection
				await d.write({
					...write('d1', [{ id: `${ROOT}1`, kind: 'object', set: {}, unset: [] }], 2),
					root: `${ROOT}1`, project: { owner: 'someone else' },
				});
				const second = await d.find({
					where: { field: 'owner', op: 'eq', value: 'u' },
					sort: { field: 'weight', direction: 'asc' }, limit: 2, after: first.at(-1)!.cursor,
				});
				assert.deepEqual(second.map((f) => f.doc), ['d2', 'd3'],
					'a cursor whose document left the results must not send the paging back to the top');
			} finally { await d.close(); }
		},
	},
	{
		// The two shapes design 060 exists for. A cursor that looked its document up again
		// would restart from the top when the document is gone, and skip the rest of the
		// collection when the document's sort value moved past everything. Both silent.
		name: 'a cursor whose document was removed, or re-ranked, carries on from its position',
		async run(make) {
			const d = await make();
			try {
				await d.declare(['owner', 'weight']);
				for (let i = 0; i < 6; i++) {
					await d.create(`d${i}`, `${ROOT}${i}`, 'object');
					await d.write({
						...write(`d${i}`, [{ id: `${ROOT}${i}`, kind: 'object', set: {}, unset: [] }], 1),
						root: `${ROOT}${i}`, project: { owner: 'u', weight: i },
					});
				}
				const page = () => d.find({
					where: { field: 'owner', op: 'eq', value: 'u' },
					sort: { field: 'weight', direction: 'asc' }, limit: 2,
				});
				const first = await page();
				assert.deepEqual(first.map((f) => f.doc), ['d0', 'd1']);
				const cursor = first.at(-1)!.cursor;

				// Re-rank d1 past everything, then page after the cursor minted before the move.
				await d.write({
					...write('d1', [{ id: `${ROOT}1`, kind: 'object', set: {}, unset: [] }], 2),
					root: `${ROOT}1`, project: { owner: 'u', weight: 100 },
				});
				const afterMove = await d.find({
					where: { field: 'owner', op: 'eq', value: 'u' },
					sort: { field: 'weight', direction: 'asc' }, limit: 2, after: cursor,
				});
				assert.deepEqual(afterMove.map((f) => f.doc), ['d2', 'd3'],
					'a re-ranked cursor document must not skip the rest of the collection');

				// Remove d1 outright, then page after the same cursor.
				await d.remove('d1');
				const afterRemove = await d.find({
					where: { field: 'owner', op: 'eq', value: 'u' },
					sort: { field: 'weight', direction: 'asc' }, limit: 2, after: cursor,
				});
				assert.deepEqual(afterRemove.map((f) => f.doc), ['d2', 'd3'],
					'a removed cursor document must not restart the paging from the top');
			} finally { await d.close(); }
		},
	},
	{
		name: 'a cursor is refused under a sort other than the one it was minted for',
		async run(make) {
			const d = await make();
			try {
				await d.declare(['owner', 'weight']);
				for (let i = 0; i < 3; i++) {
					await d.create(`d${i}`, `${ROOT}${i}`, 'object');
					await d.write({
						...write(`d${i}`, [{ id: `${ROOT}${i}`, kind: 'object', set: {}, unset: [] }], 1),
						root: `${ROOT}${i}`, project: { owner: 'u', weight: i },
					});
				}
				const first = await d.find({
					where: { field: 'owner', op: 'eq', value: 'u' },
					sort: { field: 'weight', direction: 'asc' }, limit: 1,
				});
				await assert.rejects(
					() => d.find({
						where: { field: 'owner', op: 'eq', value: 'u' },
						sort: { field: 'owner', direction: 'asc' }, limit: 1, after: first[0]!.cursor,
					}),
					(e: Error) => (e as { reason?: string }).reason === 'cursor',
					'a cursor from another sort names a position that means nothing here',
				);
				await assert.rejects(
					() => d.find({ where: { field: 'owner', op: 'eq', value: 'u' }, after: 'd0' }),
					(e: Error) => (e as { reason?: string }).reason === 'cursor',
					'a document name is not a cursor',
				);
			} finally { await d.close(); }
		},
	},
	{
		name: 'scan pages by cursor and covers every document exactly once',
		async run(make) {
			const d = await make();
			try {
				for (let i = 0; i < 7; i++) {
					await d.create(`d${i}`, `${ROOT}${i}`, 'object');
					await d.write({
						...write(`d${i}`, [{ id: `${ROOT}${i}`, kind: 'object', set: {}, unset: [] }], 1),
						root: `${ROOT}${i}`,
					});
				}
				const seen: string[] = [];
				let after: string | undefined;
				for (let page = 0; page < 10; page++) {
					const got = await d.scan(3, after);
					if (got.length === 0) break;
					seen.push(...got.map((f) => f.doc));
					after = got.at(-1)!.cursor;
				}
				assert.equal(seen.length, 7, 'scan saw every document');
				assert.equal(new Set(seen).size, 7, 'and saw none of them twice');
			} finally { await d.close(); }
		},
	},
	{
		// The one that mattered most: a driver reading an absent `edge` as "no edge" reports
		// every row as an orphan, so a sweep frees the live document and the next open throws
		// on a snapshot that names what it does not contain.
		name: 'a patch with no edge leaves the edge that was stored',
		async run(make) {
			const d = await make();
			try {
				await d.write(write('a', [row(ROOT), row('x', { v: 1 })], 1));
				// A second write about the same row that says nothing about where it is attached.
				await d.write({
					doc: 'a', root: ROOT, rootKind: 'object', body: body(2), dropped: [],
					rows: [{ id: 'x', kind: 'object', set: { v: 2 }, unset: [] }],
				});

				const held = await d.read('a');
				assert.ok(held !== null);
				const x = (held.rows as {
					id: string; parent: string | null; slot: string | null; slots: Record<string, unknown>;
				}[]).find((r) => r.id === 'x');
				assert.deepEqual(x?.slots, { v: 2 }, 'the slot it did name was written');
				assert.deepEqual(
					{ parent: x?.parent, slot: x?.slot }, { parent: ROOT, slot: 'x' },
					'and an absent edge means unchanged, never detached',
				);
			} finally { await d.close(); }
		},
	},
	{
		// A driver that answers 'object' for everything makes every array and map document
		// unopenable, with a `kind-conflict` from the applier and nothing naming the driver.
		name: 'the kind of a row is the kind that comes back',
		async run(make) {
			const d = await make();
			try {
				await d.write({
					doc: 'a', root: ROOT, rootKind: 'array', body: body(1), dropped: [],
					rows: [
						{ id: ROOT, kind: 'array', set: {}, unset: [] },
						{ id: 'm', kind: 'map', set: {}, unset: [], edge: { parent: ROOT, slot: 'm' } },
						{ id: 'o', kind: 'object', set: {}, unset: [], edge: { parent: ROOT, slot: 'o' } },
					],
				});

				const held = await d.read('a');
				assert.ok(held !== null);
				assert.equal(held.rootKind, 'array');
				const kinds = Object.fromEntries(
					(held.rows as { id: string; kind: string }[]).map((r) => [r.id, r.kind]),
				);
				assert.deepEqual(kinds, { [ROOT]: 'array', m: 'map', o: 'object' });
			} finally { await d.close(); }
		},
	},
	{
		name: 'the rows a query answers with are a copy, not the driver\'s own storage',
		async run(make) {
			const d = await make();
			try {
				await d.declare(['weight']);
				await d.write({ ...write('a', [row(ROOT)], 1), project: { weight: 1 } });

				for (const found of await d.find({ where: { field: 'weight', op: 'eq', value: 1 } })) {
					(found.fields as Record<string, unknown>).weight = 'stomped';
				}
				for (const found of await d.scan(10)) {
					(found.fields as Record<string, unknown>).weight = 'stomped';
				}

				const again = await d.find({ where: { field: 'weight', op: 'eq', value: 1 } });
				assert.deepEqual(again.map((f) => f.fields.weight), [1],
					'a caller holding a result must not be able to edit the index');
			} finally { await d.close(); }
		},
	},
	{
		name: 'a create that loses leaves the winner\'s document exactly as it was',
		async run(make) {
			const d = await make();
			try {
				assert.equal(await d.create('a', ROOT, 'object'), true);
				await d.write(write('a', [row(ROOT, { title: 'the winner wrote this' })], 1));

				assert.equal(await d.create('a', 'BBBBBBBBBBBBBBBB', 'object'), false,
					'the second create loses');

				const held = await d.read('a');
				assert.ok(held !== null);
				assert.equal(held.root, ROOT, 'and does not re-root the document');
				assert.equal(await d.head('a'), 1, 'and does not throw its history away');
				const rootRow = (held.rows as { id: string; slots: Record<string, unknown> }[])
					.find((r) => r.id === ROOT);
				assert.deepEqual(rootRow?.slots, { title: 'the winner wrote this' });
			} finally { await d.close(); }
		},
	},
	{
		name: 'a removed document is gone from scan as well as from read',
		async run(make) {
			const d = await make();
			try {
				await d.declare(['weight']);
				await d.write({ ...write('a', [row(ROOT)], 1), project: { weight: 1 } });
				await d.write({ ...write('b', [row(ROOT)], 1), project: { weight: 2 } });

				await d.remove('a');

				assert.deepEqual((await d.scan(10)).map((f) => f.doc), ['b'],
					'scan must not list a document that read no longer holds');
				assert.deepEqual(
					(await d.find({ where: { field: 'weight', op: 'eq', value: 1 } })).map((f) => f.doc), [],
				);
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
