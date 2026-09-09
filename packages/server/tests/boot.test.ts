// The boot: the server builds its own loader, loads what the sources list, resolves a gate
// named as a string, and unloads everything on the way out (designs 240, 241).

import test from 'node:test';
import assert from 'node:assert/strict';

import { createObject } from '@aweftjs/core';
import { follow, fromDocument } from '@aweftjs/modules';
import type { ModuleProps, ModulesError } from '@aweftjs/modules';
import type { RequestError } from '@aweftjs/sync';
import WebSocket from 'ws';

import { createServer, open } from '../src/index.ts';
import type { Connection, Gate, Named, ServerError } from '../src/index.ts';
import { node } from '../src/node.ts';

import {
	asClient, connectTo, fakeListener, instance, peer, reasonOf, request, settle, sourceOf,
} from './helpers.ts';

// --- what start loads --------------------------------------------------------------------------

test('start loads every module every source lists, in dependency order, with no list anywhere', async () => {
	const made: string[] = [];
	const library = sourceOf({
		'lib/Log': instance(() => { made.push('lib/Log'); return { log: () => {} }; }),
		'lib/Rules': instance(() => { made.push('lib/Rules'); return { allow: () => true }; }),
	});
	const app = sourceOf({
		'app/Feed': instance(() => { made.push('app/Feed'); return { call: () => 'feed' }; }, ['lib/Rules']),
		'app/Nobody': instance(() => { made.push('app/Nobody'); return { call: () => 'nobody asked for me' }; }),
	});
	const listening = fakeListener();
	const server = createServer({ sources: [app, library], gate: open, listener: listening.listener });
	assert.equal(made.length, 0, 'nothing is instantiated before start');
	assert.deepEqual(server.loader.loaded(), []);

	await server.start();
	assert.deepEqual([...server.loader.loaded()].sort(), ['app/Feed', 'app/Nobody', 'lib/Log', 'lib/Rules']);
	assert.ok(made.indexOf('lib/Rules') < made.indexOf('app/Feed'), 'a dependency was made before its dependent');

	const client = asClient(await connectTo(listening.handlers()));
	assert.equal(await client.asks.ask('app/Nobody'), 'nobody asked for me', 'a module nobody named is serving');
	client.socket.close();
	await server.stop();
});

test('a module the sources list serves a real connection through the node listener', async () => {
	const seen: string[] = [];
	const board = createObject<Record<string, unknown>>({ title: 'the board' });
	const source = sourceOf({
		'app/Board': instance(() => ({
			connection: ({ link }: Connection) => { seen.push('hook'); link.share('board', board, open); },
			call: () => 'answered',
		})),
	});
	const listener = node({ port: 0, host: '127.0.0.1' });
	const server = createServer({ sources: [source], gate: open, listener });
	await server.start();

	const socket = new WebSocket(`ws://127.0.0.1:${String(listener.port)}/`);
	await new Promise<void>((opened) => socket.once('open', () => opened()));
	await settle();
	assert.deepEqual(seen, ['hook'], 'the hook of a module nobody loaded by hand ran on a real socket');
	socket.close();
	await server.stop();
});

// --- what createServer refuses -------------------------------------------------------------------

test('loader and props are not options, and the refusal says what to write instead', () => {
	const sources = [sourceOf({})];
	const { listener } = fakeListener();
	for (const extra of [{ loader: { load: () => {} } }, { props: { store: {} } }, { loader: undefined }, { props: undefined }]) {
		assert.throws(
			() => createServer({ sources, gate: open, listener, ...extra } as never),
			(error: ServerError) => error.reason === 'not-an-option'
				&& /Pass sources, and make anything you would have passed as a prop a module that others deps on\./.test(error.message),
			JSON.stringify(Object.keys(extra)),
		);
	}
	// The key being present is what is refused, so the one below is the shape that works.
	assert.ok(createServer({ sources, gate: open, listener }));
});

