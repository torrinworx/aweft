// A document a server module offers when the page asks for it by name (design 310): asked again
// on every socket, because every handle is shared again on every socket (design 184).

import test from 'node:test';
import assert from 'node:assert/strict';

import { createObject, observer } from '@aweftjs/core';
import { open } from '@aweftjs/server';
import type { Offer } from '@aweftjs/server';

import { createClient } from '../src/index.ts';

import { after, dialer, instance, reasonOf, serverOf, settle } from './helpers.ts';

type Note = Record<string, unknown>;

test('a reconnect asks again, and the module\'s document lands on the object the page holds', async () => {
	const note = createObject<Note>({ text: 'first' });
	const asked: string[] = [];
	const { server, handlers } = await serverOf({
		'notes/Open': instance(() => ({
			offer: (name: string): Offer | undefined => {
				asked.push(name);
				return name === 'note:1' ? { document: note, ...open } : undefined;
			},
		})),
	});
	const dial = dialer(handlers);
	const client = createClient({ url: 'ws://app.test/', open: dial.open });

	const shared = client.share<Note>('note:1');
	const document = await shared.ready;
	assert.equal(document.text, 'first');
	const texts: unknown[] = [];
	observer(document).path('text').effect((value) => texts.push(value));

	dial.sockets[0]!.close();
	await settle();
	note.text = 'written while the page was down';
	await after(700);
	await settle(20);

	assert.equal(client.status.get(), 'open');
	assert.deepEqual(asked, ['note:1', 'note:1'], 'the new connection was asked, with no code on the page');
	assert.equal(shared.document, document, 'the same object');
	assert.equal(document.text, 'written while the page was down');
	assert.deepEqual(texts, ['first', 'written while the page was down']);

	document.text = 'written after the reconnect';
	await settle(20);
	assert.equal(note.text, 'written after the reconnect', 'and the page writes through the new share');

	client.close();
	await server.stop();
});

test('a refusal rejects ready with the module\'s reason, and a reconnect asks again', async () => {
	let allowed = false;
	const faults: string[] = [];
	const { server, handlers } = await serverOf({
		'notes/Open': instance(() => ({
			offer: (name: string): Offer => {
				if (!allowed) throw Object.assign(new Error(`${name} is not yours`), { reason: 'private' });
				return { document: createObject<Note>({ text: 'yours now' }), ...open };
			},
		})),
	});
	const client = createClient({ url: 'ws://app.test/', open: dialer(handlers).open });
	const shared = client.share<Note>('note:2', undefined, { fault: (reason) => { faults.push(reason); } });
	await assert.rejects(shared.ready, (error: unknown) => reasonOf(error) === 'private');
	assert.deepEqual(faults, ['private']);

	// A sign-in reconnects, which is the moment the module would say yes.
	allowed = true;
	client.reconnect();
	await settle(20);
	assert.equal(shared.document?.text, 'yours now');

	client.close();
	await server.stop();
});

test('an offer that makes a new document for each ask ends the page\'s share with root-mismatch after a reconnect', async () => {
	// The page holds the document it had, and a new one has a root of its own.
	const faults: string[] = [];
	const { server, handlers } = await serverOf({
		'notes/Open': instance(() => ({ offer: (): Offer => ({ document: createObject<Note>({ text: 'from the row' }), ...open }) })),
	});
	const dial = dialer(handlers);
	const client = createClient({ url: 'ws://app.test/', open: dial.open });
	const shared = client.share<Note>('note:3', undefined, { fault: (reason) => { faults.push(reason); } });
	assert.equal((await shared.ready).text, 'from the row');
	dial.sockets[0]!.close();
	await after(700);
	await settle(20);
	assert.equal(client.status.get(), 'open');
	assert.deepEqual(faults, ['root-mismatch']);
	client.close();
	await server.stop();
});
