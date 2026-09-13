// uploads/Serve: the headers, 304, HEAD, 405, the declines, `allow`, `public`, and the order
// against `static/Files` (design 262, amending 249).

import test from 'node:test';
import assert from 'node:assert/strict';

import { mkdir, writeFile } from 'node:fs/promises';

import { atomic, createObject } from '@aweftjs/core';
import { join } from 'node:path';

import { files as staticFiles } from '@aweftjs/static';
import type { ModuleExports } from '@aweftjs/modules';

import type { Files, Serve, UploadRecord } from '../src/index.ts';
import { collect, filesConfig, module, newStore, peer, png, post, reasonOf, request, signUp, started, tempDir } from './helpers.ts';

const uploaded = async (handlers: { request(r: Request, p: typeof peer): Promise<Response> }, bytes = png(120), name = 'kép.png'): Promise<UploadRecord> => {
	const answer = await handlers.request(post(bytes, 'image/png', { 'x-upload-name': encodeURIComponent(name) }), peer);
	assert.equal(answer.status, 201);
	return await answer.json() as UploadRecord;
};

test('a file is served with its type, length, a strong tag, immutable caching, nosniff, sandbox and its name', async () => {
	const temp = await tempDir();
	const { handlers, server } = await started({ config: filesConfig({ storage: temp.adapter }) });
	try {
		const bytes = png(120);
		const record = await uploaded(handlers, bytes);
		const answer = await handlers.request(request(record.url), peer);
		assert.equal(answer.status, 200);
		assert.equal(answer.headers.get('content-type'), 'image/png');
		assert.equal(answer.headers.get('content-length'), '120');
		assert.equal(answer.headers.get('etag'), `"${record.sha256}"`);
		assert.equal(answer.headers.get('cache-control'), 'public, max-age=31536000, immutable');
		assert.equal(answer.headers.get('x-content-type-options'), 'nosniff');
		assert.equal(answer.headers.get('content-security-policy'), 'sandbox');
		assert.equal(answer.headers.get('content-disposition'), "inline; filename*=UTF-8''k%C3%A9p.png");
		assert.deepEqual(await collect(answer.body as ReadableStream<Uint8Array>), bytes);
	} finally {
		await server.stop();
		await temp.gone();
	}
});

test('If-None-Match with the tag is 304 with no body; HEAD carries the headers and no body', async () => {
	const temp = await tempDir();
	const { handlers, server } = await started({ config: filesConfig({ storage: temp.adapter }) });
	try {
		const record = await uploaded(handlers);
		for (const header of [`"${record.sha256}"`, `W/"${record.sha256}"`, `"other", "${record.sha256}"`, '*']) {
			const cached = await handlers.request(request(record.url, { headers: { 'if-none-match': header } }), peer);
			assert.equal(cached.status, 304, header);
			assert.equal(cached.body, null);
			assert.equal(cached.headers.get('etag'), `"${record.sha256}"`);
		}
		const different = await handlers.request(request(record.url, { headers: { 'if-none-match': '"nope"' } }), peer);
		assert.equal(different.status, 200);

		const head = await handlers.request(request(record.url, { method: 'HEAD' }), peer);
		assert.equal(head.status, 200);
		assert.equal(head.headers.get('content-length'), '120');
		assert.equal(head.headers.get('content-type'), 'image/png');
		assert.equal(head.body, null);
	} finally {
		await server.stop();
		await temp.gone();
	}
});

test('another method on a live file is 405 with Allow; a name with no record and a path that is not a file are declined to a 404', async () => {
	const temp = await tempDir();
	const { handlers, server } = await started({ config: filesConfig({ storage: temp.adapter }) });
	try {
		const record = await uploaded(handlers);
		const posted = await handlers.request(request(record.url, { method: 'DELETE' }), peer);
		assert.equal(posted.status, 405);
		assert.equal(posted.headers.get('allow'), 'GET, HEAD');

		for (const path of ['/files/nothere', '/files/', '/files', '/files/a/b', '/files/bad%20key', `/files/${record.id}/x`]) {
			const missing = await handlers.request(request(path), peer);
			assert.equal(missing.status, 404, path);
		}
	} finally {
		await server.stop();
		await temp.gone();
	}
});

test('a record whose bytes are gone is 404 with no body, for HEAD as for GET; so is one whose key is outside the rule', async () => {
	const temp = await tempDir();
	const { handlers, server, store } = await started({ config: filesConfig({ storage: temp.adapter }) });
	try {
		const record = await uploaded(handlers);
		await temp.adapter.remove(record.id);
		const answer = await handlers.request(request(record.url), peer);
		assert.equal(answer.status, 404);
		assert.equal(answer.body, null);
		assert.equal((await handlers.request(request(record.url, { method: 'HEAD' }), peer)).status, 404);

		const handle = await store.open('upload:byhand');
		atomic(() => {
			Object.assign(handle.root, { kind: 'upload', user: null, name: null, type: 'image/png', size: 1, sha256: 'x', at: 1, meta: null });
			(handle.root as { storage: unknown }).storage = createObject({ adapter: 'directory', key: 'a/b' });
		});
		await store.settled(handle);
		await store.close(handle);
		assert.equal((await handlers.request(request('/files/byhand'), peer)).status, 404);
		assert.equal((await handlers.request(request('/files/byhand', { method: 'HEAD' }), peer)).status, 404);
	} finally {
		await server.stop();
		await temp.gone();
	}
});

