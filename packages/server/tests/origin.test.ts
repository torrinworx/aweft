// The Origin rule before the gate (design 272).

import test from 'node:test';
import assert from 'node:assert/strict';

import { createServer, open } from '../src/index.ts';
import type { ServerOptions } from '../src/index.ts';

import { asClient, connectTo, fakeListener, instance, peer, request, sourceOf } from './helpers.ts';

const started = async (options: Partial<ServerOptions> = {}) => {
	const listening = fakeListener();
	const server = createServer({
		sources: [sourceOf({
			'app/Echo': instance(() => ({
				public: true,
				call: () => 'hi',
				routes: {
					'GET /hi': () => new Response('hi'), 'HEAD /hi': () => new Response(null),
					'POST /hi': () => new Response('posted'), 'DELETE /hi': () => new Response('gone'),
				},
			})),
		})],
		gate: open, listener: listening.listener, ...options,
	});
	await server.start();
	return { server, handlers: listening.handlers() };
};

const codes = async (response: Response): Promise<string[]> =>
	((await response.json()) as { reasons: { code: string }[] }).reasons.map((r) => r.code);

test('a foreign Origin is 403 on a POST and a DELETE, and passes on a GET', async () => {
	const { handlers, server } = await started();
	const foreign = { origin: 'https://evil.test' };
	const posted = await handlers.request(request('/hi', { method: 'POST', headers: foreign }), peer);
	assert.equal(posted.status, 403);
	assert.deepEqual(await codes(posted), ['origin']);
	assert.equal((await handlers.request(request('/hi', { method: 'DELETE', headers: foreign }), peer)).status, 403);
	assert.equal((await handlers.request(request('/hi', { headers: foreign }), peer)).status, 200, 'a read passes');
	assert.equal((await handlers.request(request('/hi', { method: 'HEAD', headers: foreign }), peer)).status, 200);
	await server.stop();
});

test('the request\'s own host passes, port included, and a port that differs does not', async () => {
	const { handlers, server } = await started();
	assert.equal((await handlers.request(request('/hi', { method: 'POST', headers: { origin: 'http://app.test' } }), peer)).status, 200);
	assert.equal((await handlers.request(request('/hi', { method: 'POST', headers: { origin: 'https://app.test' } }), peer)).status, 200, 'the scheme is not the host');
	assert.equal((await handlers.request(request('/hi', { method: 'POST', headers: { origin: 'http://app.test:8443' } }), peer)).status, 403);
	assert.equal((await handlers.request(request('/hi', { method: 'POST', headers: { origin: 'http://app.test.evil.test' } }), peer)).status, 403);
	await server.stop();
});

test('no Origin header passes, and an opaque origin does not', async () => {
	const { handlers, server } = await started();
	assert.equal((await handlers.request(request('/hi', { method: 'POST' }), peer)).status, 200);
	assert.equal((await handlers.request(request('/hi', { method: 'POST', headers: { origin: 'null' } }), peer)).status, 403);
	await server.stop();
});

test('a handshake from a foreign Origin is refused with 403 and no socket opens; the same host and no header open one', async () => {
	const { handlers, server } = await started();
	const refused = await connectTo(handlers, { headers: { origin: 'https://evil.test' } });
	assert.ok(refused instanceof Response);
	assert.equal(refused.status, 403);
	assert.deepEqual(await codes(refused), ['origin']);
	const same = asClient(await connectTo(handlers, { headers: { origin: 'http://app.test' } }));
	assert.equal(await same.asks.ask('app/Echo'), 'hi');
	same.socket.close();
	const bare = asClient(await connectTo(handlers));
	assert.equal(await bare.asks.ask('app/Echo'), 'hi');
	bare.socket.close();
	await server.stop();
});

test('a listed origin passes, and any removes the rule', async () => {
	const listed = await started({ origins: ['https://app.example', 'http://localhost:5173'] });
	for (const origin of ['https://app.example', 'http://localhost:5173']) {
		assert.equal((await listed.handlers.request(request('/hi', { method: 'POST', headers: { origin } }), peer)).status, 200, origin);
	}
	assert.equal((await listed.handlers.request(request('/hi', { method: 'POST', headers: { origin: 'https://evil.test' } }), peer)).status, 403);
	assert.ok(asClient(await connectTo(listed.handlers, { headers: { origin: 'https://app.example' } })));
	await listed.server.stop();

	const any = await started({ origins: 'any' });
	assert.equal((await any.handlers.request(request('/hi', { method: 'POST', headers: { origin: 'https://evil.test' } }), peer)).status, 200);
	assert.equal((await any.handlers.request(request('/hi', { method: 'POST', headers: { origin: 'null' } }), peer)).status, 200);
	await any.server.stop();
});

test('the rule runs before the gate, so a refused request never reaches identify', async () => {
	let identified = 0;
	const { handlers, server } = await started({ gate: { identify: () => { identified += 1; return { context: {} }; }, access: () => [] } });
	assert.equal((await handlers.request(request('/hi', { method: 'POST', headers: { origin: 'https://evil.test' } }), peer)).status, 403);
	assert.equal(identified, 0);
	assert.equal((await handlers.request(request('/hi', { method: 'POST' }), peer)).status, 200);
	assert.equal(identified, 1);
	await server.stop();
});
