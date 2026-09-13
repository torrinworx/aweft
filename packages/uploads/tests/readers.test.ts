// The readers over a memory store, and the store that has not declared the paths (design 262).

import test from 'node:test';
import assert from 'node:assert/strict';

import type { Files } from '../src/index.ts';
import { records, upload } from '../src/index.ts';
import { module, newStore, png, tempDir } from './helpers.ts';

test('upload answers one record by id or by document name, and undefined for none', async () => {
	const temp = await tempDir();
	const store = newStore();
	const files = await module<Files>('Files', store, {}, { storage: temp.adapter });
	try {
		const made = await files.instance.put(png(), { type: 'image/png', name: 'a.png', user: 'u1' });
		assert.deepEqual(await upload(store, made.id), made);
		assert.deepEqual(await upload(store, `upload:${made.id}`), made);
		assert.equal(await upload(store, 'nothere'), undefined);
		assert.equal(await store.head('upload:nothere'), 0, 'reading made no document');
	} finally {
		await files.stop();
		await temp.gone();
	}
});

test('records lists newest first, by user, by sha256, by type, since a time, under a limit', async () => {
	const temp = await tempDir();
	const store = newStore();
	const files = await module<Files>('Files', store, {}, { storage: temp.adapter });
	try {
		const a = await files.instance.put(png(10), { type: 'image/png', user: 'u1' });
		await new Promise((done) => setTimeout(done, 2));
		const b = await files.instance.put(png(11), { type: 'image/png', user: 'u2' });
		await new Promise((done) => setTimeout(done, 2));
		const c = await files.instance.put(png(10), { type: 'image/jpeg', user: 'u1' });
		const all = await records(store);
		assert.deepEqual(all.map((r) => r.id), [c.id, b.id, a.id]);
		assert.deepEqual((await records(store, { user: 'u1' })).map((r) => r.id), [c.id, a.id]);
		assert.deepEqual((await records(store, { sha256: a.sha256 })).map((r) => r.id), [c.id, a.id], 'the same bytes twice');
		assert.deepEqual((await records(store, { type: 'image/jpeg' })).map((r) => r.id), [c.id]);
		assert.deepEqual((await records(store, { since: b.at })).map((r) => r.id), [c.id, b.id]);
		assert.deepEqual((await records(store, { limit: 1 })).map((r) => r.id), [c.id]);
	} finally {
		await files.stop();
		await temp.gone();
	}
});

test('a store that has not declared the paths refuses the query', async () => {
	await assert.rejects(records(newStore({})));
});
