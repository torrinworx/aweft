// What leaves the room as data (design 280): errors, rejections and console lines reach the
// host's handlers as plain data, a tick of them is one call row, a handler that throws costs
// the room nothing, a malformed report is dropped, and each realm forwards what its entry
// point says it does.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createObject } from '@aweftjs/core';
import { type Report, createSandbox, inProcess } from '@aweftjs/sandbox';
import { child } from '@aweftjs/sandbox/node';
import { enter } from '@aweftjs/sandbox/inside';
import { type Channel, type Frame, connect, inProcess as pair } from '@aweftjs/sync';

import { document, grantsOf, open, until } from './helpers.ts';

const held = (): { runner: { start(): Promise<Channel>; stop(): Promise<void> }; far: () => Channel; near: Channel } => {
	const [near, there] = pair();
	return { runner: { start: async () => near, stop: async () => { there.close(); } }, far: () => there, near };
};

const tick = (): Promise<void> => new Promise((done) => setTimeout(done, 20));

/**
 * The rows the room writes on the calls document, read off the frames the host's channel
 * hears: each is a row object attached under its id on the `calls` topic the room opened.
 */
const rowsWritten = (near: Channel): { readonly ids: string[]; stop(): void } => {
	const ids: string[] = [];
	let topic: number | null = null;
	const stop = near.receive((frame: Frame) => {
		if (frame.kind === 'open' && frame.name === 'calls') topic = frame.topic;
		if (frame.kind !== 'commits' || frame.topic !== topic) return;
		for (const commit of frame.commits) {
			for (const delta of commit.deltas) {
				if (delta.type !== 'add' || delta.ref.kind !== 'object' || typeof delta.ref.key !== 'string') continue;
				if ((delta.value as { edge?: unknown } | null)?.edge === 'attach') ids.push(delta.ref.key);
			}
		}
	});
	return { ids, stop };
};

/** Node's globalThis is no event target: the frame's error listeners land on this stand-in. */
const realmWith = (): { listeners: Map<string, (event: unknown) => void>; restore(): void } => {
	const listeners = new Map<string, (event: unknown) => void>();
	const realm = globalThis as { addEventListener?: unknown; removeEventListener?: unknown };
	realm.addEventListener = (type: string, fn: (event: unknown) => void) => { listeners.set(type, fn); };
	realm.removeEventListener = (type: string) => { listeners.delete(type); };
	return { listeners, restore: () => { delete realm.addEventListener; delete realm.removeEventListener; } };
};

test('a report from the room reaches the handler for its kind, and a handler that throws costs nothing', async () => {
	const errors: Report[] = [];
	const lines: [string, string][] = [];
	let throws = true;
	const make = held();
	const sandbox = await createSandbox({
		runner: make.runner, modules: document({}), grants: grantsOf(),
		page: { act: 'app/Main', route: createObject({ url: '/', key: '', move: 'push', seq: 0 }) },
		handlers: {
			error: (entry) => { errors.push(entry); if (throws) { throws = false; throw new Error('the handler is broken'); } },
			console: (level, text) => { lines.push([level, text]); },
		},
	});
	const realm = realmWith();
	const heldWarn = console.warn;
	console.warn = () => {};
	try {
		const room = await enter(make.far(), { forward: { errors: true, console: true } });
		realm.listeners.get('error')!({ error: new TypeError('x is not a function'), message: 'Uncaught TypeError' });
		realm.listeners.get('unhandledrejection')!({ reason: 'no' });
		console.warn('careful');
		await until('three reports', () => errors.length === 2 && lines.length === 1);
		assert.deepEqual(errors.map((e) => [e.kind, e.message, e.module]), [
			['error', 'TypeError: x is not a function', 'app/Main'],
			['rejection', 'no', 'app/Main'],
		]);
		assert.deepEqual(lines, [['warn', 'careful']]);
		realm.listeners.get('error')!({ error: new Error('again'), message: 'Uncaught Error' });
		await until('the report after the throw', () => errors.length === 3);
		await room.serve((await import('@aweftjs/modules')).createLoader({ sources: room.sources })).stop();
	} finally {
		console.warn = heldWarn;
		realm.restore();
		await sandbox.stop();
	}
});

test('a tick of console lines is one call row, and each line reaches the handler in order', async () => {
	const lines: string[] = [];
	const make = held();
	const rows = rowsWritten(make.near);
	const sandbox = await createSandbox({
		runner: make.runner, modules: document({}), grants: grantsOf(), console: ['warn'],
		handlers: { console: (_level, text) => { lines.push(text); } },
	});
	const heldWarn = console.warn;
	console.warn = () => {};
	try {
		const room = await enter(make.far(), { forward: { console: true } });
		for (let i = 0; i < 200; i += 1) console.warn('line', i);
		await until('every line on the host', () => lines.length === 200);
		assert.deepEqual(lines, Array.from({ length: 200 }, (_, i) => `line ${i}`), 'in the order they were printed');
		assert.deepEqual(rows.ids, ['room1'], 'one row carried the whole tick');
		console.warn('next tick');
		await until('the next line', () => lines.length === 201);
		assert.deepEqual(rows.ids, ['room1', 'room2'], 'a later tick is a row of its own');
		await room.serve((await import('@aweftjs/modules')).createLoader({ sources: room.sources })).stop();
	} finally {
		console.warn = heldWarn;
		rows.stop();
		await sandbox.stop();
	}
});

