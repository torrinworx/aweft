// The gate: required, asked once per connection or request, asked again per module, and
// the server does what it says (design 071). Through the public surface.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createObject } from '@aweftjs/core';
import type { RequestError } from '@aweftjs/sync';

import { createServer, open } from '../src/index.ts';
import type { Connection, Gate, Named, ServerError } from '../src/index.ts';

import { asClient, connectTo, fakeListener, instance, peer, reasonOf, request, settle, sourceOf } from './helpers.ts';

type Ctx = { user: string | null };

/** A gate in the shape the auth battery has: a header says who, `public` says what is open. */
const byHeader: Gate<Ctx> = {
	identify: (req) => {
		const who = req.headers.get('x-user');
		if (who === 'forged') return { refused: [{ code: 'forged', message: 'that is not a user' }] };
		return { context: { user: who } };
	},
	access: ({ name, instance: held }, context) =>
		(held as { public?: boolean }).public === true || context.user !== null
			? []
			: [{ code: 'private', message: `${name} needs a user` }],
};

const app = () => {
	const trace: string[] = [];
	const source = sourceOf({
		'app/Public': instance(() => ({
			public: true,
			connection: ({ context }: Connection<Ctx>) => { trace.push(`Public saw ${String(context.user)}`); },
			call: (args: unknown, context: Ctx) => ({ echo: args, user: context.user }),
			routes: { 'GET /open': (_req: Request, context: Ctx) => new Response(`open to ${String(context.user)}`) },
		})),
		// Depends on Public, so load order (dependency order) puts Public first.
		'app/Private': instance(() => ({
			connection: ({ context }: Connection<Ctx>) => { trace.push(`Private saw ${String(context.user)}`); },
			call: () => 'secret',
			routes: { 'GET /secret': () => new Response('the secret') },
		}), ['app/Public']),
	});
	return { source, trace };
};

test('createServer refuses to be made without sources, a gate or a listener', () => {
	const { source } = app();
	const sources = [source];
	const { listener } = fakeListener();
	for (const options of [{ gate: open, listener }, { sources, listener }, { sources, gate: open }]) {
		assert.throws(() => createServer(options as never), (e: ServerError) => e.reason === 'missing');
	}
});

test('identify runs once per request and once per handshake, and a refusal is 401 with the reasons', async () => {
	const { source } = app();
	const listening = fakeListener();
	const server = createServer({ sources: [source], gate: byHeader, listener: listening.listener });
	await server.start();
	const handlers = listening.handlers();

	const refused = await handlers.request(request('/open', { headers: { 'x-user': 'forged' } }), peer);
	assert.equal(refused.status, 401);
	assert.deepEqual(await refused.json(), { reasons: [{ code: 'forged', message: 'that is not a user' }] });

	const handshake = await handlers.socket(request('/ws', { headers: { 'x-user': 'forged' } }), peer);
	assert.ok(handshake instanceof Response, 'a refused handshake is a response, and no socket is ever handed over');
	assert.equal(handshake.status, 401);

	const allowed = await handlers.request(request('/open', { headers: { 'x-user': 'ada' } }), peer);
	assert.equal(await allowed.text(), 'open to ada');
	await server.stop();
});

test('a throw out of identify is a defect: 500, reported as gate, never a 401', async () => {
	const { source } = app();
	const failed: string[] = [];
	const listening = fakeListener();
	const server = createServer({
		sources: [source], listener: listening.listener,
		gate: { identify: () => { throw new Error('the store is down'); }, access: () => [] },
		handlers: { failed: (name, error) => failed.push(`${name}: ${(error as Error).message}`) },
	});
	await server.start();
	const response = await listening.handlers().request(request('/open'), peer);
	assert.equal(response.status, 500);
	const handshake = await listening.handlers().socket(request('/ws'), peer);
	assert.ok(handshake instanceof Response && handshake.status === 500);
	assert.deepEqual(failed, ['gate: the store is down', 'gate: the store is down']);
	await server.stop();
});

