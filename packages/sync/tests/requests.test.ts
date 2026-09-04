// Requests beside the link: text on the socket, both ways, through the public surface.

import test from 'node:test';
import assert from 'node:assert/strict';

import { connect, encodeFrame, fromWebSocket, requests } from '@aweftjs/sync';
import type { RequestError, SocketLike } from '@aweftjs/sync';
import { createObject } from '@aweftjs/core';

const tick = (): Promise<void> => new Promise((done) => setTimeout(done, 0));
const settle = async (rounds = 8): Promise<void> => { for (let i = 0; i < rounds; i++) await tick(); };
const reasonOf = (error: unknown): string => String((error as RequestError).reason);

/** A socket shaped like a WebSocket, wired to a peer: what one sends, the other hears on a microtask. */
interface Fake extends SocketLike {
	peer: Fake | undefined;
	readonly sent: (Uint8Array | string)[];
	fire(type: string, event: { data?: unknown }): void;
}

const fake = (readyState = 1): Fake => {
	const listeners: Record<string, ((event: { data?: unknown }) => void)[]> = {};
	const it: Fake = {
		binaryType: 'blob',
		readyState,
		peer: undefined,
		sent: [],
		send: (data) => {
			it.sent.push(data);
			const peer = it.peer;
			if (peer !== undefined) queueMicrotask(() => peer.fire('message', { data }));
		},
		close: () => {
			if (it.readyState === 3) return;
			it.readyState = 3;
			it.fire('close', {});
			const peer = it.peer;
			if (peer !== undefined) queueMicrotask(() => peer.close());
		},
		addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn); },
		fire: (type, event) => { for (const fn of listeners[type] ?? []) fn(event); },
	};
	return it;
};

const pair = (): [Fake, Fake] => {
	const a = fake();
	const b = fake();
	a.peer = b;
	b.peer = a;
	return [a, b];
};

test('an ask crosses as text, is answered, and the answer comes back as data', async () => {
	const [here, there] = pair();
	const asks = requests(here);
	const answers = requests(there);
	const seen: unknown[] = [];
	answers.answer((name, args) => { seen.push([name, args]); return { sum: (args as number[]).reduce((a, b) => a + b, 0) }; });

	assert.deepEqual(await asks.ask('math/Sum', [1, 2, 3]), { sum: 6 });
	assert.deepEqual(seen, [['math/Sum', [1, 2, 3]]]);
	assert.equal(typeof here.sent[0], 'string', 'a request is a text message');
	assert.deepEqual(JSON.parse(here.sent[0] as string), { id: 1, name: 'math/Sum', args: [1, 2, 3] });
	assert.deepEqual(JSON.parse(there.sent[0] as string), { id: 1, result: { sum: 6 } });
});

test('undefined crosses as null, in the arguments and in the result', async () => {
	const [here, there] = pair();
	const asks = requests(here);
	let got: unknown = 'not yet';
	requests(there).answer((_name, args) => { got = args; return undefined; });
	assert.equal(await asks.ask('x'), null);
	assert.equal(got, null);
});

test('progress reports arrive before the result, in order, and stop with it', async () => {
	const [here, there] = pair();
	const asks = requests(here);
	let late: ((value: unknown) => void) | undefined;
	requests(there).answer(async (_name, _args, progress) => {
		progress(1);
		progress({ step: 2 });
		await tick();
		progress(3);
		late = progress;
		return 'done';
	});
	const heard: unknown[] = [];
	const result = await asks.ask('slow', null, { progress: (value) => heard.push(value) });
	assert.equal(result, 'done');
	assert.deepEqual(heard, [1, { step: 2 }, 3]);
	late!('too late');
	await settle();
	assert.deepEqual(heard, [1, { step: 2 }, 3], 'a report after the answer is dropped');
	// Dropped at the answering end, not just ignored at the asking end: nothing crosses the
	// wire after the result.
	const frames = there.sent.map((m) => JSON.parse(m as string) as Record<string, unknown>);
	const answered = frames.findIndex((f) => 'result' in f);
	assert.ok(answered >= 0);
	assert.equal(frames.slice(answered + 1).length, 0, `nothing follows the result, got ${JSON.stringify(frames.slice(answered + 1))}`);
});

