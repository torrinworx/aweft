import test from 'node:test';
import assert from 'node:assert/strict';

import { atomic, createObject } from '@aweftjs/core';

import { createStore, memoryDriver } from '../src/index.ts';
import type { Declaration } from '../src/index.ts';

type Doc = Record<string, unknown>;

/** `find` hands back the projection it already read, and these assertions are about which. */
const names = (found: readonly { doc: string }[]): string[] => found.map((f) => f.doc);
const DECLARE: Declaration = {
	ownerId: ['ownerId'],
	status: ['status'],
	weight: ['weight'],
	author: ['meta', 'authorId'],
};

const seeded = async (n = 12) => {
	const store = createStore({ driver: memoryDriver(), declare: DECLARE });
	for (let i = 0; i < n; i++) {
		const h = await store.open(`d${String(i).padStart(2, '0')}`);
		const root = h.root as Doc;
		atomic(() => {
			root.ownerId = `u_${i % 3}`;
			root.status = i % 4 === 0 ? 'urgent' : 'open';
			root.weight = i;
			root.meta = createObject<Doc>({ authorId: `a_${i % 2}` });
		});
		await store.settled(h);
	}
	return store;
};

test('a declared path answers a query, and the projection follows the document', async () => {
	const store = await seeded();
	assert.deepEqual(names(await store.find({ where: [{ field: 'ownerId', op: 'eq', value: 'u_1' }] })),
		['d01', 'd04', 'd07', 'd10']);

	const h = await store.open('d01');
	(h.root as Doc).ownerId = 'u_9';
	await store.settled(h);

	assert.deepEqual(names(await store.find({ where: [{ field: 'ownerId', op: 'eq', value: 'u_1' }] })),
		['d04', 'd07', 'd10']);
	assert.deepEqual(names(await store.find({ where: [{ field: 'ownerId', op: 'eq', value: 'u_9' }] })), ['d01']);
});

test('a nested declared path is read through the observables it crosses', async () => {
	const store = await seeded();
	assert.deepEqual(names(await store.find({ where: [{ field: 'author', op: 'eq', value: 'a_1' }] })),
		['d01', 'd03', 'd05', 'd07', 'd09', 'd11']);

	const h = await store.open('d03');
	((h.root as Doc).meta as Doc).authorId = 'a_7';
	await store.settled(h);
	assert.deepEqual(names(await store.find({ where: [{ field: 'author', op: 'eq', value: 'a_7' }] })), ['d03']);
});

test('ranges, and a second condition narrowing what the index returned', async () => {
	const store = await seeded();
	assert.deepEqual(names(await store.find({ where: [{ field: 'weight', op: 'gte', value: 9 }] })),
		['d09', 'd10', 'd11']);
	assert.deepEqual(names(await store.find({ where: [{ field: 'weight', op: 'lt', value: 3 }] })),
		['d00', 'd01', 'd02']);
	assert.deepEqual(
		names(await store.find({
			where: [
				{ field: 'ownerId', op: 'eq', value: 'u_0' },
				{ field: 'status', op: 'eq', value: 'urgent' },
			],
		})),
		['d00'],
	);
});

test('sort and cursor pagination', async () => {
	const store = await seeded();
	const desc = names(await store.find({
		where: [{ field: 'ownerId', op: 'eq', value: 'u_2' }],
		sort: { field: 'weight', direction: 'desc' },
	}));
	assert.deepEqual(desc, ['d11', 'd08', 'd05', 'd02']);

	const first = await store.find({
		where: [{ field: 'weight', op: 'gte', value: 0 }],
		sort: { field: 'weight' }, limit: 5,
	});
	const next = names(await store.find({
		where: [{ field: 'weight', op: 'gte', value: 0 }],
		sort: { field: 'weight' }, limit: 5, after: first.at(-1)!.cursor,
	}));
	assert.deepEqual(names(first), ['d00', 'd01', 'd02', 'd03', 'd04']);
	assert.deepEqual(next, ['d05', 'd06', 'd07', 'd08', 'd09']);

	// A cursor belongs to the order it came from. Under another sort the position it names
	// means nothing, and a silent wrong page is the failure this guards against.
	await assert.rejects(
		() => store.find({
			where: [{ field: 'weight', op: 'gte', value: 0 }],
			sort: { field: 'ownerId' }, limit: 5, after: first.at(-1)!.cursor,
		}),
		(e: Error) => (e as { reason?: string }).reason === 'cursor',
	);
	await assert.rejects(
		() => store.find({ where: [{ field: 'weight', op: 'gte', value: 0 }], after: 'd04' }),
		(e: Error) => (e as { reason?: string }).reason === 'cursor',
		'a document name is not a cursor',
	);
});