test('a gate that is not a name and carries neither function is refused at createServer', () => {
	const sources = [sourceOf({})];
	const { listener } = fakeListener();
	for (const bad of [{}, 0, false, () => {}, { identify: () => ({ context: {} }) }]) {
		assert.throws(
			() => createServer({ sources, gate: bad as never, listener }),
			(error: ServerError) => error.reason === 'missing'
				&& /Pass an object with identify and access, open, or the name of a module that is one\./.test(error.message),
			JSON.stringify(String(bad)),
		);
	}
	assert.ok(createServer({ sources, gate: open, listener }), 'open is a gate');
	assert.ok(
		createServer({ sources, gate: { identify: () => ({ context: {} }), access: () => [] }, listener }),
		'and so is any object carrying the two functions',
	);
});

// --- the gate, by name ----------------------------------------------------------------------------

/** A gate module: the battery's shape, a header saying who, `public` saying what is open. */
const gateModule = instance(() => ({
	identify: (req: Request) => ({ context: { user: req.headers.get('x-user') } }),
	access: ({ name, instance: held }: Named, context: { user: string | null }) =>
		(held as { public?: boolean }).public === true || context.user !== null
			? []
			: [{ code: 'private', message: `${name} needs a user` }],
}));

test('a gate named as a module is resolved at start and decides a real call', async () => {
	const source = sourceOf({
		'app/Gate': gateModule,
		'app/Open': instance(() => ({ public: true, call: () => 'anyone' })),
		'app/Closed': instance(() => ({ call: () => 'members only' })),
	});
	const listening = fakeListener();
	const server = createServer({ sources: [source], gate: 'app/Gate', listener: listening.listener });
	await server.start();

	const anonymous = asClient(await connectTo(listening.handlers()));
	assert.equal(await anonymous.asks.ask('app/Open'), 'anyone');
	assert.equal(await anonymous.asks.ask('app/Closed').catch(reasonOf), 'refused');

	const ada = asClient(await connectTo(listening.handlers(), { headers: { 'x-user': 'ada' } }));
	assert.equal(await ada.asks.ask('app/Closed'), 'members only');
	anonymous.socket.close();
	ada.socket.close();
	await server.stop();
});

test('a gate name no source lists, and one that is not a gate, are both refused at start', async () => {
	for (const [name, why] of [['app/Nope', 'no source lists it'], ['app/Plain', 'it is not a gate']] as const) {
		const source = sourceOf({ 'app/Plain': instance(() => ({ call: () => 1 })) });
		const listening = fakeListener();
		const server = createServer({ sources: [source], gate: name, listener: listening.listener });
		await assert.rejects(
			server.start(),
			(error: ServerError) => error.reason === 'missing'
				&& error.message.includes(name)
				&& /Name a module the sources list whose instance is a gate, or pass a Gate object\./.test(error.message),
			why,
		);
		// The listener never started, so nothing was ever accepted.
		assert.throws(() => listening.handlers(), /has not started/);
		await server.stop();
	}
});

test('a Gate object is still a gate, and start touches it not at all', async () => {
	const asked: string[] = [];
	const gate: Gate<{ who: string }> = {
		identify: () => ({ context: { who: 'ada' } }),
		access: ({ name }) => { asked.push(name); return []; },
	};
	const source = sourceOf({ 'app/Thing': instance(() => ({ call: (_a: unknown, context: { who: string }) => context.who })) });
	const listening = fakeListener();
	const server = createServer({ sources: [source], gate, listener: listening.listener });
	await server.start();
	const client = asClient(await connectTo(listening.handlers()));
	assert.equal(await client.asks.ask('app/Thing'), 'ada');
	assert.deepEqual(asked, ['app/Thing']);
	client.socket.close();
	await server.stop();
});

