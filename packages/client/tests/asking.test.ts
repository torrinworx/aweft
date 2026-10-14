// A cell over `ask` that follows its arguments (design 312), against a real server over sockets
// wired in memory.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import { mutable } from '@aweftjs/core';

import { asking, createClient } from '../src/index.ts';
import type { Asked } from '../src/index.ts';

import { dialer, instance, reasonOf, serverOf, settle } from './helpers.ts';

/** A module whose answers the test hands out, one per ask, in the order they arrived. */
const held = () => {
	const asks: { args: unknown; answer: (value: unknown) => void; fail: (error: Error) => void }[] = [];
	const module = instance(() => ({
		call: (args: unknown) => new Promise((answer, fail) => { asks.push({ args, answer, fail }); }),
	}));
	return { asks, module };
};

const started = async () => {
	const answers = held();
	const { server, handlers } = await serverOf({
		'app/Held': answers.module,
		'app/Echo': instance(() => ({ call: (args: unknown) => args })),
		'app/Refuses': instance(() => ({ call: () => { throw Object.assign(new Error('members only'), { reason: 'private' }); } })),
	});
	const client = createClient({ url: 'ws://app.test/', open: dialer(handlers).open });
	return { server, client, asks: answers.asks };
};

/** Every state a cell goes through while watched, from the one it starts in. */
const record = <T>(cell: { effect(fn: (value: T) => void): () => void }): { seen: T[]; stop: () => void } => {
	const seen: T[] = [];
	const stop = cell.effect((value) => { seen.push(value); });
	return { seen, stop };
};

test('it asks once watched, and holds the answer', async () => {
	const { server, client } = await started();
	const found = asking<{ n: number }>(client, 'app/Echo', { n: 1 });
	const { seen, stop } = record(found);
	await settle(20);
	assert.deepEqual(seen, [{ state: 'waiting', data: null }, { state: 'ready', data: { n: 1 } }]);
	assert.deepEqual(found.get(), { state: 'ready', data: { n: 1 } });
	stop();
	client.close();
	await server.stop();
});

test('a change of arguments asks again, keeping the last data while it waits', async () => {
	const { server, client, asks } = await started();
	const query = mutable('a');
	const found = asking<string>(client, 'app/Held', query.map((text) => ({ text })));
	const { seen, stop } = record(found);
	await settle(20);
	asks[0]!.answer('found a');
	await settle(20);
	query.set('b');
	await settle(20);
	assert.deepEqual(asks.map((one) => one.args), [{ text: 'a' }, { text: 'b' }]);
	assert.deepEqual(found.get(), { state: 'waiting', data: 'found a' }, 'the last answer stays while the next is out');
	asks[1]!.answer('found b');
	await settle(20);
	assert.deepEqual(seen.map((one) => `${one.state} ${String(one.data)}`), [
		'waiting null', 'ready found a', 'waiting found a', 'ready found b',
	]);
	stop();
	client.close();
	await server.stop();
});

test('an answer to an ask a newer one replaced is dropped, however late it lands', async () => {
	const { server, client, asks } = await started();
	const query = mutable('slow');
	const found = asking<string>(client, 'app/Held', query);
	const { stop } = record(found);
	await settle(20);
	query.set('fast');
	await settle(20);
	asks[1]!.answer('fast answer');
	await settle(20);
	asks[0]!.answer('slow answer');
	await settle(20);
	assert.deepEqual(found.get(), { state: 'ready', data: 'fast answer' });
	query.set('fails late');
	await settle(20);
	query.set('last');
	await settle(20);
	asks[3]!.answer('last answer');
	asks[2]!.fail(Object.assign(new Error('too late to matter'), { reason: 'late' }));
	await settle(20);
	assert.deepEqual(found.get(), { state: 'ready', data: 'last answer' }, 'a late failure is dropped as well');
	stop();
	client.close();
	await server.stop();
});

