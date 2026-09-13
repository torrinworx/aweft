// uploads/Receive: the route, through a server with the harness listener (design 262).

import test from 'node:test';
import assert from 'node:assert/strict';

import type { Files, Receive, UploadRecord } from '../src/index.ts';
import { collect, filesConfig, jpeg, module, newStore, peer, png, post, reasonOf, request, sha256, signUp, started, tempDir } from './helpers.ts';

const reasons = async (answer: Response): Promise<{ code: string; message: string }[]> =>
	((await answer.json()) as { reasons: { code: string; message: string }[] }).reasons;

test('a post is 201 with the record, and the file is served back', async () => {
	const temp = await tempDir();
	const { handlers, server, store } = await started({ config: filesConfig({ storage: temp.adapter }) });
	try {
		const bytes = png(200);
		const answer = await handlers.request(post(bytes, 'image/png; charset=binary', { 'x-upload-name': encodeURIComponent('my cat.png') }), peer);
		assert.equal(answer.status, 201);
		const record = await answer.json() as UploadRecord;
		assert.equal(record.type, 'image/png');
		assert.equal(record.name, 'my cat.png');
		assert.equal(record.size, 200);
		assert.equal(record.sha256, sha256(bytes));
		assert.equal(record.user, null);
		assert.equal(record.url, `/files/${record.id}`);
		assert.equal(await store.head(`upload:${record.id}`), 1);

		const served = await handlers.request(request(record.url), peer);
		assert.equal(served.status, 200);
		assert.equal(served.headers.get('content-type'), 'image/png');
		assert.deepEqual(await collect(served.body as ReadableStream<Uint8Array>), bytes);
	} finally {
		await server.stop();
		await temp.gone();
	}
});

test('each refusal answers its status and code, and leaves no record', async () => {
	const temp = await tempDir();
	const { handlers, server, store } = await started({ config: filesConfig({ storage: temp.adapter, maxBytes: 100 }) });
	try {
		const cases: [string, Request, number, string][] = [
			['no type', request('/api/uploads', { method: 'POST', body: png(), headers: { 'content-length': '64' } }), 415, 'unsupported-type'],
			['a type outside types', post(png(), 'text/html'), 415, 'unsupported-type'],
			['bytes that are not the type', post(jpeg(), 'image/png'), 415, 'unsupported-type'],
			['no length', request('/api/uploads', { method: 'POST', body: png(), headers: { 'content-type': 'image/png' } }), 411, 'no-length'],
			['a length over the cap', post(png(), 'image/png', {}, 101), 413, 'too-large'],
			['a body over the cap under a length that lies', post(png(150), 'image/png', {}, 90), 413, 'too-large'],
			['a body short of its length', post(png(50), 'image/png', {}, 80), 400, 'wrong-length'],
			['a name that does not decode', post(png(), 'image/png', { 'x-upload-name': '%E0%A4%A' }), 400, 'bad-name'],
		];
		for (const [what, sent, status, code] of cases) {
			const answer = await handlers.request(sent, peer);
			assert.equal(answer.status, status, what);
			assert.equal((await reasons(answer))[0]!.code, code, what);
		}
		assert.deepEqual(await store.find({ where: [{ field: 'kind', op: 'eq', value: 'upload' }] }), []);
	} finally {
		await server.stop();
		await temp.gone();
	}
});

test('accept refusing is 422 with its reasons; accept throwing is 500 reported under the route', async () => {
	const temp = await tempDir();
	const { handlers, server, failed } = await started({
		config: filesConfig({
			storage: temp.adapter,
			accept: (upload: { size: number }) => {
				if (upload.size === 33) throw new Error('moderation is down');
				return upload.size === 32 ? { reasons: [{ code: 'nsfw', message: 'not here' }] } : undefined;
			},
		}),
	});
	try {
		const refused = await handlers.request(post(png(32), 'image/png'), peer);
		assert.equal(refused.status, 422);
		assert.deepEqual(await reasons(refused), [{ code: 'nsfw', message: 'not here' }]);

		const broke = await handlers.request(post(png(33), 'image/png'), peer);
		assert.equal(broke.status, 500);
		assert.deepEqual(failed, ['uploads/Receive: moderation is down']);

		assert.equal((await handlers.request(post(png(34), 'image/png'), peer)).status, 201);
	} finally {
		await server.stop();
		await temp.gone();
	}
});

