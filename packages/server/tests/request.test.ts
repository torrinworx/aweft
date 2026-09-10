// A module answering what no route matched: the walk in load order, the gate in front, and
// what a decline, a refusal and a defect answer (design 248).

import test from 'node:test';
import assert from 'node:assert/strict';

import { createServer, open } from '../src/index.ts';
import type { Gate } from '../src/index.ts';

import { fakeListener, instance, peer, request, sourceOf } from './helpers.ts';

type Ctx = { user: string | null };

/** A header says who; nothing is refused. */
const byHeader: Gate<Ctx> = {
	identify: (req) => ({ context: { user: req.headers.get('x-user') } }),
	access: () => [],
};

/** The same, refusing every module that does not say it is public to a caller with no user. */
const byHeaderPrivate: Gate<Ctx> = {
	identify: byHeader.identify,
	access: ({ name, instance: held }, context) =>
		(held as { public?: boolean }).public === true || context.user !== null
			? []
			: [{ code: 'private', message: `${name} needs a user` }],
};

const started = async (
	map: Parameters<typeof sourceOf>[0], gate: Gate | string = open, failed: string[] = [],
) => {
	const listening = fakeListener();
	const server = createServer({
		sources: [sourceOf(map)], gate, listener: listening.listener,
		handlers: { failed: (name, error) => failed.push(`${name}: ${(error as Error).message}`) },
	});
	await server.start();
	return { server, handlers: listening.handlers() };
};

/** One module with a route and a hook, so a test can watch which of the two answered. */
const files = (seen: string[]) => ({
	'app/Files': instance(() => ({
		routes: { 'GET /health': () => new Response('ok') },
		request: (req: Request, context: Ctx) => {
			const path = new URL(req.url).pathname;
			seen.push(`${req.method} ${path} for ${String(context.user)}`);
			return new Response(`file ${path}`);
		},
	})),
});

test('a request no route matched reaches the hook, with what the gate identified', async () => {
	const seen: string[] = [];
	const { handlers, server } = await started(files(seen), byHeader);
	const answer = await handlers.request(request('/deep/a.txt?v=2', { headers: { 'x-user': 'ada' } }), peer);
	assert.equal(answer.status, 200);
	assert.equal(await answer.text(), 'file /deep/a.txt');
	assert.deepEqual(seen, ['GET /deep/a.txt for ada'], 'the hook was handed the request and the gate\'s context');
	await server.stop();
});

test('a matched route answers it, and the hook is never asked', async () => {
	const seen: string[] = [];
	const { handlers, server } = await started(files(seen), byHeader);
	assert.equal(await (await handlers.request(request('/health'), peer)).text(), 'ok');
	assert.deepEqual(seen, [], 'the route table answered, so nothing fell through');
	await server.stop();
});

test('the modules are walked in load order, and the first Response is the answer', async () => {
	const asked: string[] = [];
	const { handlers, server } = await started({
		'app/First': instance(() => ({
			request: (req: Request) => {
				asked.push('First');
				return new URL(req.url).pathname === '/first' ? new Response('first') : undefined;
			},
		})),
		// Depends on First, so load order (dependency order) asks First first.
		'app/Second': instance(() => ({
			request: () => { asked.push('Second'); return new Response('second'); },
		}), ['app/First']),
	});

	assert.equal(await (await handlers.request(request('/other'), peer)).text(), 'second');
	assert.deepEqual(asked, ['First', 'Second'], 'undefined declined and the walk went on');

	asked.length = 0;
	assert.equal(await (await handlers.request(request('/first'), peer)).text(), 'first');
	assert.deepEqual(asked, ['First'], 'an answer ends the walk');
	await server.stop();
});

