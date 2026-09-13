// A module that hears what the server did: every event kind, in load order, with a throw
// reported and never re-emitted (design 260).

import test from 'node:test';
import assert from 'node:assert/strict';

import { createObject } from '@aweftjs/core';
import type { Commit, WireReason } from '@aweftjs/sync';

import { createServer, open } from '../src/index.ts';
import type { Connection, Gate, ServerEvent } from '../src/index.ts';

import { asClient, connectTo, fakeListener, growing, instance, peer, request, settle, sourceOf, tick } from './helpers.ts';

type Ctx = { user: string | null };

const byHeader: Gate<Ctx> = {
	identify: (req) => ({ context: { user: req.headers.get('x-user') } }),
	access: ({ name, instance: held }, context) =>
		(held as { public?: boolean }).public === true || context.user !== null ? [] : [{ code: 'private', message: `${name} needs a user` }],
};

interface Heard { readonly event: ServerEvent; readonly context: unknown }

/** An observer module that keeps what it heard, and a source over the app modules beside it. */
const observing = (name: string, heard: Heard[], observe?: (event: ServerEvent, context: unknown) => unknown) =>
	instance(() => ({ observe: (event: ServerEvent, context: unknown) => { heard.push({ event, context }); return observe?.(event, context); } }));

const started = async (map: Parameters<typeof sourceOf>[0], gate: Gate | string = open, failed: string[] = []) => {
	const listening = fakeListener();
	const server = createServer({
		sources: [sourceOf(map)], gate, listener: listening.listener,
		handlers: { failed: (name, error) => failed.push(`${name}: ${(error as Error).message}`) },
	});
	await server.start();
	return { server, handlers: listening.handlers() };
};

const kinds = (heard: readonly Heard[]): string[] => heard.map(({ event }) => event.kind);

test('one connection that asks, is refused, and closes is heard as connection, call, call, closed, in that order', async () => {
	const heard: Heard[] = [];
	const { handlers, server } = await started({
		'app/Sum': instance(() => ({ public: true, call: (args: unknown) => (args as number[]).reduce((a, b) => a + b, 0) })),
		'app/Private': instance(() => ({ call: () => 'secret' })),
		'log/Observe': observing('log/Observe', heard),
	}, byHeader);
	const client = asClient(await connectTo(handlers));
	await settle();
	assert.equal(await client.asks.ask('app/Sum', [1, 2, 3]), 6);
	await client.asks.ask('app/Private').catch(() => undefined);
	await client.asks.ask('app/Missing').catch(() => undefined);
	client.socket.close();
	await settle();
	await server.stop();

	assert.deepEqual(kinds(heard), ['connection', 'call', 'call', 'call', 'closed']);
	const [opened, sum, refused, missing, closed] = heard.map(({ event }) => event) as [
		Extract<ServerEvent, { kind: 'connection' }>, Extract<ServerEvent, { kind: 'call' }>,
		Extract<ServerEvent, { kind: 'call' }>, Extract<ServerEvent, { kind: 'call' }>, Extract<ServerEvent, { kind: 'closed' }>,
	];
	assert.equal(new URL(opened.request.url).pathname, '/ws', 'the handshake request rides the connection event');
	assert.deepEqual([sum.name, sum.args, sum.outcome], ['app/Sum', [1, 2, 3], { result: 6 }]);
	assert.equal((sum.instance as { public: boolean }).public, true, 'the instance rides the event, so a consumer reads what the module carries');
	assert.equal('instance' in missing, false);
	assert.ok(sum.ms >= 0 && sum.at <= Date.now());
	assert.equal(refused.name, 'app/Private');
	assert.equal((refused.outcome as { error: { reason: string } }).error.reason, 'refused', 'the server\'s own refusal is the outcome');
	assert.equal((missing.outcome as { error: { reason: string } }).error.reason, 'missing');
	assert.ok(closed.ms >= 0);
	// One context reference for the whole connection, the one the call itself received.
	assert.ok(heard.every(({ context }) => context === heard[0]!.context));
	assert.deepEqual(heard[0]!.context, { user: null });
});

test('an HTTP answer is heard as request, named after the module whose route or hook answered, unnamed when the server did', async () => {
	const heard: Heard[] = [];
	const { handlers, server } = await started({
		'app/Api': instance(() => ({ routes: { 'GET /api/thing': () => new Response('thing') } })),
		'app/Files': instance(() => ({ request: (req: Request) => (new URL(req.url).pathname === '/page' ? new Response('page') : undefined) })),
		'log/Observe': observing('log/Observe', heard),
	});
	assert.equal((await handlers.request(request('/api/thing'), peer)).status, 200);
	assert.equal((await handlers.request(request('/page?x=1', { method: 'POST' }), peer)).status, 200);
	assert.equal((await handlers.request(request('/nope'), peer)).status, 404);
	await server.stop();

	const requests = heard.map(({ event }) => event as Extract<ServerEvent, { kind: 'request' }>);
	assert.deepEqual(kinds(heard), ['request', 'request', 'request']);
	assert.deepEqual(requests.map(({ method, path, status, name }) => [method, path, status, name]), [
		['GET', '/api/thing', 200, 'app/Api'],
		['POST', '/page', 200, 'app/Files'],
		['GET', '/nope', 404, undefined],
	]);
	assert.ok(requests.every(({ ms }) => ms >= 0));
	assert.deepEqual(heard[0]!.context, {}, 'the request\'s own context, as the gate answered it');
});

