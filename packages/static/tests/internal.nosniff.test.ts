// static/Files puts nosniff on its own answers, with no server around it to stamp them
// (design 276). Over a server the stamp is there either way; this pins the module's half.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadModule } from '@aweftjs/testing';

import * as Files from '../src/modules/Files.ts';

test('the module itself puts nosniff on the file, the 304, the bare 404, the 405 and the unknown page', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'aweft-nosniff-'));
	writeFileSync(join(dir, 'a.txt'), 'text');
	const { instance, stop } = await loadModule({ exports: Files, config: { dir, unknown: '404', headers: {}, public: true } });
	const files = instance as { request(request: Request): Promise<Response> };
	const header = (response: Response): string | null => response.headers.get('x-content-type-options');
	try {
		const file = await files.request(new Request('http://app.test/a.txt'));
		assert.equal(file.status, 200);
		assert.equal(header(file), 'nosniff', 'the file');
		await file.body?.cancel();
		const notModified = await files.request(new Request('http://app.test/a.txt', { headers: { 'if-none-match': file.headers.get('etag')! } }));
		assert.equal(notModified.status, 304);
		assert.equal(header(notModified), 'nosniff', 'the 304');
		const bare = await files.request(new Request('http://app.test/nothing'));
		assert.equal(bare.status, 404);
		assert.equal(header(bare), 'nosniff', 'the bare 404');
		const refused = await files.request(new Request('http://app.test/a.txt', { method: 'PUT' }));
		assert.equal(refused.status, 405);
		assert.equal(header(refused), 'nosniff', 'the 405');
		writeFileSync(join(dir, '404.html'), '<p>gone</p>');
		const page = await files.request(new Request('http://app.test/nothing'));
		assert.equal(page.status, 404);
		assert.equal(header(page), 'nosniff', 'the unknown page');
		await page.body?.cancel();
	} finally {
		await stop();
		rmSync(dir, { recursive: true, force: true });
	}
});
