// A connection: one socket, the link and the requests on it, the hooks around it, and how it
// ends (designs 072, 073).

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { createObject } from '@aweftjs/core';
import type { RequestError } from '@aweftjs/sync';

import { createServer, open } from '../src/index.ts';
import type { Connection, ServerError } from '../src/index.ts';

import { asClient, connectTo, fakeListener, instance, loaderOf, settle, tick } from './helpers.ts';

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

test('a hook shares a document on the link, and a share without accept is refused before anything crosses', async () => {
	const board = createObject<Record<string, unknown>>({ title: 'kept' });
	const errors: ServerError[] = [];
	const { handlers, server } = await started({
		'app/Board': instance(() => ({
			connection: ({ link }: Connection) => {
				try {
					(link.share as (...a: unknown[]) => unknown)('unguarded', board, {});
				} catch (error) {
					errors.push(error as ServerError);
				}
				link.share('board', board, {
					accept: (commit) => (commit.deltas.some((d) => d.type === 'remove') ? [{ code: 'keep', message: 'nothing is removed' }] : []),
				});
			},
		})),
	});
	const client = asClient(await connectTo(handlers));
	const copy = await client.link.share<Record<string, unknown>>('board').ready;
	await settle();
	assert.equal(copy.title, 'kept');
	assert.equal(errors.length, 1);
	assert.equal(errors[0]!.reason, 'no-accept');
	assert.match(errors[0]!.message, /unguarded/);

	copy.title = 'renamed by the client';
	await settle();
	assert.equal(board.title, 'renamed by the client', 'an accepted commit lands');
	delete copy.title;
	await settle();
	assert.equal(board.title, 'renamed by the client', 'a refused one does not');

	client.socket.close();
	await server.stop();
});

test('a call is routed to the named module after the gate, with progress streaming back', async () => {
	const { handlers, server } = await started({
		'app/Report': instance(() => ({
			call: async (args: unknown, _context: unknown, { progress }: { progress(v: unknown): void }) => {
				progress('reading');
				await tick();
				progress({ done: 2, of: 3 });
				return { report: `for ${String((args as { day: string }).day)}` };
			},
		})),
		'app/NoCall': instance(() => ({ routes: {} })),
	});
	const client = asClient(await connectTo(handlers));
	const heard: unknown[] = [];
	assert.deepEqual(await client.asks.ask('app/Report', { day: 'mon' }, { progress: (v) => heard.push(v) }), { report: 'for mon' });
	assert.deepEqual(heard, ['reading', { done: 2, of: 3 }]);
	await assert.rejects(client.asks.ask('app/NoCall'), (e: RequestError) => e.reason === 'missing');
	await assert.rejects(client.asks.ask('app/Nope'), (e: RequestError) => e.reason === 'missing');
	client.socket.close();
	await server.stop();
});

test('a call that throws answers its caller with failed and is not reported', async () => {
	const failed: string[] = [];
	const { handlers, server } = await started({
		'app/Grumpy': instance(() => ({ call: () => { throw Object.assign(new Error('not now'), { reason: 'busy' }); } })),
	}, failed);
	const client = asClient(await connectTo(handlers));
	await assert.rejects(client.asks.ask('app/Grumpy'), (e: RequestError) => e.reason === 'busy' && e.message === 'not now');
	assert.deepEqual(failed, []);
	client.socket.close();
	await server.stop();
});

test('end functions run when the connection ends, in reverse order, and one that throws does not stop the rest', async () => {
	const trace: string[] = [];
	const failed: string[] = [];
	const { handlers, server } = await started({
		'app/A': instance(() => ({ connection: () => { trace.push('A up'); return () => { trace.push('A down'); }; } })),
		'app/B': instance(() => ({ connection: () => { trace.push('B up'); return () => { trace.push('B down'); throw new Error('B broke'); }; } }), ['app/A']),
		'app/C': instance(() => ({ connection: () => { trace.push('C up'); return async () => { trace.push('C down'); }; } }), ['app/B']),
		'app/D': instance(() => ({ connection: () => { trace.push('D up'); } }), ['app/C']),
	}, failed);
	const client = asClient(await connectTo(handlers));
	await settle();
	assert.deepEqual(trace, ['A up', 'B up', 'C up', 'D up']);
	client.socket.close();
	await settle();
	assert.deepEqual(trace, ['A up', 'B up', 'C up', 'D up', 'C down', 'B down', 'A down']);
	assert.deepEqual(failed, ['app/B: B broke']);
	await server.stop();
});

test('close from inside a hook ends the connection, and hooks after it do not run', async () => {
	const trace: string[] = [];
	const { handlers, server } = await started({
		'app/Bouncer': instance(() => ({ connection: ({ close }: Connection) => { trace.push('bouncer'); close(); return () => { trace.push('bouncer down'); }; } })),
		'app/After': instance(() => ({ connection: () => { trace.push('after'); } }), ['app/Bouncer']),
	});
	const client = asClient(await connectTo(handlers));
	await settle();
	assert.equal(client.socket.readyState, 3);
	assert.deepEqual(trace, ['bouncer', 'bouncer down'], 'an end function returned into a closed connection runs at once');
	await server.stop();
});