test('an answerer that throws answers with its reason, message and reasons', async () => {
	const [here, there] = pair();
	const asks = requests(here);
	requests(there).answer((name) => {
		if (name === 'plain') throw new Error('it broke');
		if (name === 'refused') throw Object.assign(new Error('not you'), { reason: 'refused', reasons: [{ code: 'private', message: 'needs a user' }, 'not a reason'] });
		throw 'a string';
	});
	await assert.rejects(asks.ask('plain'), (e: RequestError) => e.reason === 'failed' && e.message === 'it broke' && e.reasons === undefined);
	await assert.rejects(asks.ask('refused'), (e: RequestError) =>
		e.reason === 'refused' && e.message === 'not you' && JSON.stringify(e.reasons) === '[{"code":"private","message":"needs a user"}]');
	await assert.rejects(asks.ask('string'), (e: RequestError) => e.reason === 'failed' && e.message === 'a string');
});

test('a request nothing answers is missing, and answering is one at a time', async () => {
	const [here, there] = pair();
	const asks = requests(here);
	const answers = requests(there);
	await assert.rejects(asks.ask('anything'), (e: RequestError) => e.reason === 'missing');

	const stop = answers.answer(() => 'first');
	assert.throws(() => answers.answer(() => 'second'), (e: RequestError) => e.reason === 'answering');
	assert.equal(await asks.ask('x'), 'first');
	stop();
	await assert.rejects(asks.ask('x'), (e: RequestError) => e.reason === 'missing');
	answers.answer(() => 'third');
	assert.equal(await asks.ask('x'), 'third');
});

test('a timeout rejects, and a late answer is dropped rather than resolving a dead ask', async () => {
	const [here, there] = pair();
	const asks = requests(here);
	let release: () => void = () => {};
	let calls = 0;
	requests(there).answer(() => {
		calls += 1;
		return calls === 1 ? new Promise((done) => { release = () => done('late'); }) : 'prompt';
	});
	const started = Date.now();
	await assert.rejects(asks.ask('slow', null, { timeout: 30 }), (e: RequestError) => e.reason === 'timeout');
	assert.ok(Date.now() - started >= 25);
	release();
	await settle();
	assert.equal(await asks.ask('slow', null, { timeout: 1000 }).then((v) => v, reasonOf), 'prompt', 'the next ask is unaffected');
});

test('the socket closing rejects every ask still waiting with closed, and later asks at once', async () => {
	const [here, there] = pair();
	const asks = requests(here);
	requests(there).answer(() => new Promise(() => {}));
	const waiting = asks.ask('never');
	await tick();
	here.close();
	await assert.rejects(waiting, (e: RequestError) => e.reason === 'closed');
	await assert.rejects(asks.ask('after'), (e: RequestError) => e.reason === 'closed');
});

test('stop rejects what waits, stops answering, and leaves the socket open', async () => {
	const [here, there] = pair();
	const asks = requests(here);
	const answers = requests(there);
	answers.answer(() => 'ok');
	const waiting = asks.ask('x', null, { timeout: 5000 });
	asks.stop();
	await assert.rejects(waiting, (e: RequestError) => e.reason === 'closed');
	assert.equal(here.readyState, 1, 'the socket is not this channel\'s to close');

	const [left, right] = pair();
	const stopped = requests(right);
	stopped.answer(() => 'ok');
	stopped.stop();
	await assert.rejects(requests(left).ask('x', null, { timeout: 100 }), (e: RequestError) => e.reason === 'timeout', 'the stopped end answers nothing');
});

test('an ask made while the socket is connecting is held and sent once it opens', async () => {
	const here = fake(0);
	const there = fake();
	here.peer = there;
	there.peer = here;
	const asks = requests(here);
	requests(there).answer(() => 'opened');
	const waiting = asks.ask('early');
	await tick();
	assert.equal(here.sent.length, 0, 'nothing goes down a socket that is not open');
	here.readyState = 1;
	here.fire('open', {});
	assert.equal(await waiting, 'opened');
});

test('a socket that is closing takes no ask', async () => {
	const here = fake(2);
	await assert.rejects(requests(here).ask('x'), (e: RequestError) => e.reason === 'closed');
	assert.equal(here.sent.length, 0);
});

