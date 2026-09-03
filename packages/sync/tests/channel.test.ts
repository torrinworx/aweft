import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MessageChannel } from 'node:worker_threads';

import { createId } from '@aweftjs/codec';
import { encodeFrame, fromMessagePort, fromWebSocket, inProcess } from '@aweftjs/sync';
import type { Channel, Frame, PortLike, SocketLike } from '@aweftjs/sync';

const tick = (): Promise<void> => new Promise((done) => setTimeout(done, 0));

const refused: Frame = {
	kind: 'refused', topic: 3, seq: 9, reasons: [{ code: 'not-here', message: 'no' }],
};

test('an in-process pair delivers in order, and never inside the send', async () => {
	const [a, b] = inProcess();
	const heard: Frame[] = [];
	let duringSend = 0;

	b.receive((frame) => heard.push(frame));
	a.send(refused);
	a.send({ kind: 'leave', topic: 1 });
	duringSend = heard.length;

	await tick();
	assert.equal(duringSend, 0, 'nothing was delivered inside the send');
	assert.deepStrictEqual(heard.map((f) => f.kind), ['refused', 'leave']);
});

test('a channel that closed says so to whoever asks afterwards', async () => {
	const [a, b] = inProcess();
	a.close();
	await tick();

	let told = false;
	b.closed(() => { told = true; });
	await tick();
	assert.equal(told, true, 'a link that already ended tells a late listener');

	const heard: Frame[] = [];
	b.receive((frame) => heard.push(frame));
	a.send(refused);
	await tick();
	assert.equal(heard.length, 0, 'and carries nothing more');
});

test('unsubscribing stops delivery', async () => {
	const [a, b] = inProcess();
	const heard: Frame[] = [];
	const stop = b.receive((frame) => heard.push(frame));
	a.send(refused);
	await tick();
	stop();
	a.send(refused);
	await tick();
	assert.equal(heard.length, 1);

	const stopClose = b.closed(() => assert.fail('this was unsubscribed'));
	stopClose();
	a.close();
	await tick();
});

test('closing twice is not an error, and neither is sending afterwards', async () => {
	const [a] = inProcess();
	a.close();
	a.close();
	a.send(refused);
});

const port = (p: unknown): PortLike => p as PortLike;

test('a MessagePort pair carries frames as bytes, both ways', async () => {
	const pair = new MessageChannel();
	const here = fromMessagePort(port(pair.port1));
	const there = fromMessagePort(port(pair.port2));

	const heard: Frame[] = [];
	there.receive((frame) => heard.push(frame));
	const back: Frame[] = [];
	here.receive((frame) => back.push(frame));

	here.send(refused);
	there.send({ kind: 'leave', topic: 4 });
	await tick();

	assert.deepStrictEqual(heard, [refused]);
	assert.deepStrictEqual(back, [{ kind: 'leave', topic: 4 }]);

	here.close();
	there.close();
});

test('a MessagePort ignores a message that is not a frame, and ends on a message error', async () => {
	const listeners: Record<string, ((event: { data: unknown }) => void)[]> = {};
	let started = false;
	const fake: PortLike = {
		postMessage: () => {},
		addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn); },
		start: () => { started = true; },
		close: () => {},
	};

	const channel = fromMessagePort(fake);
	assert.equal(started, true, 'a port that needs starting is started');

	const heard: Frame[] = [];
	channel.receive((frame) => heard.push(frame));
	let ended = false;
	channel.closed(() => { ended = true; });

	for (const fn of listeners.message!) fn({ data: 'not bytes' });
	await tick();
	assert.equal(heard.length, 0, 'anything that is not bytes is not a frame');

	for (const fn of listeners.message!) fn({ data: encodeFrame(refused) });
	await tick();
	assert.deepStrictEqual(heard, [refused]);

	for (const fn of listeners.messageerror!) fn({ data: undefined });
	await tick();
	assert.equal(ended, true, 'a message error ends the link');
});

/** A socket shaped like a WebSocket, so the adapter can be driven without a server. */
const socket = () => {
	const listeners: Record<string, ((event: { data?: unknown }) => void)[]> = {};
	const sent: Uint8Array[] = [];
	const it = {
		binaryType: 'blob',
		readyState: 1,
		sent,
		send: (data: Uint8Array) => sent.push(data),
		close: () => { it.readyState = 3; },
		addEventListener: (type: string, fn: (event: { data?: unknown }) => void) => {
			(listeners[type] ??= []).push(fn);
		},
		fire: (type: string, event: { data?: unknown }) => {
			for (const fn of listeners[type] ?? []) fn(event);
		},
	};
	return it;
};

test('a WebSocket carries frames as binary messages', async () => {
	const ws = socket();
	const channel = fromWebSocket(ws as unknown as SocketLike);
	assert.equal(ws.binaryType, 'arraybuffer', 'the adapter asks for bytes rather than blobs');

	const heard: Frame[] = [];
	channel.receive((frame) => heard.push(frame));

	channel.send(refused);
	assert.deepStrictEqual(ws.sent, [encodeFrame(refused)]);

	// A browser hands over an ArrayBuffer; some runtimes hand over a view. Both are frames.
	const bytes = encodeFrame({ kind: 'leave', topic: 2 });
	ws.fire('message', { data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) });
	ws.fire('message', { data: encodeFrame({ kind: 'leave', topic: 3 }) });
	ws.fire('message', { data: 'a text message nobody sent' });
	await tick();
	assert.deepStrictEqual(heard.map((f) => f.topic), [2, 3]);

	channel.close();
	assert.equal(ws.readyState, 3);
});

test('a WebSocket that is not open drops what it is handed rather than throwing', () => {
	const ws = socket();
	ws.readyState = 0;
	fromWebSocket(ws as unknown as SocketLike).send(refused);
	assert.equal(ws.sent.length, 0);
});

test('bytes that are not a frame end the link rather than throwing into a delivery', async () => {
	for (const build of [
		() => {
			const ws = socket();
			const channel = fromWebSocket(ws as unknown as SocketLike);
			return { channel, feed: () => ws.fire('message', { data: new Uint8Array([0xff, 0xff]) }) };
		},
		() => {
			const listeners: ((event: { data: unknown }) => void)[] = [];
			const channel = fromMessagePort({
				postMessage: () => {},
				addEventListener: (type, fn) => { if (type === 'message') listeners.push(fn); },
				close: () => {},
			});
			return { channel, feed: () => { for (const fn of listeners) fn({ data: new Uint8Array([0xff, 0xff]) }); } };
		},
	]) {
		const { channel, feed } = build();
		let ended = false;
		channel.closed(() => { ended = true; });
		feed();
		await tick();
		assert.equal(ended, true, 'a frame that will not decode ends the link');
	}
});

test('a channel is exactly four functions, so writing one is a small job', () => {
	const [a] = inProcess();
	const surface: (keyof Channel)[] = ['send', 'receive', 'closed', 'close'];
	assert.deepStrictEqual(Object.keys(a).sort(), [...surface].sort());
	// And the frame encoding a new transport needs is two functions, both public.
	assert.ok(encodeFrame({
		kind: 'open', topic: 1, name: 'x', root: { id: createId(), kind: 'object' }, want: true,
	}).length > 0);
});
