// The behavioral corpus for the window: what a hostile room can send across the link, stated
// as requirements on the host. Append-only. Each case is here because something like it has
// broken a system that ran strangers' code.
//
// The hostile room is not a runner: it is this test holding the far end of the channel and
// doing what the real far end never does.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createObject, snapshot } from '@aweftjs/core';
import { createSandbox } from '@aweftjs/sandbox';
import { type Channel, connect, inProcess } from '@aweftjs/sync';

import { document, grantsOf, reasonOf, until } from './helpers.ts';

const tick = (): Promise<void> => new Promise((done) => setTimeout(done, 5));

/** A runner whose room is this test. */
const hostile = (): { runner: { start(): Promise<Channel>; stop(): Promise<void> }; far: () => Channel } => {
	const [near, there] = inProcess();
	return { runner: { start: async () => near, stop: async () => { there.close(); } }, far: () => there };
};

test('a room that writes into the module document changes nothing on the host', async () => {
	const modules = document({ 'app/Echo': 'export default () => ({ echo: (x) => x })' });
	const before = JSON.stringify(snapshot(modules));
	const { runner, far } = hostile();
	const refused: string[] = [];
	const sandbox = await createSandbox({ runner, modules, grants: grantsOf() });
	const link = connect(far());
	const copy = await link.share<Record<string, { source: string }>>('modules', undefined, { refused: (r) => { refused.push(r.reasons[0]!.code); } }).ready;
	copy['app/Echo']!.source = 'export default () => ({ echo: () => "hijacked" })';
	copy['evil/New'] = createObject({ source: 'export default () => ({})' });
	await until('both refusals', () => refused.length === 2);
	assert.deepEqual(refused, ['read-only', 'read-only']);
	assert.equal(JSON.stringify(snapshot(modules)), before, 'the host document is exactly as it was');
	link.close();
	await sandbox.stop();
});

test('a room that writes into the control document grants itself nothing', async () => {
	const modules = document({});
	const grants = grantsOf(['files/Read']);
	const { runner, far } = hostile();
	const sandbox = await createSandbox({ runner, modules, grants });
	sandbox.expose('files/Read', { read: () => 'ok' });
	sandbox.expose('secret/Vault', { open: () => 'the vault' });
	const link = connect(far());
	const refused: string[] = [];
	const room = await link.share<{ grants: string[]; props: string; exposed: Record<string, string> }>('room', undefined, { refused: (r) => { refused.push(r.reasons[0]!.code); } }).ready;
	room.grants.push('secret/Vault');
	room.props = '{"admin":true}';
	await until('both refusals', () => refused.length === 2);
	assert.deepEqual([...grants], ['files/Read'], 'the host list is unchanged');

	// And the host checks its own list, not the room's: a forged call on the name is refused.
	const calls = await link.share<Record<string, unknown>>('calls').ready;
	calls['room1'] = createObject({ from: 'room', to: 'secret/Vault', method: 'open', args: '[]' });
	await until('the answer', () => typeof (calls['room1'] as { error?: string }).error === 'string');
	assert.equal(JSON.parse((calls['room1'] as { error: string }).error).reason, 'refused');
	link.close();
	await sandbox.stop();
});

test('a malformed row from the room is answered with malformed, and the host keeps answering', async () => {
	const modules = document({});
	const { runner, far } = hostile();
	const sandbox = await createSandbox({ runner, modules, grants: grantsOf(['files/Read']) });
	sandbox.expose('files/Read', { read: (n: unknown) => `<${String(n)}>` });
	const link = connect(far());
	const calls = await link.share<Record<string, unknown>>('calls').ready;
	const errorOf = (id: string): string => JSON.parse((calls[id] as { error: string }).error).reason;

	calls['a'] = createObject({ from: 'room', to: 'files/Read', method: 'read', args: 'not json' });
	calls['b'] = createObject({ from: 'room', to: 'files/Read', method: 'read', args: '{"not":"a list"}' });
	calls['c'] = createObject({ from: 'room', to: 7, method: 'read', args: '[]' });
	calls['d'] = createObject({ from: 'room', to: 'files/Read', method: 'nope', args: '[]' });
	calls['e'] = createObject({ from: 'room', to: 'files/Read', method: 'read', args: '["fine"]' });
	calls['f'] = createObject({ from: 'nobody', to: 'files/Read', method: 'read', args: '["ignored"]' });
	calls['g'] = 'not a row at all';
	await until('every answer', () => ['a', 'b', 'c', 'd'].every((id) => typeof (calls[id] as { error?: string }).error === 'string')
		&& typeof (calls['e'] as { result?: string }).result === 'string');
	assert.deepEqual([errorOf('a'), errorOf('b'), errorOf('c'), errorOf('d')], ['malformed', 'malformed', 'malformed', 'missing']);
	assert.equal(JSON.parse((calls['e'] as { result: string }).result), '<fine>');
	await tick();
	assert.equal((calls['f'] as { result?: string }).result, undefined, 'a row from nobody is not answered');
	assert.equal(calls['g'], 'not a row at all', 'a slot that is not a row is left alone');
	link.close();
	await sandbox.stop();
});

