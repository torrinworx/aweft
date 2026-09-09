// The behavioral corpus for `server`: requirements this problem domain is known to need, each
// stated as something aweft must do. Append-only; removing a case needs a design note.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createObject } from '@aweftjs/core';
import { encodeFrame } from '@aweftjs/sync';

import { createServer, open } from '../src/index.ts';
import type { Connection, Gate } from '../src/index.ts';

import { asClient, connectTo, fakeListener, growing, instance, request, settle, sourceOf } from './helpers.ts';

test('requirement: a text message never reaches the link and a binary one never reaches the calls, on one socket', async () => {
	const board = createObject<Record<string, unknown>>({ n: 0 });
	const source = sourceOf({
		'app/Board': instance(() => ({
			connection: ({ link }: Connection) => { link.share('board', board, open); },
			call: () => 'answered',
		})),
	});
	const listening = fakeListener();
	const server = createServer({ sources: [source], gate: open, listener: listening.listener });
	await server.start();
	const client = asClient(await connectTo(listening.handlers()));
	const copy = await client.link.share<Record<string, unknown>>('board').ready;
	await settle();

	// A text message that is a request frame, and a binary message that is a link frame,
	// each reach only their own channel. Neither closes anything.
	client.socket.fire('message', { data: JSON.stringify({ id: 999, result: 'stray' }) });
	client.socket.fire('message', { data: encodeFrame({ kind: 'leave', topic: 77 }) });
	await settle();
	assert.equal(client.socket.readyState, 1);
	copy.n = 1;
	await settle();
	assert.equal(board.n, 1, 'the link still works');
	assert.equal(await client.asks.ask('app/Board'), 'answered', 'and so do the requests');
	client.socket.close();
	await server.stop();
});

test('requirement: a hook that throws closes only its own connection, and the server keeps serving the next', async () => {
	let first = true;
	const source = sourceOf({
		'app/Flaky': instance(() => ({
			connection: () => { if (first) { first = false; throw new Error('once'); } },
			call: () => 'served',
		})),
	});
	const failed: string[] = [];
	const listening = fakeListener();
	const server = createServer({ sources: [source], gate: open, listener: listening.listener, handlers: { failed: (name) => failed.push(name) } });
	await server.start();
	const one = asClient(await connectTo(listening.handlers()));
	await settle();
	assert.equal(one.socket.readyState, 3);
	const two = asClient(await connectTo(listening.handlers()));
	await settle();
	assert.equal(two.socket.readyState, 1);
	assert.equal(await two.asks.ask('app/Flaky'), 'served');
	assert.deepEqual(failed, ['app/Flaky']);
	two.socket.close();
	await server.stop();
});

test('requirement: hooks run in load order, so a dependency has set its connection up before a dependent runs', async () => {
	const trace: string[] = [];
	const source = sourceOf({
		'lib/Session': instance(() => ({ connection: () => { trace.push('session'); } })),
		'app/Feed': instance(() => ({ connection: () => { trace.push('feed'); } }), ['lib/Session']),
		'app/Top': instance(() => ({ connection: () => { trace.push('top'); } }), ['app/Feed']),
	});
	const listening = fakeListener();
	const server = createServer({ sources: [source], gate: open, listener: listening.listener });
	await server.start();
	const client = asClient(await connectTo(listening.handlers()));
	await settle();
	assert.deepEqual(trace, ['session', 'feed', 'top']);
	client.socket.close();
	await server.stop();
});

test('requirement: the gate is asked afresh for every connection and every call, never remembered', async () => {
	let allowed = true;
	const asked: string[] = [];
	const gate: Gate = {
		identify: () => ({ context: {} }),
		access: ({ name }) => { asked.push(name); return allowed ? [] : [{ code: 'now-closed', message: 'no' }]; },
	};
	const source = sourceOf({ 'app/Thing': instance(() => ({ connection: () => {}, call: () => 'ok' })) });
	const listening = fakeListener();
	const server = createServer({ sources: [source], gate, listener: listening.listener });
	await server.start();
	const client = asClient(await connectTo(listening.handlers()));
	await settle();
	assert.equal(await client.asks.ask('app/Thing'), 'ok');
	allowed = false;
	assert.equal(await client.asks.ask('app/Thing').catch((e: { reason: string }) => e.reason), 'refused', 'a change in the gate is felt on the next call');
	assert.equal(asked.length, 3);
	client.socket.close();
	await server.stop();
});

test('requirement: a module loaded after the server started is served without a restart, and one unloaded stops being', async () => {
	const source = growing({}, {
		'app/Later': instance(() => ({ call: () => 'later', routes: { 'GET /later': () => new Response('later') } })),
	});
	const listening = fakeListener();
	const server = createServer({ sources: [source.source], gate: open, listener: listening.listener });
	await server.start();
	const client = asClient(await connectTo(listening.handlers()));
	assert.equal(await client.asks.ask('app/Later').catch((e: { reason: string }) => e.reason), 'missing');
	source.grow();
	await server.loader.load(['app/Later']);
	assert.equal(await client.asks.ask('app/Later'), 'later');
	assert.equal(await (await listening.handlers().request(request('/later'), { address: undefined })).text(), 'later');
	await server.loader.unload('app/Later');
	assert.equal(await client.asks.ask('app/Later').catch((e: { reason: string }) => e.reason), 'missing');
	client.socket.close();
	await server.stop();
});

test('requirement: the context is what identify said and is never shared between two connections', async () => {
	let n = 0;
	const seen: unknown[] = [];
	const source = sourceOf({ 'app/Thing': instance(() => ({ call: (_a: unknown, context: unknown) => { seen.push(context); return null; } })) });
	const listening = fakeListener();
	const server = createServer({ sources: [source], gate: { identify: () => ({ context: { n: ++n } }), access: () => [] }, listener: listening.listener });
	await server.start();
	const one = asClient(await connectTo(listening.handlers()));
	const two = asClient(await connectTo(listening.handlers()));
	await one.asks.ask('app/Thing');
	await two.asks.ask('app/Thing');
	await one.asks.ask('app/Thing');
	assert.deepEqual(seen, [{ n: 1 }, { n: 2 }, { n: 1 }]);
	one.socket.close();
	two.socket.close();
	await server.stop();
});
