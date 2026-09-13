// uploads/Files: put, get, open, remove, receive with each rule, and the configuration
// refused at load (design 262).

import test from 'node:test';
import assert from 'node:assert/strict';

import { readdir } from 'node:fs/promises';

import { atomic, createObject } from '@aweftjs/core';

import type { Files, Refused } from '../src/index.ts';
import { bytesOf, collect, jpeg, module, newStore, png, reasonOf, sha256, streamOf, tempDir } from './helpers.ts';

const files = async (config: Record<string, unknown> = {}, store = newStore()): Promise<{ instance: Files; stop(): Promise<void>; gone(): Promise<void>; store: typeof store; dir: string }> => {
	const temp = await tempDir();
	const loaded = await module<Files>('Files', store, {}, { storage: temp.adapter, ...config });
	return { instance: loaded.instance, stop: loaded.stop, gone: temp.gone, store, dir: temp.dir };
};

const refused = (error: unknown): Refused => error as Refused;

test('put keeps the bytes and answers a record with their size and hash', async () => {
	const { instance, stop, gone } = await files();
	try {
		const bytes = png(300);
		const record = await instance.put(bytes, { type: 'image/png', name: 'cat.png', user: 'u1', meta: { album: 'a', nested: { no: 1 }, n: 2 } });
		assert.equal(record.type, 'image/png');
		assert.equal(record.name, 'cat.png');
		assert.equal(record.user, 'u1');
		assert.equal(record.size, 300);
		assert.equal(record.sha256, sha256(bytes));
		assert.equal(record.url, `/files/${record.id}`);
		assert.deepEqual(record.storage, { adapter: 'directory', key: record.id });
		assert.deepEqual(record.meta, { album: 'a', n: 2 });
		assert.ok(record.at > 0);
		assert.deepEqual(await instance.get(record.id), record);
		const opened = await instance.open(record.id);
		assert.deepEqual(await collect(opened!.stream), bytes);
		assert.deepEqual(await instance.adapter.head(record.id), { size: 300 });
	} finally {
		await stop();
		await gone();
	}
});

test('put takes a stream with its size, and refuses one without', async () => {
	const { instance, stop, gone } = await files();
	try {
		const bytes = bytesOf(5000);
		const record = await instance.put(streamOf(bytes, 700), { type: 'application/octet-stream', size: 5000 });
		assert.equal(record.size, 5000);
		assert.equal(record.sha256, sha256(bytes));
		assert.equal(record.name, null);
		assert.equal(record.user, null);
		assert.equal(record.meta, null);
		await assert.rejects(instance.put(streamOf(bytes), { type: 'text/plain' }), (error) => reasonOf(error) === 'invalid-put');
		await assert.rejects(instance.put(bytes, { type: 'nonsense' }), (error) => reasonOf(error) === 'invalid-put');
	} finally {
		await stop();
		await gone();
	}
});

test('put runs no rule: a type outside types and a body over the cap are both kept', async () => {
	const { instance, stop, gone } = await files({ maxBytes: 10 });
	try {
		const record = await instance.put(bytesOf(100), { type: 'text/csv', name: 'export.csv' });
		assert.equal(record.size, 100);
		assert.equal(record.type, 'text/csv');
	} finally {
		await stop();
		await gone();
	}
});

test('a put whose stream fails leaves no bytes and no record', async () => {
	const { instance, stop, gone, store } = await files();
	try {
		const broken = new ReadableStream<Uint8Array>({
			start: (c) => { c.enqueue(bytesOf(10)); },
			pull: (c) => { c.error(new Error('cut')); },
		});
		await assert.rejects(instance.put(broken, { type: 'text/plain', size: 20 }));
		assert.deepEqual(await store.find({ where: [{ field: 'kind', op: 'eq', value: 'upload' }] }), []);
	} finally {
		await stop();
		await gone();
	}
});

test('get of an id with no record is undefined and makes no document', async () => {
	const { instance, stop, gone, store } = await files();
	try {
		assert.equal(await instance.get('nothere'), undefined);
		assert.equal(await instance.open('nothere'), undefined);
		assert.equal(await store.head('upload:nothere'), 0);
	} finally {
		await stop();
		await gone();
	}
});