test('a malformed report is dropped, not thrown, and the host keeps answering', async () => {
	const errors: Report[] = [];
	const lines: unknown[] = [];
	const make = held();
	const sandbox = await createSandbox({
		runner: make.runner, modules: document({}), grants: grantsOf(),
		handlers: { error: (entry) => { errors.push(entry); }, console: (...args) => { lines.push(args); } },
	});
	const link = connect(make.far());
	const calls = await link.share<Record<string, unknown>>('calls').ready;
	const bad = [
		'"a string"', '{"kind":"panic","message":"x","stack":""}', '{"kind":"error","message":7,"stack":""}',
		'{"kind":"error","message":"x"}', '{"kind":"console","message":"x","stack":""}',
		'{"kind":"error","message":"x","stack":"","module":3}', '{"kind":"error","message":"x","stack":"","level":"warn"}',
		'[]', 'null',
	];
	// Each in a list of its own, and the honest shape outside a list: a report crosses as a list.
	const texts = [...bad.map((text) => `[${text}]`), '{"kind":"error","message":"bare","stack":""}', '"not a list"'];
	texts.forEach((text, i) => { calls[`room${i + 1}`] = createObject({ from: 'room', to: 'host', method: 'report', args: `[${text}]` }); });
	await until('every row answered', () => texts.every((_, i) => typeof (calls[`room${i + 1}`] as { result?: string }).result === 'string'));
	assert.deepEqual(errors, [], 'nothing malformed reached the error handler');
	assert.deepEqual(lines, [], 'nor the console handler');
	calls['ok'] = createObject({ from: 'room', to: 'host', method: 'report', args: '[[{"kind":"error","message":"real","stack":"s"}, 7, {"kind":"console","level":"warn","message":"beside it","stack":""}]]' });
	await until('the honest ones', () => lines.length === 1);
	assert.deepEqual(errors, [{ kind: 'error', message: 'real', stack: 's' }], 'a malformed entry costs the ones beside it nothing');
	assert.deepEqual(lines, [['warn', 'beside it', '']]);
	link.close();
	await sandbox.stop();
});

test('a handler that throws is answered as if it had not, and the host keeps answering', async () => {
	const errors: Report[] = [];
	const make = held();
	const sandbox = await createSandbox({
		runner: make.runner, modules: document({}), grants: grantsOf(),
		handlers: { error: (entry) => { errors.push(entry); throw new Error('the handler is broken'); } },
	});
	const link = connect(make.far());
	const calls = await link.share<Record<string, unknown>>('calls').ready;
	const row = (): { result?: string; error?: string } => calls['room1'] as { result?: string; error?: string };
	calls['room1'] = createObject({ from: 'room', to: 'host', method: 'report', args: '[[{"kind":"error","message":"one","stack":""}]]' });
	await until('the row answered', () => typeof row().result === 'string' || typeof row().error === 'string');
	assert.equal(errors.length, 1, 'the handler was called');
	assert.equal(row().error, undefined, 'the throw did not cross as the row\'s error');
	assert.equal(row().result, 'null', 'the row was answered as every report is');
	calls['room2'] = createObject({ from: 'room', to: 'host', method: 'report', args: '[[{"kind":"error","message":"two","stack":""}]]' });
	await until('the next row answered', () => typeof (calls['room2'] as { result?: string }).result === 'string');
	assert.equal(errors.length, 2, 'the host went on handing reports over');
	link.close();
	await sandbox.stop();
});