test('binary messages are ignored here, and text messages are ignored by the link', async () => {
	const [here, there] = pair();
	const asks = requests(here);
	requests(there).answer(() => 'text only');
	const linkHere = connect(fromWebSocket(here));
	const linkThere = connect(fromWebSocket(there));
	const doc = createObject<Record<string, unknown>>({ n: 1 });
	linkHere.share('doc', doc);
	const copy = await linkThere.share<Record<string, unknown>>('doc').ready;
	await settle();
	assert.equal(copy.n, 1, 'the link works on the shared socket');
	assert.equal(await asks.ask('x'), 'text only', 'and so do the requests');

	(doc.n as number);
	doc.n = 2;
	await settle();
	assert.equal(copy.n, 2);
	assert.ok(here.sent.some((m) => typeof m !== 'string') && here.sent.some((m) => typeof m === 'string'), 'both kinds crossed one socket');
	linkHere.close();
	linkThere.close();
});

test('a text message that is not a request frame closes the socket, as bad bytes end a link', async () => {
	for (const text of ['not json', '[1,2]', 'null', '{"name":"x"}', '{"id":1}', '{"id":"1","name":"x"}']) {
		const here = fake();
		const other = fake();
		here.peer = other;
		other.peer = here;
		const asks = requests(here);
		here.fire('message', { data: text });
		assert.equal(here.readyState, 3, `closed on ${text}`);
		await assert.rejects(asks.ask('x'), (e: RequestError) => e.reason === 'closed');
	}
	const here = fake();
	requests(here);
	here.fire('message', { data: encodeFrame({ kind: 'leave', topic: 1 }) });
	here.fire('message', { data: JSON.stringify({ id: 99, result: 'nobody asked' }) });
	here.fire('message', { data: JSON.stringify({ id: 99, progress: 'nobody asked' }) });
	here.fire('message', { data: JSON.stringify({ id: 99, error: { reason: 'x', message: 'y' } }) });
	assert.equal(here.readyState, 1, 'bytes and answers nobody is waiting for are dropped, not fatal');
});

test('arguments the wire cannot carry are refused as not-data, at either end', async () => {
	const [here, there] = pair();
	const asks = requests(here);
	requests(there).answer((name) => (name === 'cycle' ? (() => { const o: Record<string, unknown> = {}; o.self = o; return o; })() : 10n));
	const cyclic: Record<string, unknown> = {};
	cyclic.self = cyclic;
	await assert.rejects(asks.ask('x', cyclic), (e: RequestError) => e.reason === 'not-data');
	await assert.rejects(asks.ask('cycle'), (e: RequestError) => e.reason === 'not-data' && /cycle/.test(e.message));
	await assert.rejects(asks.ask('bigint'), (e: RequestError) => e.reason === 'not-data');
});

test('a malformed error answer still rejects, as failed', async () => {
	const here = fake();
	const asks = requests(here);
	const waiting = asks.ask('x');
	await tick();
	here.fire('message', { data: JSON.stringify({ id: 1, error: 'just a string' }) });
	await assert.rejects(waiting, (e: RequestError) => e.reason === 'failed' && e.message === 'just a string');
	const second = asks.ask('y');
	await tick();
	here.fire('message', { data: JSON.stringify({ id: 2, error: { message: 'no reason given', reasons: [] } }) });
	await assert.rejects(second, (e: RequestError) => e.reason === 'failed' && e.message === 'no reason given' && e.reasons === undefined);
});

test('two ends asking at once keep their ids apart', async () => {
	const [here, there] = pair();
	const a = requests(here);
	const b = requests(there);
	a.answer((_n, args) => `a saw ${String(args)}`);
	b.answer((_n, args) => `b saw ${String(args)}`);
	const [fromA, fromB] = await Promise.all([a.ask('x', 1), b.ask('x', 2)]);
	assert.equal(fromA, 'b saw 1');
	assert.equal(fromB, 'a saw 2');
});

test('one request channel per socket: a second is refused until the first has stopped', async () => {
	const [here, there] = pair();
	const first = requests(here);
	assert.throws(() => requests(here), (e: RequestError) => e.reason === 'duplicate');
	requests(there).answer((_n, args) => `saw ${String(args)}`);
	assert.equal(await first.ask('x', 1), 'saw 1', 'the first still works');
	first.stop();
	const second = requests(here);
	assert.equal(await second.ask('x', 2), 'saw 2', 'after stop, a new channel may take the socket');
	const [left] = pair();
	const ended = requests(left);
	left.close();
	await tick();
	assert.doesNotThrow(() => requests(left), 'a socket whose channel ended with it may be taken again');
	void ended;
});
