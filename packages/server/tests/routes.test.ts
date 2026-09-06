// HTTP routes: exact keys, the gate in front, and what a failure answers (design 072).

import test from 'node:test';
import assert from 'node:assert/strict';

import { createServer, open } from '../src/index.ts';
import type { ServerError } from '../src/index.ts';

import { fakeListener, instance, loaderOf, peer, request } from './helpers.ts';

const started = async (map: Parameters<typeof loaderOf>[0], failed: string[] = []) => {
	const loader = loaderOf(map);
	await loader.load(Object.keys(map));
	const listening = fakeListener();
	const server = createServer({
		loader, gate: open, listener: listening.listener,
		handlers: { failed: (name, error) => failed.push(`${name}: ${(error as Error).message}`) },
	});
	await server.start();
	return { loader, server, handlers: listening.handlers() };
};

test('a route is matched by exact method and path; the query is not part of the key', async () => {
	const { handlers, server } = await started({
		'app/Notes': instance(() => ({
			routes: {
				'GET /notes': (req: Request) => new Response(`list ${new URL(req.url).search}`),
				'POST /notes': async (req: Request) => new Response(`made ${await req.text()}`, { status: 201 }),
			},
		})),
	});
	assert.equal(await (await handlers.request(request('/notes?tag=x'), peer)).text(), 'list ?tag=x');
	const made = await handlers.request(request('/notes', { method: 'POST', body: 'a note' }), peer);
	assert.equal(made.status, 201);
	assert.equal(await made.text(), 'made a note');
	assert.equal((await handlers.request(request('/notes', { method: 'DELETE' }), peer)).status, 404);
	assert.equal((await handlers.request(request('/notes/1'), peer)).status, 404);
	assert.equal((await handlers.request(request('/'), peer)).status, 404);
	await server.stop();
});

test('the response is handed back whole: status, headers and body', async () => {
	const { handlers, server } = await started({
		'app/Thing': instance(() => ({
			routes: {
				'GET /': () => new Response(JSON.stringify({ ok: true }), {
					status: 202, headers: { 'content-type': 'application/json', 'set-cookie': 'a=1; HttpOnly' },
				}),
			},
		})),
	});
	const response = await handlers.request(request('/'), peer);
	assert.equal(response.status, 202);
	assert.equal(response.headers.get('content-type'), 'application/json');
	assert.deepEqual(response.headers.getSetCookie(), ['a=1; HttpOnly']);
	assert.deepEqual(await response.json(), { ok: true });
	await server.stop();
});

test('two loaded modules declaring one route are refused at start, naming both', async () => {
	const loader = loaderOf({
		'app/One': instance(() => ({ routes: { 'GET /same': () => new Response('one') } })),
		'app/Two': instance(() => ({ routes: { 'GET /same': () => new Response('two') } })),
	});
	await loader.load(['app/One', 'app/Two']);
	const server = createServer({ loader, gate: open, listener: fakeListener().listener });
	await assert.rejects(server.start(), (e: ServerError) => e.reason === 'route-conflict' && /app\/One and app\/Two both declare GET \/same/.test(e.message));
});

test('a module loaded after start serves its routes with no restart', async () => {
	const map = {
		'app/First': instance(() => ({ routes: { 'GET /first': () => new Response('first') } })),
		'app/Later': instance(() => ({ routes: { 'GET /later': () => new Response('later') } })),
	};
	const loader = loaderOf(map);
	await loader.load(['app/First']);
	const listening = fakeListener();
	const server = createServer({ loader, gate: open, listener: listening.listener });
	await server.start();
	assert.equal((await listening.handlers().request(request('/later'), peer)).status, 404);
	await loader.load(['app/Later']);
	assert.equal(await (await listening.handlers().request(request('/later'), peer)).text(), 'later');
	await loader.unload('app/First');
	assert.equal((await listening.handlers().request(request('/first'), peer)).status, 404, 'an unloaded module\'s route is gone');
	await server.stop();
});

test('a conflict met at request time is 500 and reported as routes', async () => {
	const failed: string[] = [];
	const map = {
		'app/One': instance(() => ({ routes: { 'GET /same': () => new Response('one') } })),
		'app/Two': instance(() => ({ routes: { 'GET /same': () => new Response('two') } })),
	};
	const loader = loaderOf(map);
	await loader.load(['app/One']);
	const listening = fakeListener();
	const server = createServer({
		loader, gate: open, listener: listening.listener,
		handlers: { failed: (name, error) => failed.push(`${name}: ${(error as Error).message}`) },
	});
	await server.start();
	await loader.load(['app/Two']);
	assert.equal((await listening.handlers().request(request('/same'), peer)).status, 500);
	assert.deepEqual(failed, ['routes: route-conflict: app/One and app/Two both declare GET /same. Rename one of the two routes, or unload one of the modules.']);
	await server.stop();
});

test('a route that answers with something that is not a Response is 500 and reported, like a throw', async () => {
	const failed: string[] = [];
	const { handlers, server } = await started({
		'app/Odd': instance(() => ({ routes: { 'GET /plain': () => 'just text' as unknown as Response, 'GET /nothing': () => undefined as unknown as Response } })),
	}, failed);
	assert.equal((await handlers.request(request('/plain'), peer)).status, 500);
	assert.equal((await handlers.request(request('/nothing'), peer)).status, 500);
	assert.equal(failed.length, 2);
	assert.match(failed[0]!, /^app\/Odd: not-a-response: app\/Odd answered GET \/plain with something that is not a Response/);
	await server.stop();
});

test('a route that throws answers 500 and is reported against its module', async () => {
	const failed: string[] = [];
	const { handlers, server } = await started({
		'app/Thing': instance(() => ({ routes: { 'GET /': () => { throw new Error('no such note'); } } })),
	}, failed);
	assert.equal((await handlers.request(request('/'), peer)).status, 500);
	assert.deepEqual(failed, ['app/Thing: no such note']);
	await server.stop();
});

test('a routes field that is not an object, or an entry that is not a function, is not a route', async () => {
	const { handlers, server } = await started({
		'app/Odd': instance(() => ({ routes: 'not routes' })),
		'app/Odder': instance(() => ({ routes: { 'GET /x': 'not a handler', 'GET /y': () => new Response('y') } })),
		'app/Plain': instance(() => 42),
	});
	assert.equal((await handlers.request(request('/x'), peer)).status, 404);
	assert.equal(await (await handlers.request(request('/y'), peer)).text(), 'y');
	await server.stop();
});

test('start twice is refused, and stop twice is not an error', async () => {
	const listening = fakeListener();
	const server = createServer({ loader: loaderOf({}), gate: open, listener: listening.listener });
	await server.start();
	await assert.rejects(server.start(), (e: ServerError) => e.reason === 'started');
	await server.stop();
	await server.stop();
	assert.equal(listening.stopped(), 2);
	await server.start();
	await server.stop();
});