test('allow refuses a file for one reader and passes it for another', async () => {
	const temp = await tempDir();
	const { handlers, server } = await started({
		withAuth: true,
		config: {
			...filesConfig({ storage: temp.adapter }),
			'./uploads/Serve.ts': { config: { allow: (upload: UploadRecord, context: { user: string | null }) => upload.user === context.user ? undefined : { reasons: [{ code: 'not-yours', message: 'not your file' }] } } } as never,
		},
	});
	try {
		const ada = await signUp(handlers, 'ada@example.com');
		const bob = await signUp(handlers, 'bob@example.com');
		const answer = await handlers.request(post(png(), 'image/png', { cookie: ada.cookie }), peer);
		const record = await answer.json() as UploadRecord;
		assert.equal((await handlers.request(request(record.url, { headers: { cookie: ada.cookie } }), peer)).status, 200);
		const refused = await handlers.request(request(record.url, { headers: { cookie: bob.cookie } }), peer);
		assert.equal(refused.status, 403);
		assert.deepEqual(await refused.json(), { reasons: [{ code: 'not-yours', message: 'not your file' }] });
		assert.equal((await handlers.request(request(record.url), peer)).status, 403, 'anonymous');
	} finally {
		await server.stop();
		await temp.gone();
	}
});

test('public: false makes every file need a signed-in reader', async () => {
	const temp = await tempDir();
	const { handlers, server } = await started({
		withAuth: true,
		config: { ...filesConfig({ storage: temp.adapter }), './uploads/Serve.ts': { config: { public: false } } as never },
	});
	try {
		const ada = await signUp(handlers, 'ada@example.com');
		const record = await (await handlers.request(post(png(), 'image/png', { cookie: ada.cookie }), peer)).json() as UploadRecord;
		assert.equal((await handlers.request(request(record.url), peer)).status, 403);
		assert.equal((await handlers.request(request(record.url, { headers: { cookie: ada.cookie } }), peer)).status, 200);
	} finally {
		await server.stop();
		await temp.gone();
	}
});

test('listed before static/Files the file is served; listed after, static answers its 404 page', async () => {
	const temp = await tempDir();
	const site = await tempDir();
	await mkdir(site.dir, { recursive: true });
	await writeFile(join(site.dir, '404.html'), '<h1>not here</h1>');
	const staticConfig: Record<string, ModuleExports> = { './static/Files.ts': { config: { dir: site.dir } } as never };
	const right = await started({ config: { ...filesConfig({ storage: temp.adapter }), ...staticConfig }, after: [staticFiles] });
	try {
		const record = await uploaded(right.handlers);
		const served = await right.handlers.request(request(record.url), peer);
		assert.equal(served.status, 200);
		assert.equal(served.headers.get('content-type'), 'image/png');
		const unknown = await right.handlers.request(request('/nothing'), peer);
		assert.equal(unknown.status, 404);
		assert.equal(unknown.headers.get('content-type'), 'text/html; charset=utf-8');
		const missing = await right.handlers.request(request('/files/nothere'), peer);
		assert.equal(missing.status, 404);
		assert.equal(missing.headers.get('content-type'), 'text/html; charset=utf-8', 'an id with no record is declined to the static page, not answered');
	} finally {
		await right.server.stop();
	}

	const wrong = await started({ config: { ...filesConfig({ storage: temp.adapter }), ...staticConfig }, before: [staticFiles] });
	try {
		const record = await uploaded(wrong.handlers);
		const served = await wrong.handlers.request(request(record.url), peer);
		assert.equal(served.status, 404);
		assert.equal(served.headers.get('content-type'), 'text/html; charset=utf-8', 'the page, not the file');
	} finally {
		await wrong.server.stop();
		await temp.gone();
		await site.gone();
	}
});

test('the configuration is refused at load for each wrong value', async () => {
	const store = newStore();
	const temp = await tempDir();
	const files = await module<Files>('Files', store, {}, { storage: temp.adapter });
	try {
		for (const config of [{ public: 'yes' }, { allow: 'everyone' }]) {
			await assert.rejects(module<Serve>('Serve', store, { 'uploads/Files': files.instance }, config), (error) => reasonOf(error) === 'invalid-config');
		}
	} finally {
		await files.stop();
		await temp.gone();
	}
});