test('an undeclared path is refused, not scanned', async () => {
	const store = await seeded();
	await assert.rejects(
		() => store.find({ where: [{ field: 'title', op: 'eq', value: 'x' }] }),
		(e: Error) => e.message.includes('not declared') && (e as { reason?: string }).reason === 'undeclared',
	);
	await assert.rejects(
		() => store.find({
			where: [{ field: 'ownerId', op: 'eq', value: 'u_1' }],
			sort: { field: 'nope' },
		}),
		/the sort names nope/,
	);
	await assert.rejects(() => store.find({ where: [] }), /at least one condition/);
});

test('scan is the escape, and it insists on a limit', async () => {
	const store = await seeded();
	const first = await store.scan(3);
	assert.deepEqual(names(first), ['d00', 'd01', 'd02']);
	assert.deepEqual(names(await store.scan(3, first.at(-1)!.cursor)), ['d03', 'd04', 'd05']);
	await assert.rejects(() => store.scan(0), /positive limit/);
	await assert.rejects(() => store.scan(-1), /positive limit/);
});

test('a wildcard cannot be declared, because it names many paths in one document', () => {
	assert.throws(
		() => createStore({ driver: memoryDriver(), declare: { s: ['tasks', { any: true } as never, 'status'] } }),
		/wildcard/,
	);
	assert.throws(() => createStore({ driver: memoryDriver(), declare: { s: [] } }), /empty path/);
});

test('a declared path that is missing, or crosses a primitive, reads as null', async () => {
	const store = createStore({ driver: memoryDriver(), declare: DECLARE });
	const h = await store.open('sparse');
	const root = h.root as Doc;
	atomic(() => { root.ownerId = 'u_x'; root.meta = 'not an object'; });
	await store.settled(h);

	assert.deepEqual(names(await store.find({ where: [{ field: 'author', op: 'eq', value: null }] })), ['sparse']);
	assert.deepEqual(names(await store.find({ where: [{ field: 'status', op: 'eq', value: null }] })), ['sparse']);
});

test('a slot holding another observable is indexed as the id it names', async () => {
	const store = createStore({ driver: memoryDriver(), declare: { meta: ['meta'] } });
	const h = await store.open('pointing');
	const meta = createObject<Doc>({ authorId: 'a_0' });
	(h.root as Doc).meta = meta;
	await store.settled(h);

	const { textIdOf } = await import('@aweftjs/core');
	assert.deepEqual(names(await store.find({ where: [{ field: 'meta', op: 'eq', value: textIdOf(meta) }] })),
		['pointing']);
});

test('a query survives a reopen, because the projection is stored beside the rows', async () => {
	const driver = memoryDriver();
	const first = createStore({ driver, declare: DECLARE });
	const h = await first.open('kept');
	atomic(() => { (h.root as Doc).ownerId = 'u_kept'; (h.root as Doc).weight = 42; });
	await first.settled(h);
	await first.close(h);

	const second = createStore({ driver, declare: DECLARE });
	assert.deepEqual(names(await second.find({ where: [{ field: 'ownerId', op: 'eq', value: 'u_kept' }] })), ['kept']);
	assert.deepEqual(names(await second.find({ where: [{ field: 'weight', op: 'gt', value: 40 }] })), ['kept']);
});
