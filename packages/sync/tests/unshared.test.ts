// An `open` for a name this end does not share (design 310). The application hears it and answers
// it. The link holds it as it always did, refuses it with a fault, and drops it when the other end
// leaves.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import { createObject } from '@aweftjs/core';
import { connect, inProcess } from '@aweftjs/sync';
import type { Channel, Frame, Unshared } from '@aweftjs/sync';
import { settle } from '@aweftjs/testing';

type Doc = Record<string, unknown>;

/** A channel that writes down every frame it carries in, so a test reads what the other end sent. */
const tapped = (channel: Channel, heard: Frame[]): Channel => ({
	...channel,
	receive: (fn) => channel.receive((frame) => { heard.push(frame); fn(frame); }),
});

const pair = () => {
	const [a, b] = inProcess();
	const asked: Unshared[] = [];
	const toServer: Frame[] = [];
	const toPage: Frame[] = [];
	const server = connect(tapped(a, toServer), { unshared: (request) => { asked.push(request); } });
	const page = connect(tapped(b, toPage));
	return { server, page, asked, toServer, toPage };
};

test('an open for a name nothing here shares is heard once, held, and a later share pairs with it', async () => {
	const { server, page, asked } = pair();
	const minted = page.share<Doc>('board');
	await settle();
	assert.deepEqual(asked.map((one) => one.name), ['board']);
	assert.equal(asked[0]!.held(), true);

	server.share('board', createObject<Doc>({ title: 'kept' }));
	assert.equal((await minted.ready).title, 'kept', 'the held open paired with the share made after it');
	assert.equal(asked[0]!.held(), false, 'a paired open is no longer held');
	assert.equal(asked[0]!.refuse('late', 'too late'), false, 'and refusing it sends nothing');
	server.close();
});

test('a name this end shares already is never heard', async () => {
	const { server, page, asked } = pair();
	server.share('board', createObject<Doc>({ title: 'kept' }));
	assert.equal((await page.share<Doc>('board').ready).title, 'kept');
	assert.deepEqual(asked, []);
	server.close();
});

test('a refusal ends the topic at the other end with that reason and message, and only once', async () => {
	const { server, page, asked, toPage } = pair();
	const faults: string[] = [];
	const minted = page.share<Doc>('secret', undefined, { fault: (reason, message) => { faults.push(`${reason}: ${message}`); } });
	await settle();
	const opened = toPage.length;
	assert.equal(asked[0]!.refuse('private', 'secret is not yours'), true);
	assert.equal(asked[0]!.held(), false);
	assert.equal(asked[0]!.refuse('private', 'again'), false, 'a refused open is not held, so a second refusal sends nothing');
	await assert.rejects(minted.ready, (error: { reason?: string; message?: string }) =>
		error.reason === 'private' && /secret is not yours/.test(String(error.message)));
	assert.deepEqual(faults, ['private: secret is not yours']);

	// The fault named the page's own number for the topic, which is what lets the page find it.
	const sent = toPage.slice(opened);
	assert.equal(sent.length, 1);
	assert.equal(sent[0]!.kind, 'fault');

	// Nothing is held for that name now, so a share made here waits for an open of its own.
	server.share('secret', createObject<Doc>({ n: 1 }));
	await settle();
	assert.equal(toPage.filter((frame) => frame.kind === 'state').length, 0, 'nothing paired with the refused topic');
	server.close();
});

test('a topic the other end leaves before it is paired is no longer held, and is answered as before', async () => {
	const { server, page, asked, toPage } = pair();
	const minted = page.share<Doc>('board');
	await settle();
	minted.stop();
	await settle();
	assert.equal(asked[0]!.held(), false, 'the leave dropped the held open');
	assert.ok(toPage.some((frame) => frame.kind === 'fault' && frame.reason === 'no-topic'), 'the leave is still answered no-topic');

	server.share('board', createObject<Doc>({ title: 'kept' }));
	await settle();
	assert.equal(toPage.filter((frame) => frame.kind === 'state').length, 0, 'the share made after it pairs with nothing');
	server.close();
});

test('a leave drops only the open it names, and every other held name still pairs', async () => {
	const { server, page } = pair();
	const left = page.share<Doc>('draft');
	const kept = page.share<Doc>('board');
	await settle();
	left.stop();
	await settle();
	server.share('board', createObject<Doc>({ title: 'kept' }));
	await settle();
	assert.equal(kept.document?.title, 'kept');
	server.close();
});

test('a share holding a document asks once, though it sends open twice to ask for state', async () => {
	const { server, page, asked, toServer } = pair();
	const held = page.share('board', createObject<Doc>({ title: 'mine' }));
	held.resync();
	await settle();
	assert.equal(toServer.filter((frame) => frame.kind === 'open').length, 2);
	assert.equal(asked.length, 1, 'one topic, heard once');
	assert.equal(asked[0]!.held(), true, 'the second open kept it held');
	server.close();
});

// The link keeps one live topic per name, as its README says. So when the other end shares a name
// twice, this test does not check which of the two a later share here pairs with.
test('a second share of the name from the other end is heard again, and takes the first one\'s place', async () => {
	const { server, page, asked } = pair();
	page.share<Doc>('board').ready.catch(() => {});
	page.share<Doc>('board').ready.catch(() => {});
	await settle();
	assert.equal(asked.length, 2);
	assert.equal(asked[0]!.held(), false, 'the newer open took the older one\'s place');
	assert.equal(asked[1]!.held(), true);
	assert.equal(asked[0]!.refuse('private', 'not yours'), false, 'so the older one can no longer be refused');
	server.close();
});

test('a share of something that is not an observable throws and leaves nothing for a later open to pair with', async () => {
	const { server, page } = pair();
	assert.throws(() => server.share('board', { plain: true } as Doc), { reason: 'not-observable' });
	const minted = page.share<Doc>('board');
	await settle();
	server.share('board', createObject<Doc>({ title: 'kept' }));
	assert.equal((await minted.ready).title, 'kept', 'the open waited for the share that worked, and paired with it');
	server.close();
});

test('nothing is held once the link ends', async () => {
	const { server, page, asked } = pair();
	page.share<Doc>('board').ready.catch(() => {});
	await settle();
	server.close();
	await settle();
	assert.equal(asked[0]!.held(), false);
	assert.equal(asked[0]!.refuse('closed', 'gone'), false);
});

test('an unshared that throws is the application\'s error on a fresh task, and the open is still held', () => {
	// An uncaught exception cannot be observed from inside the test runner, so the scenario
	// runs in a child process that reports what it saw.
	const child = spawnSync(process.execPath, [new URL('./unshared-throws.ts', import.meta.url).pathname], { encoding: 'utf8' });
	assert.equal(child.status, 0, child.stderr);
	assert.deepEqual(JSON.parse(child.stdout.trim()), { synchronous: false, raised: ['the hook broke'], paired: true });
});