test('a refusal is failed, with no data and the error the ask rejected with', async () => {
	const { server, client } = await started();
	const found = asking(client, 'app/Refuses');
	const { stop } = record(found);
	await settle(20);
	const now = found.get();
	assert.equal(now.state, 'failed');
	assert.equal(now.data, null);
	assert.equal(reasonOf((now as Asked<unknown> & { error: unknown }).error), 'private');
	stop();
	client.close();
	await server.stop();
});

test('nothing is asked while nobody watches, and reading it then asks nothing either', async () => {
	const { server, client, asks } = await started();
	const found = asking(client, 'app/Held', { n: 1 });
	await settle(20);
	assert.deepEqual(found.get(), { state: 'waiting', data: null });
	await settle(20);
	assert.equal(asks.length, 0);
	client.close();
	await server.stop();
});

test('when the last watcher stops the answer out is dropped, and the next watcher asks again', async () => {
	const { server, client, asks } = await started();
	const found = asking<string>(client, 'app/Held', { n: 1 });
	const first = record(found);
	const second = record(found);
	await settle(20);
	assert.equal(asks.length, 1, 'two watchers share one ask');
	first.stop();
	await settle(20);
	asks[0]!.answer('still watched');
	await settle(20);
	assert.deepEqual(found.get(), { state: 'ready', data: 'still watched' }, 'one watcher left is enough');

	const query = mutable(1);
	const followed = asking<string>(client, 'app/Held', query.map((n) => ({ n })));
	const watched = record(followed);
	await settle(20);
	watched.stop();
	query.set(2);
	await settle(20);
	asks[1]!.answer('nobody is listening');
	await settle(20);
	assert.equal(asks.length, 2, 'a change of arguments nobody watches asks nothing');
	assert.deepEqual(followed.get(), { state: 'waiting', data: null }, 'and the answer out landed nowhere');

	const again = record(followed);
	await settle(20);
	assert.deepEqual(asks.map((one) => one.args), [{ n: 1 }, { n: 1 }, { n: 2 }], 'watching again asks with the arguments as they are now');
	asks[2]!.answer('two');
	await settle(20);
	assert.deepEqual(followed.get(), { state: 'ready', data: 'two' });
	again.stop();
	second.stop();
	client.close();
	await server.stop();
});

test('pending is handed the first ask, and only the first, settled either way', async () => {
	const { server, client, asks } = await started();
	const handed: Promise<unknown>[] = [];
	const query = mutable('a');
	const found = asking<string>(client, 'app/Held', query, { pending: (promise) => { handed.push(promise); } });
	const { stop } = record(found);
	await settle(20);
	query.set('b');
	await settle(20);
	assert.equal(handed.length, 1);
	asks[0]!.fail(Object.assign(new Error('a failure still settles it'), { reason: 'gone' }));
	await assert.doesNotReject(handed[0]!);
	stop();
	client.close();
	await server.stop();
});

test('a pending that throws is the caller\'s error on a fresh task, and the cell goes on following', () => {
	// An uncaught exception cannot be observed from inside the test runner, so the scenario
	// runs in a child process that reports what it saw.
	const child = spawnSync(process.execPath, [new URL('./pending-throws.ts', import.meta.url).pathname], { encoding: 'utf8' });
	assert.equal(child.status, 0, child.stderr);
	assert.deepEqual(JSON.parse(child.stdout.trim()), { threw: false, raised: ['pending blew up'], last: { state: 'ready', data: 'b' } });
});

test('the timeout reaches the ask, and a cell cannot be written', async () => {
	const { server, client } = await started();
	const found = asking(client, 'app/Held', {}, { timeout: 30 });
	const { stop } = record(found);
	await new Promise((done) => setTimeout(done, 80));
	const now = found.get();
	assert.equal(now.state, 'failed');
	assert.equal(reasonOf((now as { error: unknown }).error), 'timeout');
	assert.throws(() => { found.set({ state: 'ready', data: 1 }); }, (error: unknown) => reasonOf(error) === 'read-only');
	stop();
	client.close();
	await server.stop();
});
