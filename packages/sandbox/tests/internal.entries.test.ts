// The room's entries over the route document (design 282), driven directly: what the router
// reaches through them, and what they refuse before a commit could be.

import test from 'node:test';
import assert from 'node:assert/strict';

import { atomic, createObject } from '@aweftjs/core';

import { routeEntries } from '../src/entries.ts';
import type { RouteDocument } from '../src/route.ts';
import { reasonOf } from './helpers.ts';

test('a push writes the document once, keeps the state by the key the host answers with, and listen fires on host writes only', () => {
	const route = createObject<RouteDocument>({ url: '/', key: 'e1', move: 'push', seq: 0 });
	const entries = routeEntries(route);
	let heard = 0;
	const stop = entries.listen(() => { heard += 1; });
	entries.replace({ mine: 1 }, '/');
	assert.equal(route.seq, 0, 'a replace of the URL showing is local: the host is not asked');
	assert.deepEqual(entries.state(), { mine: 1 });

	entries.push({ mine: 2 }, '/second?x=1');
	assert.deepEqual([route.url, route.move, route.seq], ['/second?x=1', 'push', 1]);
	assert.equal(entries.current(), '/second?x=1');
	assert.equal(heard, 0, 'the room\'s own write is not an entry change');
	assert.deepEqual(entries.state(), { mine: 1 }, 'until the host answers, the key has not moved and the state is the entry showing');

	atomic(() => { route.key = 'e2'; });
	assert.equal(heard, 1, 'the host\'s answer is the entry change');
	assert.deepEqual(entries.state(), { mine: 2 }, 'kept by the key the host answered with');
	atomic(() => { route.url = '/'; route.key = 'e1'; });
	assert.equal(heard, 2);
	assert.deepEqual(entries.state(), { mine: 1 }, 'back on the page finds the first entry\'s state');

	entries.back();
	assert.deepEqual([route.move, route.seq], ['back', 2]);
	stop();
	atomic(() => { route.key = 'e2'; });
	assert.equal(heard, 2, 'unsubscribed');
	entries.stop();
	atomic(() => { route.key = 'e3'; route.url = '/x'; });
	assert.equal(entries.current(), '/x', 'current still reads the document after stop');
});

test('a url that could leave the tail, one over 8192 characters or one with a control character is refused where it is written, with the fix', () => {
	const route = createObject<RouteDocument>({ url: '/', key: 'e1', move: 'push', seq: 0 });
	const entries = routeEntries(route);
	for (const bad of ['/../x', '//evil.test', 'second', '/a/%2e%2e/b', `/${'a'.repeat(8192)}`, '/x\nconnect', '/x\u007f', '/x?y=\u0000']) {
		assert.throws(() => entries.push(null, bad), (e: Error) => reasonOf(e) === 'outside-tail' && /\//.test(String((e as { fix?: string }).fix)), bad);
		assert.throws(() => entries.replace(null, bad), (e: Error) => reasonOf(e) === 'outside-tail', bad);
	}
	assert.equal(route.seq, 0, 'nothing was written');
	entries.push(null, `/${'a'.repeat(8191)}`);
	assert.equal(route.seq, 1, 'a url of exactly 8192 characters is the most that passes');
	entries.stop();
});
