// Recipe: a page on Wi-Fi that drops without saying so.
//
// The question this answers is what a page hears when its connection dies and nothing closes it,
// as a cafe's network does to a laptop. A TCP proxy stands between the page and the server, and at
// one point it stops forwarding in both directions while keeping both ends open. New connections
// through it still work, as they do once the laptop is back on a network. The page asks a module,
// keeps a shared board, and records its visit with the logs battery. Design 317.

import assert from 'node:assert/strict';
import net from 'node:net';

import { createClient } from '@aweftjs/client';
import { createObject } from '@aweftjs/core';
import { createLog } from '@aweftjs/logs/client';
import type { Batch } from '@aweftjs/logs/client';
import { fromBundle } from '@aweftjs/modules';
import { createServer, open } from '@aweftjs/server';
import type { Connection } from '@aweftjs/server';
import { node } from '@aweftjs/server/node';

// Shorter than a page's default of 10 s so the recipe runs in seconds, and long enough that the
// ask is still waiting when the log tells waiting asks, at 5 s.
const QUIET = 3000;

const board = createObject({ title: 'the board' });
const listener = node({ port: 0, host: '127.0.0.1' });
const server = createServer({
	sources: [fromBundle({
		'./clock/Now.ts': { default: () => ({ public: true, call: () => Date.now() }) },
		'./board/Share.ts': { default: () => ({ public: true, connection: ({ link }: Connection<unknown>) => { link.share('board', board, open); } }) },
	})],
	gate: open,
	listener,
});
await server.start();

// Each connection the proxy accepts is piped to the server until it is frozen. Frozen, its bytes
// are dropped both ways and neither end is closed.
const pipes: { frozen: boolean }[] = [];
const proxy = net.createServer((inbound) => {
	const pipe = { frozen: false };
	pipes.push(pipe);
	const outbound = net.connect(listener.port!, '127.0.0.1');
	inbound.on('data', (chunk) => { if (!pipe.frozen) outbound.write(chunk); });
	outbound.on('data', (chunk) => { if (!pipe.frozen) inbound.write(chunk); });
	inbound.on('error', () => {});
	outbound.on('error', () => {});
	inbound.on('close', () => { outbound.destroy(); });
	outbound.on('close', () => { inbound.destroy(); });
});
await new Promise<void>((done) => { proxy.listen(0, '127.0.0.1', done); });
const port = (proxy.address() as net.AddressInfo).port;

// The page: a client, recorded. Its batches are kept here instead of posted, and the window is a
// stand-in, since this runs in Node.
const batches: Batch[] = [];
const log = createLog(createClient({ url: `ws://127.0.0.1:${String(port)}/`, quiet: QUIET }), {
	origin: 'http://page.test',
	flushMs: 200,
	window: { addEventListener: () => {}, removeEventListener: () => {} },
	fetch: async (_url, init) => { batches.push(JSON.parse(init.body) as Batch); },
});
const client = log.client;
const shared = await client.share<{ title: string }>('board').ready;
assert.equal(typeof await client.ask('clock/Now', {}), 'number', 'the page works before the drop');

for (const pipe of pipes) pipe.frozen = true;
const dropped = Date.now();
const heard = await Promise.race([
	client.ask('clock/Now', {}).then(() => 'answered', (error: { reason?: unknown }) => String(error.reason)),
	new Promise<string>((done) => { setTimeout(() => { done('nothing after 10 quiet periods'); }, QUIET * 10); }),
]);
const took = Date.now() - dropped;
assert.equal(heard, 'closed', 'the ask made after the drop hears closed instead of waiting forever');
assert.ok(took < QUIET * 4, `and hears it within about two quiet periods (${String(took)} ms)`);

const until = Date.now() + QUIET * 5;
while (client.status.get() !== 'open' && Date.now() < until) await new Promise((done) => { setTimeout(done, 20); });
assert.equal(client.status.get(), 'open', 'the client is back on a new connection');
assert.equal(pipes.length, 2, 'through a new socket, not the dead one');
assert.equal(typeof await client.ask('clock/Now', {}), 'number', 'and the next ask is answered');

board.title = 'renamed after the drop';
const seen = Date.now() + QUIET * 5;
while (shared.title !== 'renamed after the drop' && Date.now() < seen) await new Promise((done) => { setTimeout(done, 20); });
assert.equal(shared.title, 'renamed after the drop', 'the board the page held is shared again and follows the server');

await log.flush();
const entries = batches.flatMap((batch) => batch.entries);
assert.ok(entries.some((entry) => entry.kind === 'waiting' && entry.name === 'clock/Now'), 'the visit says what it was waiting on while it waited');
assert.ok(entries.some((entry) => entry.kind === 'ask' && entry.name === 'clock/Now' && entry.ok === false && entry.reason === 'closed'), 'and how that ask ended');

log.stop();
client.close();
proxy.close();
await server.stop();
console.log(`recipes/dropped-wifi: done (closed heard after ${String(took)} ms, reconnected through socket ${String(pipes.length)})`);