test('a commit a share refuses is heard as refused, with the topic and the reasons', async () => {
	const heard: Heard[] = [];
	const board = createObject<Record<string, unknown>>({ title: 'kept' });
	const { handlers, server } = await started({
		'app/Board': instance(() => ({
			connection: ({ link }: Connection) => {
				link.share('board', board, {
					accept: (commit) => (commit.deltas.some((d) => d.type === 'remove') ? [{ code: 'keep', message: 'nothing is removed' }] : []),
				});
			},
		})),
		'log/Observe': observing('log/Observe', heard),
	});
	const client = asClient(await connectTo(handlers));
	const copy = await client.link.share<Record<string, unknown>>('board').ready;
	await settle();
	copy.title = 'renamed';
	await settle();
	delete copy.title;
	await settle();
	client.socket.close();
	await settle();
	await server.stop();

	const refused = heard.filter(({ event }) => event.kind === 'refused').map(({ event }) => event as Extract<ServerEvent, { kind: 'refused' }>);
	assert.equal(refused.length, 1, 'the accepted commit is not an event; the refused one is');
	assert.equal(refused[0]!.topic, 'board');
	assert.deepEqual(refused[0]!.reasons, [{ code: 'keep', message: 'nothing is removed' }]);
	assert.equal(board.title, 'renamed', 'and the module\'s own rule still decided');
});

test('an accept that answers nothing accepts, and one that throws is heard as refused with accept-threw', async () => {
	const heard: Heard[] = [];
	const board = createObject<Record<string, unknown>>({ title: 'kept' });
	const { handlers, server } = await started({
		'app/Board': instance(() => ({
			connection: ({ link }: Connection) => {
				link.share('board', board, {
					// A module written in plain JS answers nothing on the happy path, as sync allows.
					accept: ((commit: Commit) => { if (commit.deltas.some((d) => d.type === 'remove')) throw new Error('nothing is removed'); }) as unknown as (commit: Commit) => readonly WireReason[],
				});
			},
		})),
		'log/Observe': observing('log/Observe', heard),
	});
	const client = asClient(await connectTo(handlers));
	const copy = await client.link.share<Record<string, unknown>>('board').ready;
	await settle();
	copy.title = 'renamed';
	await settle();
	delete copy.title;
	await settle();
	client.socket.close();
	await settle();
	await server.stop();

	assert.equal(board.title, 'renamed', 'an accept that answered nothing let the commit in');
	const refused = heard.filter(({ event }) => event.kind === 'refused').map(({ event }) => event as Extract<ServerEvent, { kind: 'refused' }>);
	assert.deepEqual(refused.map((event) => event.reasons), [[{ code: 'accept-threw', message: 'nothing is removed' }]], 'the throw is the one refusal heard');
	assert.equal(refused[0]!.topic, 'board');
});

test('a hook that throws is heard as failed under its name, with the connection\'s context', async () => {
	const heard: Heard[] = [];
	const failed: string[] = [];
	const { handlers, server } = await started({
		'app/Broken': instance(() => ({ connection: () => { throw new Error('no room'); } })),
		'log/Observe': observing('log/Observe', heard),
	}, byHeader, failed);
	const client = asClient(await connectTo(handlers, { headers: { 'x-user': 'ada' } }));
	await settle();
	client.socket.close();
	await settle();
	await server.stop();

	assert.deepEqual(failed, ['app/Broken: no room']);
	const heardFailed = heard.find(({ event }) => event.kind === 'failed')!;
	assert.equal((heardFailed.event as Extract<ServerEvent, { kind: 'failed' }>).name, 'app/Broken');
	assert.equal(((heardFailed.event as Extract<ServerEvent, { kind: 'failed' }>).error as Error).message, 'no room');
	assert.deepEqual(heardFailed.context, { user: 'ada' });
});

test('an observer that throws is reported under its own name, the next observer still hears, and nothing is emitted for it', async () => {
	const first: Heard[] = [];
	const second: Heard[] = [];
	const failed: string[] = [];
	const { handlers, server } = await started({
		'app/Sum': instance(() => ({ call: () => 1 })),
		'log/Throws': observing('log/Throws', first, () => { throw new Error('observer down'); }),
		'log/Rejects': observing('log/Rejects', second, async () => { throw new Error('later'); }),
	}, open, failed);
	const client = asClient(await connectTo(handlers));
	await settle();
	assert.equal(await client.asks.ask('app/Sum'), 1, 'the call an observer threw on is answered');
	client.socket.close();
	await settle();
	await tick();
	await server.stop();

	assert.deepEqual(kinds(first), ['connection', 'call', 'closed']);
	assert.deepEqual(kinds(second), ['connection', 'call', 'closed'], 'the observer after the throwing one heard every event');
	assert.deepEqual(failed.slice(0, 2), ['log/Throws: observer down', 'log/Rejects: later']);
	assert.equal(failed.length, 6, 'each observer is reported once per event, and no failed event follows');
});

test('a module loaded after start is an observer from then on', async () => {
	const heard: Heard[] = [];
	const { source, grow } = growing(
		{ 'app/Sum': instance(() => ({ call: () => 1 })) },
		{ 'log/Late': observing('log/Late', heard) },
	);
	const listening = fakeListener();
	const server = createServer({ sources: [source], gate: open, listener: listening.listener });
	await server.start();
	const handlers = listening.handlers();
	assert.equal((await handlers.request(request('/nope'), peer)).status, 404);
	assert.deepEqual(kinds(heard), []);
	grow();
	await server.loader.load(['log/Late']);
	assert.equal((await handlers.request(request('/nope'), peer)).status, 404);
	assert.deepEqual(kinds(heard), ['request']);
	await server.stop();
});