test('forward.console wraps the named levels, keeps the real console first, and makes text safely', async () => {
	const lines: [string, string, string][] = [];
	const make = held();
	const sandbox = await createSandbox({
		runner: make.runner, modules: document({}), grants: grantsOf(), console: ['warn', 'nosuchlevel'],
		page: { act: 'app/Main', route: createObject({ url: '/', key: '', move: 'push', seq: 0 }) },
		handlers: { console: (level, text, stack) => { lines.push([level, text, stack]); } },
	});
	const real: unknown[][] = [];
	const heldWarn = console.warn;
	const heldLog = console.log;
	console.warn = (...args: unknown[]) => { real.push(args); };
	try {
		const room = await enter(make.far(), { forward: { console: true } });
		const loud = { toJSON: () => { throw new Error('do not print me'); }, toString: () => { throw new Error('nor me'); } };
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		console.warn('hello', 2, { a: [1] }, new TypeError('bad'), loud, cyclic, 10n, 'x'.repeat(5000));
		console.log('not forwarded');
		await until('the line', () => lines.length === 1);
		assert.equal(real.length, 1, 'the real console heard it first');
		const [level, text, stack] = lines[0]!;
		assert.equal(level, 'warn');
		assert.ok(text.startsWith('hello 2 {"a":[1]} TypeError: bad [unprintable] [object Object] 10 xxx'), text.slice(0, 80));
		assert.equal(text.length, 4096, 'cut to a sane length');
		assert.ok(stack.length > 0 && !stack.startsWith('Error'), 'a stack taken in the room, without the message line');
		assert.equal(console.log, heldLog, 'a level not named is left alone');
		await tick();
		assert.equal(lines.length, 1, 'and it is not forwarded');

		const served = room.serve((await import('@aweftjs/modules')).createLoader({ sources: room.sources }));
		await served.stop();
		console.warn('after stop');
		await tick();
		assert.equal(lines.length, 1, 'stop restores the console');
		assert.equal(real.length, 2, 'to what it was');
	} finally {
		console.warn = heldWarn;
		console.log = heldLog;
		await sandbox.stop();
	}
});

test('forward.errors installs the two listeners where the realm has an event target, attributed to the act', async () => {
	const errors: Report[] = [];
	const make = held();
	const sandbox = await createSandbox({
		runner: make.runner, modules: document({}), grants: grantsOf(),
		page: { act: 'app/Main', route: createObject({ url: '/', key: '', move: 'push', seq: 0 }) },
		handlers: { error: (entry) => { errors.push(entry); } },
	});
	// Node's globalThis is no event target, so the frame's listeners are exercised through a
	// stand-in installed for the length of the test.
	const listeners = new Map<string, (event: unknown) => void>();
	const realm = globalThis as { addEventListener?: unknown; removeEventListener?: unknown };
	realm.addEventListener = (type: string, fn: (event: unknown) => void) => { listeners.set(type, fn); };
	realm.removeEventListener = (type: string) => { listeners.delete(type); };
	try {
		const room = await enter(make.far(), { forward: { errors: true } });
		assert.deepEqual([...listeners.keys()].sort(), ['error', 'unhandledrejection']);
		const thrown = new RangeError('too far');
		listeners.get('error')!({ error: thrown, message: 'Uncaught RangeError: too far' });
		listeners.get('error')!({ error: null, message: 'Script error.' });
		listeners.get('unhandledrejection')!({ reason: 'a string reason' });
		listeners.get('unhandledrejection')!({ reason: undefined });
		await until('four reports', () => errors.length === 4);
		assert.deepEqual(errors.map((e) => [e.kind, e.message, e.module]), [
			['error', 'RangeError: too far', 'app/Main'],
			['error', 'Script error.', 'app/Main'],
			['rejection', 'a string reason', 'app/Main'],
			['rejection', 'unhandled rejection', 'app/Main'],
		]);
		assert.equal(errors[0]!.stack, thrown.stack, 'the stack the room had');
		assert.equal(errors[2]!.stack, '', 'none where there was none');
		const served = room.serve((await import('@aweftjs/modules')).createLoader({ sources: room.sources }));
		await served.stop();
		assert.equal(listeners.size, 0, 'stop takes the listeners off');
	} finally {
		delete realm.addEventListener;
		delete realm.removeEventListener;
		await sandbox.stop();
	}
});

test('a child forwards its console and an in-process room forwards nothing, because it shares the host\'s realm', async () => {
	const source = { 'app/Noisy': `export default () => ({ say: () => { console.warn('from inside', 42); console.log('quiet'); return 'said'; } });` };
	const lines: [string, string][] = [];
	const { sandbox } = await open(() => child(), source, [], { handlers: { console: (level, text) => { lines.push([level, text]); } } });
	try {
		const { 'app/Noisy': noisy } = await sandbox.load(['app/Noisy']);
		assert.equal(await noisy!.say!(), 'said');
		await until('the child\'s line', () => lines.length === 1);
		assert.deepEqual(lines, [['warn', 'from inside 42']], 'warn crossed and log did not');
	} finally {
		await sandbox.stop();
	}

	const heldWarn = console.warn;
	console.warn = () => {};
	try {
		const quiet: unknown[] = [];
		const { sandbox: same } = await open(() => inProcess(), source, [], { handlers: { console: (...args) => { quiet.push(args); } } });
		try {
			const { 'app/Noisy': noisy } = await same.load(['app/Noisy']);
			await noisy!.say!();
			await tick();
			assert.deepEqual(quiet, [], 'an in-process room installs no wrapper');
			assert.equal(console.warn.name, '', 'and the host\'s console is as it was');
		} finally {
			await same.stop();
		}
	} finally {
		console.warn = heldWarn;
	}
});