test('remove takes the bytes first and the record second, and answers whether there was one', async () => {
	const { instance, stop, gone, store } = await files();
	try {
		const record = await instance.put(png(), { type: 'image/png' });
		assert.equal(await instance.remove(record.id), true);
		assert.equal(await instance.adapter.head(record.id), undefined);
		assert.equal(await instance.get(record.id), undefined);
		assert.equal(await store.head(`upload:${record.id}`), 0);
		assert.equal(await instance.remove(record.id), false);
	} finally {
		await stop();
		await gone();
	}
});

test('remove of a record whose bytes are already gone still removes the record', async () => {
	const { instance, stop, gone } = await files();
	try {
		const record = await instance.put(png(), { type: 'image/png' });
		await instance.adapter.remove(record.id);
		assert.equal(await instance.open(record.id), undefined, 'the record is there and the bytes are not');
		assert.equal(await instance.remove(record.id), true);
		assert.equal(await instance.get(record.id), undefined);
	} finally {
		await stop();
		await gone();
	}
});

test('a record written by hand under an old key is found and served from that key', async () => {
	const { instance, stop, gone, store } = await files();
	try {
		const bytes = png(40);
		await instance.adapter.put('0B6D4F80411A65562D31926A7EC177CC', streamOf(bytes), { type: 'image/png', size: 40 });
		const handle = await store.open('upload:0B6D4F80411A65562D31926A7EC177CC');
		atomic(() => {
			Object.assign(handle.root, { kind: 'upload', user: null, name: 'old.png', type: 'image/png', size: 40, sha256: sha256(bytes), at: 1, meta: null });
			(handle.root as { storage: unknown }).storage = createObject({ adapter: 'directory', key: '0B6D4F80411A65562D31926A7EC177CC' });
		});
		await store.settled(handle);
		await store.close(handle);
		const opened = await instance.open('0B6D4F80411A65562D31926A7EC177CC');
		assert.equal(opened?.record.name, 'old.png');
		assert.deepEqual(await collect(opened!.stream), bytes);
	} finally {
		await stop();
		await gone();
	}
});

test('receive: a type outside types is refused, nothing stored, and the body is read off and discarded', async () => {
	const { instance, stop, gone, dir } = await files();
	try {
		let pulled = 0;
		const stream = new ReadableStream<Uint8Array>({ pull: (c) => { pulled += 1; if (pulled > 4) c.close(); else c.enqueue(new Uint8Array(10)); } }, { highWaterMark: 0 });
		await assert.rejects(instance.receive(stream, { type: 'text/html', name: null, size: 40 }, {}), (error) => {
			assert.equal(reasonOf(error), 'unsupported-type');
			assert.equal(refused(error).reasons[0]!.code, 'unsupported-type');
			return true;
		});
		assert.equal(pulled, 5, 'the body was read to its end so the sender hears the answer');
		assert.deepEqual(await readdir(dir), [], 'and none of it was stored');
	} finally {
		await stop();
		await gone();
	}
});

test('receive: a declared length over the cap is refused, and the drain stops at twice the cap', async () => {
	const { instance, stop, gone, dir } = await files({ maxBytes: 100 });
	try {
		let sent = 0;
		let cancelled = false;
		const endless = new ReadableStream<Uint8Array>({
			pull: (c) => { sent += 65536; c.enqueue(new Uint8Array(65536)); },
			cancel: () => { cancelled = true; },
		}, { highWaterMark: 0 });
		await assert.rejects(instance.receive(endless, { type: 'image/png', name: null, size: 101 }, {}), (error) => reasonOf(error) === 'too-large');
		assert.ok(sent >= 1_048_576 && sent < 1_048_576 + 3 * 65536, `the drain read about a mebibyte and no more: ${String(sent)}`);
		assert.equal(cancelled, true, 'then the body was cut');
		assert.deepEqual(await readdir(dir), []);
	} finally {
		await stop();
		await gone();
	}
});

