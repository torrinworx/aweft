import { test } from 'node:test';
import assert from 'node:assert/strict';

import { REST, type Policy } from '@aweftjs/schema';
import { atomic, createObject, observer, snapshot } from '@aweftjs/core';
import { canonicalJson } from '@aweftjs/testing';
import { connect, inProcess, serve } from '@aweftjs/sync';
import type { Channel, HostOptions, Session } from '@aweftjs/sync';

const OPEN: Policy = [{ effect: 'allow', path: [REST] }];

const settle = async (rounds = 16): Promise<void> => {
	for (let i = 0; i < rounds; i++) await new Promise((done) => setTimeout(done, 0));
};

const same = (a: unknown, b: unknown, what: string): void => {
	assert.equal(canonicalJson(snapshot(a)), canonicalJson(snapshot(b)), what);
};

interface Link {
	readonly session: Session;
	readonly document: Record<string, unknown>;
	/** How many times the client has opened a channel. */
	readonly opens: () => number;
	/** How much the host had to send to bring a joiner up to date, per join. */
	readonly resets: () => number;
	cut(): void;
}

/**
 * A link the test can cut and bring back deliberately.
 *
 * Nothing reconnects on its own here: an outage that healed before the test could change
 * anything would pass while proving nothing.
 */
const link = (options: HostOptions = {}): Link => {
	const document = createObject<Record<string, unknown>>();
	const host = serve(() => ({ document, policy: OPEN }), options);

	let opens = 0;
	let resets = 0;
	let current: Channel | undefined;

	const session = connect(() => {
		opens += 1;
		const [there, here] = inProcess();
		current = there;
		// Count how often the host answers a join by sending the whole document.
		const seen = there.send.bind(there);
		host.accept({
			...there,
			send: (frame) => {
				if (frame.kind === 'joined' && frame.reset !== undefined) resets += 1;
				seen(frame);
			},
		}, { id: 'a' });
		return here;
	}, { retry: () => false });

	return {
		session, document, opens: () => opens, resets: () => resets,
		cut: () => { current?.close(); },
	};
};

test('a reconnect within the replay window is sent what it missed, not the document', async () => {
	const world = link();
	world.document.title = 'plan';
	const replica = world.session.join<Record<string, unknown>>('board');
	const mirror = await replica.ready;
	assert.equal(world.resets(), 1, 'the first join needs the document');

	world.cut();
	await settle(2);
	world.document.title = 'changed while away';
	world.document.extra = 7;
	await settle(2);
	assert.notEqual(mirror.title, world.document.title, 'it really was out of step');

	world.session.reconnect();
	await settle();

	assert.equal(world.opens(), 2, 'it reconnected');
	assert.equal(world.resets(), 1, 'and was not sent the document again');
	same(mirror, world.document, 'it caught up on what it missed');
});

test('a reconnect past the replay window is corrected without swapping the document', async () => {
	const world = link({ replay: 0 });
	world.document.title = 'plan';
	const replica = world.session.join<Record<string, unknown>>('board');
	const mirror = await replica.ready;

	// Something watching the document keeps working only if the document stays the same object.
	const seen: unknown[] = [];
	observer(mirror).path('title').watch(() => seen.push(mirror.title));

	world.cut();
	await settle(2);
	atomic(() => {
		world.document.title = 'rewritten';
		world.document.fresh = true;
		delete world.document.gone;
	});
	await settle(2);

	world.session.reconnect();
	await settle();

	assert.equal(world.resets(), 2, 'the whole document came again');
	assert.equal(replica.document, mirror, 'and it is still the same document');
	same(mirror, world.document, 'moved to what the host says');
	assert.deepStrictEqual(seen, ['rewritten'], 'the watcher on it saw an ordinary change');
});

test('a commit made while the link was down is sent when it comes back', async () => {
	const world = link();
	world.document.n = 0;
	const replica = world.session.join<Record<string, unknown>>('board');
	const mirror = await replica.ready;

	world.cut();
	await settle(2);
	mirror.n = 1;
	mirror.offline = 'written while away';
	assert.equal(replica.pending.get(), 2, 'held, not lost');
	assert.equal(world.document.n, 0, 'and the host has not seen them');

	world.session.reconnect();
	await settle();
	assert.equal(world.document.n, 1, 'it reached the host afterwards');
	assert.equal(world.document.offline, 'written while away');
	assert.equal(replica.pending.get(), 0);
});

test('a commit already accepted is not sent twice across a reconnect', async () => {
	const world = link();
	world.document.n = 0;
	const replica = world.session.join<Record<string, unknown>>('board');
	const mirror = await replica.ready;

	const child = createObject<Record<string, unknown>>({ tag: 'once' });
	mirror.child = child;
	await settle();
	assert.equal(world.resets(), 1);

	world.cut();
	await settle(2);
	world.session.reconnect();
	await settle();

	same(mirror, world.document, 'still in step after the reconnect');
	assert.equal(replica.pending.get(), 0, 'nothing left over to resend');
});

test('the session reports the link going down and coming back', async () => {
	const world = link();
	world.document.n = 0;
	await world.session.join('board').ready;
	assert.equal(world.session.connected.get(), true);

	world.cut();
	await settle(2);
	assert.equal(world.session.connected.get(), false, 'and it knows');

	world.session.reconnect();
	await settle();
	assert.equal(world.session.connected.get(), true, 'back up');
	assert.equal(world.opens(), 2);

	world.session.close();
	assert.equal(world.session.connected.get(), false);
});

test('closing the session stops it opening the link again', async () => {
	const world = link();
	world.document.n = 0;
	const replica = world.session.join('board');
	await replica.ready;

	world.session.close();
	const opened = world.opens();
	world.session.reconnect();
	await settle();
	assert.equal(world.opens(), opened, 'no further attempts');
	assert.equal(replica.state.get(), 'left');
});

test('a host that never opens is retried and then given up on', async () => {
	let tries = 0;
	const session = connect(() => {
		tries += 1;
		throw new Error('no route to host');
	}, { retry: (attempt) => (attempt < 3 ? 0 : false) });

	session.join('board');
	await settle();
	assert.equal(tries, 4, 'the first try plus three retries');
	assert.equal(session.connected.get(), false);
	session.close();
});