test('an adapter that fails is 500 reported under the route, never 413; a sender that stops is 400 incomplete', async () => {
	const temp = await tempDir();
	const failing = { ...temp.adapter, put: async () => { throw Object.assign(new Error('no space left'), { code: 'ENOSPC' }); } };
	const broken = await started({ config: filesConfig({ storage: failing }) });
	try {
		const answer = await broken.handlers.request(post(png(), 'image/png'), peer);
		assert.equal(answer.status, 500);
		assert.deepEqual(broken.failed, ['uploads/Receive: no space left']);
	} finally {
		await broken.server.stop();
	}
	const { handlers, server, failed } = await started({ config: filesConfig({ storage: temp.adapter }) });
	try {
		const cut = new ReadableStream<Uint8Array>({
			start: (c) => { c.enqueue(png(10)); },
			pull: (c) => { c.error(new Error('socket reset')); },
		}, { highWaterMark: 0 });
		const answer = await handlers.request(request('/api/uploads', {
			method: 'POST', body: cut, duplex: 'half', headers: { 'content-type': 'image/png', 'content-length': '40' },
		} as RequestInit), peer);
		assert.equal(answer.status, 400);
		assert.equal((await reasons(answer))[0]!.code, 'incomplete');
		assert.deepEqual(failed, [], 'a sender going away is not the module\'s failure');
	} finally {
		await server.stop();
		await temp.gone();
	}
});

test('under the auth gate an anonymous post is 403 before the body is read; a signed-in one carries its user', async () => {
	const temp = await tempDir();
	const { handlers, server } = await started({ withAuth: true, config: filesConfig({ storage: temp.adapter }) });
	try {
		let pulled = false;
		const body = new ReadableStream<Uint8Array>({ pull: () => { pulled = true; } }, { highWaterMark: 0 });
		const anonymous = await handlers.request(request('/api/uploads', {
			method: 'POST', body, duplex: 'half', headers: { 'content-type': 'image/png', 'content-length': '64' },
		} as RequestInit), peer);
		assert.equal(anonymous.status, 403);
		assert.equal(pulled, false, 'the body was never read');

		const { user, cookie } = await signUp(handlers, 'ada@example.com');
		const answer = await handlers.request(post(png(), 'image/png', { cookie }), peer);
		assert.equal(answer.status, 201);
		assert.equal(((await answer.json()) as UploadRecord).user, user);
	} finally {
		await server.stop();
		await temp.gone();
	}
});

test('public: true opens the route under the auth gate', async () => {
	const temp = await tempDir();
	const { handlers, server } = await started({
		withAuth: true,
		config: { ...filesConfig({ storage: temp.adapter }), './uploads/Receive.ts': { config: { public: true } } as never },
	});
	try {
		assert.equal((await handlers.request(post(png(), 'image/png'), peer)).status, 201);
	} finally {
		await server.stop();
		await temp.gone();
	}
});

test('over concurrent uploads in flight the route answers 429, and the slot comes back after', async () => {
	const temp = await tempDir();
	const { handlers, server } = await started({
		config: { ...filesConfig({ storage: temp.adapter }), './uploads/Receive.ts': { config: { concurrent: 1 } } as never },
	});
	try {
		let release: () => void = () => {};
		const gate = new Promise<void>((done) => { release = done; });
		// Twenty bytes at once, then nothing until released, then the end: one upload held open.
		const slow = new ReadableStream<Uint8Array>({
			start: (c) => { c.enqueue(png(20)); },
			pull: async (c) => { await gate; c.close(); },
		}, { highWaterMark: 0 });
		const first = handlers.request(request('/api/uploads', {
			method: 'POST', body: slow, duplex: 'half', headers: { 'content-type': 'image/png', 'content-length': '20' },
		} as RequestInit), peer);
		await new Promise((done) => setTimeout(done, 20));
		const second = await handlers.request(post(png(20), 'image/png'), peer);
		assert.equal(second.status, 429);
		assert.equal((await reasons(second))[0]!.code, 'busy');
		release();
		assert.equal((await first).status, 201);
		assert.equal((await handlers.request(post(png(20), 'image/png'), peer)).status, 201);
	} finally {
		await server.stop();
		await temp.gone();
	}
});

test('the configuration is refused at load for each wrong value', async () => {
	const store = newStore();
	const temp = await tempDir();
	const files = await module<Files>('Files', store, {}, { storage: temp.adapter });
	try {
		for (const config of [{ public: 'yes' }, { concurrent: 0 }, { concurrent: 'many' }]) {
			await assert.rejects(module<Receive>('Receive', store, { 'uploads/Files': files.instance }, config), (error) => reasonOf(error) === 'invalid-config');
		}
	} finally {
		await files.stop();
		await temp.gone();
	}
});