test('a module the gate refuses is skipped, and a later one still answers', async () => {
	const asked: string[] = [];
	const { handlers, server } = await started({
		'app/Private': instance(() => ({ request: () => { asked.push('Private'); return new Response('the secret'); } })),
		'app/Public': instance(() => ({
			public: true,
			request: () => { asked.push('Public'); return new Response('for everyone'); },
		}), ['app/Private']),
	}, byHeaderPrivate);

	const anonymous = await handlers.request(request('/x'), peer);
	assert.equal(anonymous.status, 200);
	assert.equal(await anonymous.text(), 'for everyone');
	assert.deepEqual(asked, ['Public'], 'the refused module was never asked');

	asked.length = 0;
	const ada = await handlers.request(request('/x', { headers: { 'x-user': 'ada' } }), peer);
	assert.equal(await ada.text(), 'the secret', 'allowed, the module loaded first answers');
	assert.deepEqual(asked, ['Private']);
	await server.stop();
});

test('a refused module and no answer is 403 with the first refusal\'s reasons', async () => {
	const { handlers, server } = await started({
		'app/Private': instance(() => ({ request: () => new Response('the secret') })),
		'app/Other': instance(() => ({ request: () => new Response('more') }), ['app/Private']),
	}, byHeaderPrivate);

	const refused = await handlers.request(request('/x'), peer);
	assert.equal(refused.status, 403);
	assert.deepEqual(await refused.json(), { reasons: [{ code: 'private', message: 'app/Private needs a user' }] },
		'the first refusal, in load order, is the one reported');
	assert.equal(refused.headers.get('content-type'), 'application/json');
	await server.stop();
});

test('no module declaring the hook leaves a miss 404, as it was', async () => {
	const { handlers, server } = await started({
		'app/Routes': instance(() => ({ routes: { 'GET /health': () => new Response('ok') } })),
		'app/NotAHook': instance(() => ({ request: 'not a function' })),
		'app/Plain': instance(() => 42),
	});
	const answer = await handlers.request(request('/nothing'), peer);
	assert.equal(answer.status, 404);
	assert.equal(await answer.text(), '');
	await server.stop();
});

test('a hook that throws is 500 and reported under its module\'s name', async () => {
	const failed: string[] = [];
	const asked: string[] = [];
	const { handlers, server } = await started({
		'app/Broken': instance(() => ({ request: () => { throw new Error('the disk is gone'); } })),
		'app/Later': instance(() => ({ request: () => { asked.push('Later'); return new Response('later'); } }), ['app/Broken']),
	}, open, failed);

	assert.equal((await handlers.request(request('/x'), peer)).status, 500);
	assert.deepEqual(failed, ['app/Broken: the disk is gone']);
	assert.deepEqual(asked, [], 'a defect ends the walk rather than falling through to the next module');
	await server.stop();
});

test('a hook that answers something that is not a Response is 500 and reported as not-a-response', async () => {
	const failed: string[] = [];
	const { handlers, server } = await started({
		'app/Odd': instance(() => ({
			request: (req: Request) => (new URL(req.url).pathname === '/text' ? 'just text' : null) as unknown as Response,
		})),
	}, open, failed);

	assert.equal((await handlers.request(request('/text'), peer)).status, 500);
	assert.equal((await handlers.request(request('/null'), peer)).status, 500, 'null is an answer, not a decline');
	assert.equal(failed.length, 2);
	assert.match(failed[0]!, /^app\/Odd: not-a-response: app\/Odd answered GET \/text with something that is not a Response/);
	assert.match(failed[1]!, /app\/Odd answered GET \/null with something that is not a Response/);
	await server.stop();
});

test('the hook is asked for HEAD and for any other method', async () => {
	const seen: string[] = [];
	const { handlers, server } = await started({
		'app/Any': instance(() => ({
			routes: { 'GET /health': () => new Response('ok') },
			request: (req: Request) => { seen.push(req.method); return new Response(null, { status: 204 }); },
		})),
	});
	for (const method of ['HEAD', 'GET', 'PUT', 'DELETE', 'PROPFIND']) {
		assert.equal((await handlers.request(request('/anything', { method }), peer)).status, 204, method);
	}
	assert.deepEqual(seen, ['HEAD', 'GET', 'PUT', 'DELETE', 'PROPFIND']);
	await server.stop();
});