test('receive: bytes that are not the declared type are refused and nothing is written', async () => {
	const { instance, stop, gone, store } = await files();
	try {
		const bytes = jpeg(50);
		await assert.rejects(instance.receive(streamOf(bytes), { type: 'image/png', name: null, size: 50 }, {}), (error) => reasonOf(error) === 'unsupported-type');
		assert.deepEqual(await store.find({ where: [{ field: 'kind', op: 'eq', value: 'upload' }] }), []);
		// The bytes are a jpeg, so declared as one they pass.
		const record = await instance.receive(streamOf(bytes), { type: 'image/jpeg', name: 'a.jpg', size: 50 }, {});
		assert.equal(record.type, 'image/jpeg');
	} finally {
		await stop();
		await gone();
	}
});

test('receive: a body that runs over the cap is cut, and neither bytes nor record remain', async () => {
	const { instance, stop, gone, store, dir } = await files({ maxBytes: 100 });
	try {
		const bytes = png(150);
		await assert.rejects(instance.receive(streamOf(bytes, 20), { type: 'image/png', name: null, size: 90 }, {}), (error) => reasonOf(error) === 'too-large');
		assert.deepEqual(await store.find({ where: [{ field: 'kind', op: 'eq', value: 'upload' }] }), []);
		assert.deepEqual(await readdir(dir), [], 'no file and no partial file is left');
	} finally {
		await stop();
		await gone();
	}
});

test('receive: a body shorter than its declared length is refused and removed', async () => {
	const { instance, stop, gone, store } = await files();
	try {
		const bytes = png(50);
		await assert.rejects(instance.receive(streamOf(bytes), { type: 'image/png', name: null, size: 80 }, {}), (error) => {
			assert.equal(reasonOf(error), 'wrong-length');
			assert.match(refused(error).reasons[0]!.message, /50 bytes arrived, 80 were declared/);
			return true;
		});
		assert.deepEqual(await store.find({ where: [{ field: 'kind', op: 'eq', value: 'upload' }] }), []);
	} finally {
		await stop();
		await gone();
	}
});

test('receive: the record carries the user from the context and the hash of what arrived', async () => {
	const { instance, stop, gone } = await files();
	try {
		const bytes = png(70);
		const record = await instance.receive(streamOf(bytes, 7), { type: 'image/png', name: 'face.png', size: 70 }, { user: 'u9' });
		assert.equal(record.user, 'u9');
		assert.equal(record.name, 'face.png');
		assert.equal(record.sha256, sha256(bytes));
		assert.equal(record.size, 70);
		assert.deepEqual(await collect((await instance.open(record.id))!.stream), bytes);
	} finally {
		await stop();
		await gone();
	}
});

test('receive: accept sees the upload, can read the bytes back, and its refusal removes them', async () => {
	const seen: unknown[] = [];
	const { instance, stop, gone, store, dir } = await files({
		accept: async (upload: { name: string | null; size: number; sha256: string; user: string | null; bytes(): Promise<Uint8Array> }, context: unknown) => {
			seen.push({ name: upload.name, size: upload.size, user: upload.user, context, bytes: await upload.bytes() });
			return upload.name === 'no.png' ? { reasons: [{ code: 'nsfw', message: 'not here' }] } : undefined;
		},
	});
	try {
		const ok = png(30);
		const record = await instance.receive(streamOf(ok), { type: 'image/png', name: 'yes.png', size: 30 }, { user: 'u1' });
		assert.deepEqual(seen[0], { name: 'yes.png', size: 30, user: 'u1', context: { user: 'u1' }, bytes: ok });
		assert.equal((await instance.get(record.id))?.name, 'yes.png');

		await assert.rejects(instance.receive(streamOf(png(31)), { type: 'image/png', name: 'no.png', size: 31 }, {}), (error) => {
			assert.equal(reasonOf(error), 'refused');
			assert.deepEqual(refused(error).reasons, [{ code: 'nsfw', message: 'not here' }]);
			return true;
		});
		const kept = await store.find({ where: [{ field: 'kind', op: 'eq', value: 'upload' }] });
		assert.equal(kept.length, 1);
		assert.equal((await readdir(dir)).length, 1, 'the refused bytes are gone from storage');
	} finally {
		await stop();
		await gone();
	}
});