test('the side that asked deletes the row once it has the answer, so the calls document does not grow', async () => {
	const modules = document({});
	const { runner, far } = hostile();
	const sandbox = await createSandbox({ runner, modules, grants: grantsOf(['files/Read']) });
	sandbox.expose('files/Read', { read: (n: unknown) => `<${String(n)}>` });
	const link = connect(far());
	const calls = await link.share<Record<string, unknown>>('calls').ready;

	// The host asks the room three times; the far end here answers each in place.
	const asked = [sandbox.loaded(), sandbox.loaded(), sandbox.loaded()];
	await until('three host rows', () => Object.keys(calls).filter((k) => (calls[k] as { from?: string }).from === 'host').length === 3);
	for (const id of Object.keys(calls)) (calls[id] as { result: string }).result = '[]';
	await Promise.all(asked);
	await tick();
	assert.deepEqual(Object.keys(calls), [], 'every answered row the host wrote is gone');

	// And a row the far end (room) writes to the host is deleted by the room once answered.
	calls['room1'] = createObject({ from: 'room', to: 'files/Read', method: 'read', args: '["x"]' });
	await until('the host answers the room row', () => typeof (calls['room1'] as { result?: string }).result === 'string');
	// The room end (this test) deletes its own answered row, as the bridge would.
	delete calls['room1'];
	assert.deepEqual(Object.keys(calls), [], 'nothing is left behind');
	link.close();
	await sandbox.stop();
});

test('a row the room deletes before answering rejects the host call rather than hanging it', async () => {
	const modules = document({});
	const { runner, far } = hostile();
	const sandbox = await createSandbox({ runner, modules, grants: grantsOf() });
	const link = connect(far());
	const calls = await link.share<Record<string, unknown>>('calls').ready;
	const waiting = sandbox.loaded();
	await until('the host row', () => Object.keys(calls).length === 1);
	delete calls[Object.keys(calls)[0]!];
	await assert.rejects(waiting, (e) => reasonOf(e) === 'closed');
	link.close();
	await sandbox.stop();
});

test('an answer that is not text, or not JSON, fails the call as malformed and does not throw into the host', async () => {
	const modules = document({});
	const { runner, far } = hostile();
	const sandbox = await createSandbox({ runner, modules, grants: grantsOf() });
	const link = connect(far());
	const calls = await link.share<Record<string, unknown>>('calls').ready;

	const first = sandbox.loaded();
	await until('the first row', () => Object.keys(calls).length === 1);
	(calls[Object.keys(calls)[0]!] as { result: string }).result = '{not json';
	await assert.rejects(first, (e) => reasonOf(e) === 'malformed');

	const second = sandbox.loaded();
	await until('the second row', () => Object.keys(calls).length === 1);
	(calls[Object.keys(calls)[0]!] as { result: string }).result = '"a string where a list was expected"';
	await assert.rejects(second, (e) => reasonOf(e) === 'malformed');

	const third = sandbox.load(['x']);
	await until('the third row', () => Object.keys(calls).length === 1);
	(calls[Object.keys(calls)[0]!] as { result: string }).result = '{"x": "not a function list"}';
	await assert.rejects(third, (e) => reasonOf(e) === 'malformed');

	const fourth = sandbox.loaded();
	await until('the fourth row', () => Object.keys(calls).length === 1);
	(calls[Object.keys(calls)[0]!] as { error: string }).error = 'garbage';
	await assert.rejects(fourth, (e) => reasonOf(e) === 'malformed');

	const fifth = sandbox.loaded();
	await until('the fifth row', () => Object.keys(calls).length === 1);
	(calls[Object.keys(calls)[0]!] as { error: string }).error = '{"no":"reason"}';
	await assert.rejects(fifth, (e) => reasonOf(e) === 'failed');
	link.close();
	await sandbox.stop();
});
