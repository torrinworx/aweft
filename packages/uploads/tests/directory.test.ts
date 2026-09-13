// The directory adapter: the adapter suite, and what the files on disk look like (design 262).

import test from 'node:test';
import assert from 'node:assert/strict';

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { adapterChecks } from '@aweftjs/testing';

import { directory } from '../src/index.ts';
import { bytesOf, reasonOf, streamOf, tempDir } from './helpers.ts';

for (const check of adapterChecks()) {
	test(`the directory adapter passes: ${check.name}`, async () => {
		const temp = await tempDir();
		try {
			await check.run(() => temp.adapter);
		} finally {
			await temp.gone();
		}
	});
}

test('a key is one file under the directory, named by the key, and the directory is made on the first put', async () => {
	const temp = await tempDir();
	try {
		const nested = directory(join(temp.dir, 'deeper', 'still'));
		const bytes = bytesOf(30);
		await nested.put('abc-XYZ_09', streamOf(bytes), { type: 'text/plain', size: 30 });
		assert.deepEqual(await readdir(join(temp.dir, 'deeper', 'still')), ['abc-XYZ_09']);
		assert.deepEqual(new Uint8Array(await readFile(join(temp.dir, 'deeper', 'still', 'abc-XYZ_09'))), bytes);
	} finally {
		await temp.gone();
	}
});

test('a put that fails leaves no partial file behind', async () => {
	const temp = await tempDir();
	try {
		const broken = new ReadableStream<Uint8Array>({
			start: (c) => { c.enqueue(bytesOf(10)); },
			pull: (c) => { c.error(new Error('cut')); },
		});
		await assert.rejects(temp.adapter.put('k1', broken, { type: 'text/plain', size: 20 }));
		assert.deepEqual(await readdir(temp.dir), []);
	} finally {
		await temp.gone();
	}
});

test('a file is not there under its name until every byte is written', async () => {
	const temp = await tempDir();
	try {
		let release: () => void = () => {};
		const gate = new Promise<void>((done) => { release = done; });
		const slow = new ReadableStream<Uint8Array>({
			start: (c) => { c.enqueue(bytesOf(10)); },
			pull: async (c) => { await gate; c.enqueue(bytesOf(10)); c.close(); },
		}, { highWaterMark: 0 });
		const putting = temp.adapter.put('k1', slow, { type: 'text/plain', size: 20 });
		await new Promise((done) => setTimeout(done, 20));
		assert.equal(await temp.adapter.open('k1'), undefined, 'nothing to open while the bytes are still arriving');
		assert.equal(await temp.adapter.head('k1'), undefined);
		assert.ok((await readdir(temp.dir)).every((name) => name !== 'k1'), 'no file under the key yet');
		release();
		await putting;
		assert.deepEqual(await temp.adapter.head('k1'), { size: 20 });
	} finally {
		await temp.gone();
	}
});

test('an empty path is refused at once', () => {
	assert.throws(() => directory(''), (error) => reasonOf(error) === 'invalid-config');
});