test('remove takes the bytes before the record: when the bytes cannot be removed, the record stays', async () => {
	const temp = await tempDir();
	const stubborn = { ...temp.adapter, remove: async () => { throw new Error('bucket down'); } };
	const store = newStore();
	const loaded = await module<Files>('Files', store, {}, { storage: stubborn });
	try {
		const record = await loaded.instance.put(png(), { type: 'image/png' });
		await assert.rejects(loaded.instance.remove(record.id), /bucket down/);
		assert.notEqual(await loaded.instance.get(record.id), undefined, 'the record is still there to try again');
	} finally {
		await loaded.stop();
		await temp.gone();
	}
});

test('receive: accept that throws is the module\'s own throw, and the bytes are gone', async () => {
	const { instance, stop, gone, store, dir } = await files({ accept: () => { throw new Error('moderation is down'); } });
	try {
		await assert.rejects(instance.receive(streamOf(png(20)), { type: 'image/png', name: null, size: 20 }, {}), /moderation is down/);
		assert.deepEqual(await store.find({ where: [{ field: 'kind', op: 'eq', value: 'upload' }] }), []);
		assert.deepEqual(await readdir(dir), [], 'the bytes are gone from storage');
	} finally {
		await stop();
		await gone();
	}
});

test('receive: a type the sniff does not know is kept as declared', async () => {
	const { instance, stop, gone } = await files({ types: ['text/csv'] });
	try {
		const record = await instance.receive(streamOf(new TextEncoder().encode('<!doctype html>a,b')), { type: 'text/csv', name: 'a.csv', size: 18 }, {});
		assert.equal(record.type, 'text/csv');
	} finally {
		await stop();
		await gone();
	}
});

test('receive: the drain reads up to twice the cap, then cuts', async () => {
	const { instance, stop, gone } = await files({ maxBytes: 1_048_576 });
	try {
		let sent = 0;
		let cancelled = false;
		const endless = new ReadableStream<Uint8Array>({
			pull: (c) => { sent += 65536; c.enqueue(new Uint8Array(65536)); },
			cancel: () => { cancelled = true; },
		}, { highWaterMark: 0 });
		await assert.rejects(instance.receive(endless, { type: 'image/png', name: null, size: 1_048_577 }, {}), (error) => reasonOf(error) === 'too-large');
		assert.ok(sent >= 2 * 1_048_576 && sent < 2 * 1_048_576 + 3 * 65536, `about two mebibytes were read: ${String(sent)}`);
		assert.equal(cancelled, true);
	} finally {
		await stop();
		await gone();
	}
});

test('a name is cut at 255 code points, never through a pair, and the record is written', async () => {
	const { instance, stop, gone } = await files();
	try {
		const name = 'a'.repeat(254) + '\u{1F431}' + 'b'.repeat(10);
		const record = await instance.receive(streamOf(png(20)), { type: 'image/png', name, size: 20 }, {});
		assert.equal([...record.name!].length, 255);
		assert.equal(record.name!.at(-2)! + record.name!.at(-1)!, '\u{1F431}', 'the pair at the cut is whole');
		const made = await instance.put(png(21), { type: 'image/png', name });
		assert.equal([...made.name!].length, 255);
	} finally {
		await stop();
		await gone();
	}
});

test('a store that refuses the record takes the bytes with it, so nothing is orphaned', async () => {
	const temp = await tempDir();
	const store = newStore();
	const refusing = { ...store, settled: async () => { throw new Error('the store is down'); } };
	const loaded = await module<Files>('Files', refusing as never, {}, { storage: temp.adapter });
	try {
		await assert.rejects(loaded.instance.receive(streamOf(png(20)), { type: 'image/png', name: null, size: 20 }, {}), /the store is down/);
		await assert.rejects(loaded.instance.put(png(21), { type: 'image/png' }), /the store is down/);
		assert.deepEqual(await readdir(temp.dir), [], 'no bytes without a record');
	} finally {
		await loaded.stop();
		await temp.gone();
	}
});

