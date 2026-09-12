// logs/Observe: each server event as an entry, args and result only for a module that says so,
// a request body never (design 261).

import test from 'node:test';
import assert from 'node:assert/strict';

import { entryFor } from '../src/modules/Observe.ts';
import type { ServerEvent } from '@aweftjs/server';

test('a call to a module that says logs: true carries args and result; one that does not carries their size', () => {
	const opted = entryFor({ kind: 'call', at: 1, name: 'app/Save', instance: { logs: true }, args: { title: 'hi' }, outcome: { result: { ok: 1 } }, ms: 3 } as ServerEvent)!;
	assert.equal(opted.args, '{"title":"hi"}');
	assert.equal(opted.result, '{"ok":1}');
	assert.equal(opted.ok, true);

	const plain = entryFor({ kind: 'call', at: 1, name: 'app/Save', instance: {}, args: { title: 'hi' }, outcome: { result: { ok: 1 } }, ms: 3 } as ServerEvent)!;
	assert.equal(plain.args, undefined);
	assert.equal(plain.result, undefined);
	assert.equal(plain.argsBytes, '{"title":"hi"}'.length);
	assert.equal(plain.resultBytes, '{"ok":1}'.length);
});

test('a failed call carries the reason and message and no result size', () => {
	const entry = entryFor({ kind: 'call', at: 1, name: 'app/X', instance: {}, args: 1, outcome: { error: Object.assign(new Error('nope'), { reason: 'refused' }) }, ms: 2 } as ServerEvent)!;
	assert.equal(entry.ok, false);
	assert.equal(entry.reason, 'refused');
	assert.equal(entry.message, 'nope');
	assert.equal(entry.resultBytes, undefined);
});

test('a request carries method, path and status, and the logs route itself is never an entry', () => {
	const entry = entryFor({ kind: 'request', at: 1, method: 'GET', path: '/page', status: 200, ms: 4, name: 'app/Files' } as ServerEvent)!;
	assert.deepEqual([entry.method, entry.path, entry.status, entry.name], ['GET', '/page', 200, 'app/Files']);
	assert.equal(entryFor({ kind: 'request', at: 1, method: 'POST', path: '/api/logs', status: 200, ms: 1 } as ServerEvent), undefined);
});

test('a connection carries its path; closed and refused and failed carry their fields', () => {
	assert.equal(entryFor({ kind: 'connection', at: 1, request: new Request('http://x/ws') } as ServerEvent)!.path, '/ws');
	assert.equal(entryFor({ kind: 'closed', at: 1, ms: 9 } as ServerEvent)!.ms, 9);
	assert.equal(entryFor({ kind: 'refused', at: 1, topic: 'board', reasons: [{ code: 'no', message: 'm' }] } as ServerEvent)!.topic, 'board');
	const failed = entryFor({ kind: 'failed', at: 1, name: 'app/Y', error: new Error('down') } as ServerEvent)!;
	assert.deepEqual([failed.name, failed.message], ['app/Y', 'down']);
});