test('a composed gate is a module that deps on another gate and adds its own reason', async () => {
	const source = sourceOf({
		'auth/Gate': gateModule,
		// The application's gate: the battery's answer first, then one rule of its own.
		'app/Gate': instance(({ imports }: ModuleProps) => {
			const under = imports.Gate as Gate<{ user: string | null }>;
			return {
				identify: (req: Request, from: unknown) => under.identify(req, from as never),
				access: async (module: Named, context: { user: string | null }) => {
					const reasons = await under.access(module, context);
					if (reasons.length > 0) return reasons;
					return (module.instance as { admin?: boolean }).admin === true && context.user !== 'ada'
						? [{ code: 'not-admin', message: `${module.name} is for the administrator` }]
						: [];
				},
			};
		}, ['auth/Gate']),
		'app/Wipe': instance(() => ({ admin: true, call: () => 'wiped' })),
		'app/Read': instance(() => ({ call: () => 'read' })),
	});
	const listening = fakeListener();
	const server = createServer({ sources: [source], gate: 'app/Gate', listener: listening.listener });
	await server.start();

	const ada = asClient(await connectTo(listening.handlers(), { headers: { 'x-user': 'ada' } }));
	const bob = asClient(await connectTo(listening.handlers(), { headers: { 'x-user': 'bob' } }));
	assert.equal(await ada.asks.ask('app/Wipe'), 'wiped', 'the administrator reaches the admin module');
	assert.equal(await bob.asks.ask('app/Read'), 'read', 'the module underneath still allows a signed-in user');
	await assert.rejects(bob.asks.ask('app/Wipe'), (error: RequestError) =>
		error.reason === 'refused'
		&& JSON.stringify(error.reasons) === '[{"code":"not-admin","message":"app/Wipe is for the administrator"}]');
	ada.socket.close();
	bob.socket.close();
	await server.stop();
});

test('a named gate is read off the loader at each use, so reloading the gate module changes the policy', async () => {
	const gateSource = (refuse: string): string => `
		export const deps = ['app/Trace'];
		export default ({ imports }) => ({
			identify: () => ({ context: {} }),
			access: () => ${refuse},
			stop: () => { imports.Trace.seen.push('the first gate stopped'); },
		});`;
	const document = createObject<Record<string, unknown>>({
		'app/Trace': createObject<Record<string, unknown>>({ source: 'export default () => ({ seen: [] });' }),
		'app/Gate': createObject<Record<string, unknown>>({ source: gateSource('[]') }),
		'app/Export': createObject<Record<string, unknown>>({
			source: `export default () => ({ routes: { 'GET /export': () => new Response('the export') } });`,
		}),
	});
	const listening = fakeListener();
	const server = createServer({ sources: [fromDocument(document)], gate: 'app/Gate', listener: listening.listener });
	await server.start();
	assert.equal(await (await listening.handlers().request(request('/export'), peer)).text(), 'the export');

	let caughtUp: () => void = () => {};
	const reloaded = new Promise<void>((done) => { caughtUp = done; });
	const stop = follow(server.loader, document, { applied: () => caughtUp() });
	(document['app/Gate'] as { source: string }).source = gateSource(`[{ code: 'shut', message: 'the gate was reloaded' }]`);
	await reloaded;

	assert.deepEqual(
		(server.loader.get('app/Trace') as { seen: string[] }).seen, ['the first gate stopped'],
		'the instance that was the policy has been stopped, so nothing may still be asking it',
	);
	const after = await listening.handlers().request(request('/export'), peer);
	assert.equal(after.status, 403, 'the reloaded gate is the one that decided');
	assert.deepEqual(await after.json(), { reasons: [{ code: 'shut', message: 'the gate was reloaded' }] });
	stop();
	await server.stop();
});

test('in the window where the gate module is not loaded, the request is 500 and reported as gate', async () => {
	const failed: [string, unknown][] = [];
	let letThrough: () => void = () => {};
	const source = sourceOf({
		// An `identify` that awaits is where the window is: a reload can land between it and the
		// `access` check on the same request.
		'app/Gate': instance(() => ({
			identify: async () => { await new Promise<void>((go) => { letThrough = go; }); return { context: {} }; },
			access: () => [],
		})),
		'app/Export': instance(() => ({ routes: { 'GET /export': () => new Response('the export') } })),
	});
	const listening = fakeListener();
	const server = createServer({
		sources: [source], gate: 'app/Gate', listener: listening.listener,
		handlers: { failed: (name, error) => { failed.push([name, error]); } },
	});
	await server.start();

	const answering = listening.handlers().request(request('/export'), peer);
	await settle();
	await server.loader.unload('app/Gate');
	letThrough();

	assert.equal((await answering).status, 500, 'no policy, no answer');
	assert.deepEqual(failed.map(([name]) => name), ['gate']);
	assert.equal((failed[0]![1] as ServerError).reason, 'missing');
	await server.stop();
});