test('receive: an adapter that fails is thrown as itself, never as too-large; a sender that stops is incomplete', async () => {
	const temp = await tempDir();
	const failing = { ...temp.adapter, put: async (key: string, stream: ReadableStream<Uint8Array>, options: { type: string; size: number }) => { await temp.adapter.put(key, stream, options); throw Object.assign(new Error('no space left'), { code: 'ENOSPC' }); } };
	const loaded = await module<Files>('Files', newStore(), {}, { storage: failing });
	try {
		await assert.rejects(loaded.instance.receive(streamOf(png(20)), { type: 'image/png', name: null, size: 20 }, {}), (error) => {
			assert.equal((error as Error).message, 'no space left');
			assert.equal(reasonOf(error), 'undefined');
			return true;
		});
		assert.deepEqual(await readdir(temp.dir), [], 'the partial object is removed');
	} finally {
		await loaded.stop();
	}
	const { instance, stop, gone, dir } = await files();
	try {
		const cut = new ReadableStream<Uint8Array>({
			start: (c) => { c.enqueue(png(10)); },
			pull: (c) => { c.error(new Error('socket reset')); },
		}, { highWaterMark: 0 });
		await assert.rejects(instance.receive(cut, { type: 'image/png', name: null, size: 40 }, {}), (error) => reasonOf(error) === 'incomplete');
		assert.deepEqual(await readdir(dir), []);
	} finally {
		await stop();
		await gone();
		await temp.gone();
	}
});

test('put refuses a type a header would refuse', async () => {
	const { instance, stop, gone } = await files();
	try {
		for (const type of ['image/png\r\nX-Injected: yes', 'image/png; charset=x', 'image', 'image/', '/png', 'image/png png']) {
			await assert.rejects(instance.put(png(), { type }), (error) => reasonOf(error) === 'invalid-put', type);
		}
	} finally {
		await stop();
		await gone();
	}
});

test('a record whose key is outside the rule names no bytes: open is undefined and remove still takes the record', async () => {
	const { instance, stop, gone, store } = await files();
	try {
		const handle = await store.open('upload:byhand');
		atomic(() => {
			Object.assign(handle.root, { kind: 'upload', user: null, name: null, type: 'image/png', size: 1, sha256: 'x', at: 1, meta: null });
			(handle.root as { storage: unknown }).storage = createObject({ adapter: 'directory', key: '../../etc/passwd' });
		});
		await store.settled(handle);
		await store.close(handle);
		assert.notEqual(await instance.get('byhand'), undefined);
		await assert.rejects(instance.open('byhand'), (error) => reasonOf(error) === 'invalid-key');
		assert.equal(await instance.remove('byhand'), true);
		assert.equal(await instance.get('byhand'), undefined);
	} finally {
		await stop();
		await gone();
	}
});

test('maxBytes by family: each family its own cap, default for the rest', async () => {
	const { instance, stop, gone } = await files({ types: ['image/png', 'audio/mpeg', 'application/pdf'], maxBytes: { image: 100, audio: 500, default: 50 } });
	try {
		assert.equal(instance.capFor('image/png'), 100);
		assert.equal(instance.capFor('audio/mpeg'), 500);
		assert.equal(instance.capFor('application/pdf'), 50);
	} finally {
		await stop();
		await gone();
	}
});

test('the configuration is refused at load for each wrong value', async () => {
	const temp = await tempDir();
	try {
		const bad: [string, Record<string, unknown>][] = [
			['storage', { storage: { put: 1 } }],
			['types', { types: [] }],
			['types', { types: 'image/png' }],
			['types', { types: ['png'] }],
			['maxBytes', { maxBytes: 0 }],
			['maxBytes', { maxBytes: { image: -1 } }],
			['maxBytes', { types: ['image/png', 'audio/mpeg'], maxBytes: { image: 10 } }],
			['accept', { accept: 'yes' }],
		];
		for (const [what, config] of bad) {
			await assert.rejects(module<Files>('Files', newStore(), {}, { storage: temp.adapter, ...config }), (error) => reasonOf(error) === 'invalid-config', what);
		}
		await assert.rejects(module<Files>('Files', undefined as never, {}, { storage: temp.adapter }), (error) => reasonOf(error) === 'no-store');
	} finally {
		await temp.gone();
	}
});

test('no storage configured means a directory named uploads under the working directory', async () => {
	const loaded = await module<Files>('Files', newStore(), {}, {});
	try {
		assert.equal(loaded.instance.adapter.name, 'directory');
		assert.deepEqual(loaded.instance.types, ['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
		assert.equal(loaded.instance.capFor('image/png'), 10 * 1024 * 1024);
	} finally {
		await loaded.stop();
	}
});