test('a hook that throws closes the connection and is reported against its module', async () => {
	const failed: string[] = [];
	const trace: string[] = [];
	const { handlers, server } = await started({
		'app/Fine': instance(() => ({ connection: () => { trace.push('fine'); return () => { trace.push('fine down'); }; } })),
		'app/Broken': instance(() => ({ connection: async () => { throw new Error('cannot set up'); } }), ['app/Fine']),
		'app/Never': instance(() => ({ connection: () => { trace.push('never'); } }), ['app/Broken']),
	}, failed);
	const client = asClient(await connectTo(handlers));
	await settle();
	assert.equal(client.socket.readyState, 3);
	assert.deepEqual(failed, ['app/Broken: cannot set up']);
	assert.deepEqual(trace, ['fine', 'fine down']);
	await server.stop();
});

test('without a failed handler the error is raised where nothing catches it, and the process says so', () => {
	const helpers = new URL('./helpers.ts', import.meta.url).href;
	const script = `
		import { createServer, open } from '@aweftjs/server';
		import { asClient, connectTo, fakeListener, instance, loaderOf } from '${helpers}';
		const loader = loaderOf({ 'app/Broken': instance(() => ({ connection: () => { throw new Error('loud and uncaught'); } })) });
		await loader.load(['app/Broken']);
		const listening = fakeListener();
		const server = createServer({ loader, gate: open, listener: listening.listener });
		await server.start();
		asClient(await connectTo(listening.handlers()));
		setTimeout(() => console.log('still alive'), 300);
	`;
	const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
		cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', timeout: 20_000,
	});
	assert.notEqual(run.status, 0, `the process should have died: ${run.stdout} ${run.stderr}`);
	assert.match(run.stderr, /loud and uncaught/);
	assert.doesNotMatch(run.stdout, /still alive/);
});

test('stop ends every live connection and then the listener', async () => {
	const trace: string[] = [];
	const { handlers, server } = await started({
		'app/A': instance(() => ({ connection: () => () => { trace.push('down'); } })),
	});
	const one = asClient(await connectTo(handlers));
	const two = asClient(await connectTo(handlers));
	await settle();
	await server.stop();
	assert.equal(one.socket.readyState, 3);
	assert.equal(two.socket.readyState, 3);
	assert.deepEqual(trace, ['down', 'down']);
});

test('a connection that ends while hooks are still running skips the rest', async () => {
	const trace: string[] = [];
	let release: () => void = () => {};
	const { handlers, server } = await started({
		'app/Slow': instance(() => ({ connection: async () => { trace.push('slow'); await new Promise<void>((done) => { release = done; }); return () => { trace.push('slow down'); }; } })),
		'app/Next': instance(() => ({ connection: () => { trace.push('next'); } }), ['app/Slow']),
	});
	const client = asClient(await connectTo(handlers));
	await settle();
	assert.deepEqual(trace, ['slow']);
	client.socket.close();
	await settle();
	release();
	await settle();
	assert.deepEqual(trace, ['slow', 'slow down'], 'the end function ran at once, and the next hook never did');
	await server.stop();
});

test('a module that is not an object, or has no hooks, is never asked about', async () => {
	const asked: string[] = [];
	const loader = loaderOf({
		'app/Number': instance(() => 42),
		'app/Plain': instance(() => ({ helper: () => 1 })),
		'app/Hooked': instance(() => ({ connection: () => {} })),
	});
	await loader.load(['app/Number', 'app/Plain', 'app/Hooked']);
	const listening = fakeListener();
	const server = createServer({
		loader, listener: listening.listener,
		gate: { identify: () => ({ context: {} }), access: ({ name }) => { asked.push(name); return []; } },
	});
	await server.start();
	const client = asClient(await connectTo(listening.handlers()));
	await settle();
	assert.deepEqual(asked, ['app/Hooked']);
	client.socket.close();
	await server.stop();
});

test('a call arriving before the hooks have finished is answered after them', async () => {
	const trace: string[] = [];
	let release: () => void = () => {};
	const { handlers, server } = await started({
		'app/Slow': instance(() => {
			let ready = false;
			return {
				connection: async () => { trace.push('hook start'); await new Promise<void>((done) => { release = done; }); ready = true; trace.push('hook end'); },
				call: () => { trace.push(`call, ready=${String(ready)}`); return ready; },
			};
		}),
	});
	const client = asClient(await connectTo(handlers));
	const answer = client.asks.ask('app/Slow');
	await settle();
	assert.deepEqual(trace, ['hook start'], 'the call waits');
	release();
	assert.equal(await answer, true);
	assert.deepEqual(trace, ['hook start', 'hook end', 'call, ready=true']);
	client.socket.close();
	await server.stop();
});

test('bytes that are not a frame from the client end the connection: end functions run and the socket closes', async () => {
	const trace: string[] = [];
	const { handlers, server } = await started({
		'app/A': instance(() => ({ connection: () => () => { trace.push('down'); }, call: () => 'ok' })),
	});
	const client = asClient(await connectTo(handlers));
	await settle();
	assert.equal(await client.asks.ask('app/A'), 'ok');
	client.socket.send(new Uint8Array([0xff, 0xff, 0xff]));
	await settle();
	assert.deepEqual(trace, ['down']);
	assert.equal(client.socket.readyState, 3, 'the client saw its socket close');
	await assert.rejects(client.asks.ask('app/A'), (e: { reason: string }) => e.reason === 'closed', 'and is told, rather than waiting forever');
	await server.stop();
});