// --- the props rule ---------------------------------------------------------------------------------

test('store reaches every factory as store, and no factory is handed one when none was given', async () => {
	const held: unknown[] = [];
	const keys: string[][] = [];
	const source = sourceOf({
		'app/Thing': instance((props: ModuleProps) => {
			held.push(props.store);
			keys.push(Object.keys(props).sort());
			return { call: () => 1 };
		}),
	});
	const store = { open: () => {} };

	const withStore = createServer({ sources: [source], store, gate: open, listener: fakeListener().listener });
	await withStore.start();
	assert.equal(held[0], store, 'the store handed to createServer is the store the factory read');
	assert.deepEqual(keys[0], ['config', 'extensions', 'imports', 'store']);
	await withStore.stop();

	const without = createServer({ sources: [source], gate: open, listener: fakeListener().listener });
	await without.start();
	assert.equal(held[1], undefined);
	assert.deepEqual(keys[1], ['config', 'extensions', 'imports'], 'no store key at all, rather than one holding undefined');
	await without.stop();

	const nothing = createServer({ sources: [source], store: undefined, gate: open, listener: fakeListener().listener });
	await nothing.start();
	assert.deepEqual(keys[2], ['config', 'extensions', 'imports'], 'store: undefined is the same as no store');
	await nothing.stop();
});

// --- stopping ------------------------------------------------------------------------------------------

test('stop unloads every module in reverse load order, so each stop runs after its dependents', async () => {
	const trace: string[] = [];
	const source = sourceOf({
		'lib/Held': instance(() => ({ stop: () => { trace.push('lib/Held'); } })),
		'app/Uses': instance(() => ({ stop: async () => { trace.push('app/Uses'); } }), ['lib/Held']),
		'app/Top': instance(() => ({ stop: () => { trace.push('app/Top'); } }), ['app/Uses']),
	});
	// The listener writes into the same trace, so the order is what is asserted rather than a
	// count that would still pass with the listener stopped last.
	const listening = fakeListener(trace);
	const server = createServer({ sources: [source], gate: open, listener: listening.listener });
	await server.start();
	assert.equal(trace.length, 0, 'a stop runs on the way out, not on the way in');

	await server.stop();
	assert.deepEqual(trace, ['listener', 'app/Top', 'app/Uses', 'lib/Held'],
		'the listener stopped before anything was unloaded');
	assert.deepEqual(server.loader.loaded(), [], 'and nothing is left loaded');

	// Started again, it loads everything afresh from the sources.
	await server.start();
	assert.equal(server.loader.loaded().length, 3);
	await server.stop();
	assert.deepEqual(trace, [
		'listener', 'app/Top', 'app/Uses', 'lib/Held', 'listener', 'app/Top', 'app/Uses', 'lib/Held',
	]);
});

test('one module\'s stop throwing still unloads the rest, and the throw is reported', async () => {
	const trace: string[] = [];
	const failed: [string, unknown][] = [];
	const boom = new Error('the socket would not close');
	const source = sourceOf({
		'lib/Held': instance(() => ({ stop: () => { trace.push('lib/Held'); } })),
		'app/Uses': instance(() => ({ stop: () => { throw boom; } }), ['lib/Held']),
		'app/Top': instance(() => ({ stop: () => { trace.push('app/Top'); } }), ['app/Uses']),
	});
	const listening = fakeListener();
	const server = createServer({
		sources: [source], gate: open, listener: listening.listener,
		handlers: { failed: (name, error) => { failed.push([name, error]); } },
	});
	await server.start();

	await server.stop();
	assert.deepEqual(trace, ['app/Top', 'lib/Held'], 'the module underneath the throw still let go');
	assert.deepEqual(server.loader.loaded(), [], 'and nothing is left loaded');
	assert.deepEqual(failed, [['app/Uses', boom]], 'the throw reached handlers.failed, named');

	// `started` came down anyway, so the server can be started again.
	await server.start();
	assert.equal(server.loader.loaded().length, 3);
	await server.stop();
});