test('access decides which hooks run, which calls answer and which routes serve, per module', async () => {
	const { source, trace } = app();
	const listening = fakeListener();
	const server = createServer({ sources: [source], gate: byHeader, listener: listening.listener });
	await server.start();
	const handlers = listening.handlers();

	const anonymous = asClient(await connectTo(handlers));
	await settle();
	assert.deepEqual(trace, ['Public saw null'], 'only the public module saw the anonymous connection');
	assert.deepEqual(await anonymous.asks.ask('app/Public', 7), { echo: 7, user: null });
	await assert.rejects(anonymous.asks.ask('app/Private'), (e: RequestError) =>
		e.reason === 'refused' && JSON.stringify(e.reasons) === '[{"code":"private","message":"app/Private needs a user"}]');
	const secret = await handlers.request(request('/secret'), peer);
	assert.equal(secret.status, 403);
	assert.deepEqual(await secret.json(), { reasons: [{ code: 'private', message: 'app/Private needs a user' }] });

	trace.length = 0;
	const ada = asClient(await connectTo(handlers, { headers: { 'x-user': 'ada' } }));
	await settle();
	assert.deepEqual(trace, ['Public saw ada', 'Private saw ada'], 'a user sees both, in load order');
	assert.equal(await ada.asks.ask('app/Private'), 'secret');
	assert.equal(await (await handlers.request(request('/secret', { headers: { 'x-user': 'ada' } }), peer)).text(), 'the secret');

	anonymous.socket.close();
	ada.socket.close();
	await server.stop();
});

test('a throw out of access is reported against the module and closes the connection', async () => {
	const { source } = app();
	const failed: string[] = [];
	const listening = fakeListener();
	const server = createServer({
		sources: [source], listener: listening.listener,
		gate: { identify: () => ({ context: {} }), access: () => { throw new Error('cannot decide'); } },
		handlers: { failed: (name, error) => failed.push(`${name}: ${(error as Error).message}`) },
	});
	await server.start();
	const client = asClient(await connectTo(listening.handlers()));
	await settle();
	assert.equal(client.socket.readyState, 3, 'the connection was closed');
	assert.deepEqual(failed, ['app/Public: cannot decide']);
	const response = await listening.handlers().request(request('/open'), peer);
	assert.equal(response.status, 500);
	assert.equal(failed.length, 2);
	await server.stop();
});

test('open identifies everyone with an empty context, allows every module, and accepts every commit', async () => {
	const { source, trace } = app();
	const listening = fakeListener();
	const server = createServer({ sources: [source], gate: open, listener: listening.listener });
	await server.start();
	const handlers = listening.handlers();

	assert.deepEqual(await open.identify(request('/'), peer), { context: {} });
	assert.deepEqual(open.access({ name: 'x', instance: {} } as Named, {}), []);
	assert.deepEqual(open.accept({ deltas: [] }), []);

	const client = asClient(await connectTo(handlers));
	await settle();
	assert.deepEqual(trace, ['Public saw undefined', 'Private saw undefined']);
	assert.equal(await client.asks.ask('app/Private'), 'secret');
	assert.equal((await handlers.request(request('/secret'), peer)).status, 200);
	client.socket.close();
	await server.stop();
});

test('what identify resolved reaches every hook as an argument, and the server reads nothing off it', async () => {
	const seen: unknown[] = [];
	const source = sourceOf({
		'app/Thing': instance(() => ({
			connection: ({ context }: Connection<unknown>) => { seen.push(context); },
			call: (_args: unknown, context: unknown) => { seen.push(context); return null; },
			routes: { 'GET /': (_req: Request, context: unknown) => { seen.push(context); return new Response(null, { status: 204 }); } },
		})),
	});
	// A context that is not an object at all, and one that is an observable: the server
	// passes both through untouched.
	const contexts: unknown[] = ['just a string', createObject({ role: 'admin' })];
	let at = 0;
	const listening = fakeListener();
	const server = createServer({
		sources: [source], listener: listening.listener,
		gate: { identify: () => ({ context: contexts[at++ % 2] }), access: () => [] },
	});
	await server.start();
	const client = asClient(await connectTo(listening.handlers()));
	await settle();
	await client.asks.ask('app/Thing');
	await listening.handlers().request(request('/'), peer);
	assert.equal(seen[0], 'just a string');
	assert.equal(seen[1], 'just a string');
	assert.equal(seen[2], contexts[1]);
	client.socket.close();
	await server.stop();
});

test('a gate is any object with the two functions, so a loaded module instance named as one is one', async () => {
	const source = sourceOf({
		'my/Gate': instance(() => ({
			identify: (req: Request) => ({ context: { path: new URL(req.url).pathname } }),
			access: ({ name }: Named) => (name.startsWith('hidden/') ? [{ code: 'hidden', message: 'no' }] : []),
		})),
		'hidden/Thing': instance(() => ({ call: () => 1 })),
		'shown/Thing': instance(() => ({ call: (_a: unknown, context: { path: string }) => context.path })),
	});
	const listening = fakeListener();
	const server = createServer({ sources: [source], gate: 'my/Gate', listener: listening.listener });
	await server.start();
	const client = asClient(await connectTo(listening.handlers()));
	assert.equal(await client.asks.ask('shown/Thing'), '/ws');
	assert.equal(await client.asks.ask('hidden/Thing').catch(reasonOf), 'refused');
	client.socket.close();
	await server.stop();
});
