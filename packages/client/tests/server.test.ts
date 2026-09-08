// A page-shaped client against a real listener on a real port, through the default socket seam.
//
// Everything below runs over Node's own WebSocket, the one `createClient` reaches for when the
// application hands in no `open`, so the whole path is the one a browser takes.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createObject, observer } from '@aweftjs/core';
import { createLoader, fromBundle } from '@aweftjs/modules';
import { createServer, open } from '@aweftjs/server';
import type { Connection } from '@aweftjs/server';
import { node } from '@aweftjs/server/node';

import { createClient } from '../src/index.ts';

import { after, instance, until } from './helpers.ts';

type Board = Record<string, unknown>;

test('the ordering, the reconnect with the same document, the held ask, and close', async () => {
	const board = createObject<Board>({ title: 'first' });
	const connections: Array<Connection<unknown>> = [];
	const loader = createLoader({
		sources: [fromBundle({
			'app/Board': instance(() => ({
				connection: (connection: Connection<unknown>) => {
					connections.push(connection);
					connection.link.share('board', board, open);
				},
				call: (args: unknown) => `answered ${JSON.stringify(args)}`,
			})),
		})],
	});
	await loader.load(['app/Board']);
	const listener = node({ port: 0, host: '127.0.0.1' });
	const server = createServer({ loader, gate: open, listener });
	await server.start();

	const client = createClient({ url: `ws://127.0.0.1:${String(listener.port)}/` });

	// Both are written while the socket is still connecting, and the server speaks first.
	const shared = client.share<Board>('board');
	const answer = client.ask('app/Board', { n: 1 });
	const document = await shared.ready;
	assert.equal(document.title, 'first');
	assert.equal(await answer, 'answered {"n":1}');

	const titles: unknown[] = [];
	observer(document).path('title').effect((value) => titles.push(value));

	connections[0]!.close();
	await until(() => client.status.get() === 'closed');

	board.title = 'written while the client was down';
	const late = client.ask('app/Board', { n: 2 });

	await until(() => client.status.get() === 'open');
	await until(() => connections.length === 2);
	assert.equal(shared.document, document, 'the page holds the same object it always held');
	await until(() => document.title === 'written while the client was down');
	assert.deepEqual(titles, ['first', 'written while the client was down'],
		'the reconnect reached the watcher as an ordinary change');
	assert.equal(await late, 'answered {"n":2}', 'the ask made while it was down went out on the next socket');

	client.close();
	assert.equal(client.status.get(), 'closed');
	await after(900);
	assert.equal(connections.length, 2, 'nothing reconnects after close');

	await server.stop();
});