test('two starts at once boot one server, and the second is refused as started', async () => {
	const made: string[] = [];
	const source = sourceOf({ 'app/Thing': instance(() => { made.push('app/Thing'); return { call: () => 1 }; }) });
	const listening = fakeListener();
	const server = createServer({ sources: [source], gate: open, listener: listening.listener });

	const [first, second] = await Promise.allSettled([server.start(), server.start()]);
	assert.equal(first.status, 'fulfilled');
	assert.equal(second.status, 'rejected');
	assert.equal((second as PromiseRejectedResult).reason.reason, 'started');
	assert.equal(listening.started(), 1, 'the listener started once');
	assert.deepEqual(made, ['app/Thing']);
	await server.stop();
});

test('a factory that throws leaves the server not started, and stop still lets go of what was made', async () => {
	const trace: string[] = [];
	let broken = true;
	const source = sourceOf({
		'lib/Fine': instance(() => ({ stop: () => { trace.push('lib/Fine stopped'); } })),
		'app/Broken': instance(() => {
			if (broken) throw new Error('the database refused');
			return { call: () => 'working now' };
		}, ['lib/Fine']),
	});
	const listening = fakeListener();
	const server = createServer({ sources: [source], gate: open, listener: listening.listener });

	await assert.rejects(server.start(), (error: ModulesError & { cause?: unknown }) =>
		error.reason === 'failed' && error.module === 'app/Broken'
		&& (error.cause as Error).message === 'the database refused',
		'the loader\'s own error reaches the caller, naming the module');
	assert.throws(() => listening.handlers(), /has not started/, 'the listener never started');
	assert.deepEqual(server.loader.loaded(), ['lib/Fine'], 'what was made before the failure stays loaded');

	// Not started, so starting again is what a caller does once the cause is fixed, and it is
	// not refused as `started`.
	broken = false;
	await server.start();
	const client = asClient(await connectTo(listening.handlers()));
	assert.equal(await client.asks.ask('app/Broken'), 'working now');
	client.socket.close();

	await server.stop();
	assert.deepEqual(trace, ['lib/Fine stopped']);
});

// --- the loader is readable -----------------------------------------------------------------------------

test('server.loader is the loader, and follow over it reloads a module edited after start', async () => {
	const say = (word: string): string => `export default () => ({ call: () => '${word}' });`;
	const document = createObject<Record<string, unknown>>({
		'app/Say': createObject<Record<string, unknown>>({ source: say('hello') }),
	});
	const listening = fakeListener();
	const server = createServer({ sources: [fromDocument(document)], gate: open, listener: listening.listener });
	await server.start();
	const client = asClient(await connectTo(listening.handlers()));
	assert.equal(await client.asks.ask('app/Say'), 'hello');

	let caughtUp: () => void = () => {};
	const reloaded = new Promise<void>((done) => { caughtUp = done; });
	const stop = follow(server.loader, document, { applied: () => caughtUp() });
	(document['app/Say'] as { source: string }).source = say('hello again');
	await reloaded;

	assert.equal(await client.asks.ask('app/Say'), 'hello again', 'the connection is answered by the new instance');
	stop();
	client.socket.close();
	await server.stop();
});

// --- the route table still comes off the loader the server owns ---------------------------------------------

test('a route on a module the sources list is served with nothing else asked for', async () => {
	const source = sourceOf({
		'app/Export': instance(() => ({ routes: { 'GET /export': () => new Response('the export') } })),
	});
	const listening = fakeListener();
	const server = createServer({ sources: [source], gate: open, listener: listening.listener });
	await server.start();
	assert.equal(await (await listening.handlers().request(request('/export'), peer)).text(), 'the export');
	await server.stop();
});
