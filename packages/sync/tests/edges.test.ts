// The paths an application meets when something has gone wrong, and the mirror.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { REST, type Policy } from '@aweftjs/schema';
import { atomic, createArray, createMap, createObject, idOf, snapshot } from '@aweftjs/core';
import { canonicalJson } from '@aweftjs/testing';
import { connect, inProcess, mirror, rootFrom, serve } from '@aweftjs/sync';
import type { Channel, Frame } from '@aweftjs/sync';

const OPEN: Policy = [{ effect: 'allow', path: [REST] }];

const settle = async (rounds = 16): Promise<void> => {
	for (let i = 0; i < rounds; i++) await new Promise((done) => setTimeout(done, 0));
};

const same = (a: unknown, b: unknown, what: string): void => {
	assert.equal(canonicalJson(snapshot(a)), canonicalJson(snapshot(b)), what);
};

test('a refusal with no handler is warned about rather than swallowed', async () => {
	const document = createObject<Record<string, unknown>>({ n: 0 });
	const host = serve(() => ({ document, policy: [{ effect: 'allow', path: ['other'] }] }));
	const [there, here] = inProcess();
	host.accept(there, { id: 'a' });

	const said: string[] = [];
	const warn = console.warn;
	console.warn = (line: string) => said.push(line);
	try {
		const session = connect(() => here, { retry: () => false });
		const mine = await session.join<Record<string, unknown>>('doc').ready;
		mine.n = 1;
		await settle();
		session.close();
	} finally {
		console.warn = warn;
	}

	assert.equal(said.length, 1, 'one line, once');
	assert.match(said[0]!, /1 refused commit\(s\) on doc and no handler/);
	assert.equal(document.n, 0);
});

test('a hole in the host stream is answered by asking for the document again', async () => {
	const document = createObject<Record<string, unknown>>({ n: 0 });
	const host = serve(() => ({ document, policy: OPEN }), { replay: 0 });

	let resets = 0;
	let drop = false;
	const session = connect(() => {
		const [there, here] = inProcess();
		// A channel that quietly loses one commits frame, which is the one thing a link must
		// never do. The client cannot repair it and must not pretend it did.
		host.accept({
			...there,
			send: (frame: Frame) => {
				if (frame.kind === 'joined' && frame.reset !== undefined) resets += 1;
				if (drop && frame.kind === 'commits') return;
				there.send(frame);
			},
		}, { id: 'a' });
		return here;
	}, { retry: () => false });

	const mine = await session.join<Record<string, unknown>>('doc').ready;
	assert.equal(resets, 1);

	drop = true;
	document.n = 1;
	await settle(4);
	assert.equal(mine.n, 0, 'the frame really was lost');

	drop = false;
	document.n = 2;
	await settle();

	assert.equal(resets, 2, 'the client asked for the document rather than carrying on');
	same(mine, document, 'and it is in step again');
	session.close();
});

test('a document with the wrong root id fails the join instead of being overwritten', async () => {
	const document = createObject<Record<string, unknown>>({ n: 0 });
	const host = serve(() => ({ document, policy: OPEN }));
	const [there, here] = inProcess();
	host.accept(there, { id: 'a' });

	const mine = createObject<Record<string, unknown>>({ mine: true });
	const faults: string[] = [];
	const replica = connect(() => here, { retry: () => false })
		.join('doc', { document: mine, fault: (reason) => faults.push(reason) });

	await assert.rejects(replica.ready, /root-mismatch/);
	assert.deepStrictEqual(faults, ['root-mismatch']);
	assert.equal(replica.state.get(), 'failed');
	assert.deepStrictEqual(Object.keys(mine), ['mine'], 'the document was left alone');
});

test('a replica joined before the link is up waits rather than failing', async () => {
	const document = createObject<Record<string, unknown>>({ n: 7 });
	const host = serve(() => ({ document, policy: OPEN }));

	let allow = false;
	const session = connect(() => {
		if (!allow) throw new Error('not yet');
		const [there, here] = inProcess();
		host.accept(there, { id: 'a' });
		return here;
	}, { retry: () => 0 });

	const replica = session.join<Record<string, unknown>>('doc');
	assert.equal(replica.document, undefined, 'nothing to hold yet');
	await settle(2);

	allow = true;
	const mine = await replica.ready;
	assert.equal(mine.n, 7);
	session.close();
});

test('closing a session while the link is still opening opens nothing', async () => {
	let opened = 0;
	let closed = 0;
	const session = connect(async () => {
		opened += 1;
		await new Promise((done) => setTimeout(done, 0));
		const [, here] = inProcess();
		return { ...here, close: () => { closed += 1; here.close(); } } as Channel;
	}, { retry: () => false });

	session.join('doc');
	session.close();
	await settle(4);

	assert.equal(opened, 1);
	assert.equal(closed, 1, 'the channel that arrived late was closed rather than used');
	assert.equal(session.connected.get(), false);
});

test('reconnect while the link is up drops it and opens another', async () => {
	const document = createObject<Record<string, unknown>>({ n: 0 });
	const host = serve(() => ({ document, policy: OPEN }));
	let opens = 0;
	const session = connect(() => {
		opens += 1;
		const [there, here] = inProcess();
		host.accept(there, { id: 'a' });
		return here;
	}, { retry: () => 0 });

	const mine = await session.join<Record<string, unknown>>('doc').ready;
	session.reconnect();
	await settle();

	assert.equal(opens, 2);
	document.n = 5;
	await settle();
	assert.equal(mine.n, 5, 'and it works on the new link');
	session.close();
});

test('leaving twice, and after the session closed, does nothing', async () => {
	const document = createObject<Record<string, unknown>>({ n: 0 });
	const host = serve(() => ({ document, policy: OPEN }));
	const [there, here] = inProcess();
	host.accept(there, { id: 'a' });

	const session = connect(() => here, { retry: () => false });
	const replica = session.join('doc');
	await replica.ready;

	replica.leave();
	replica.leave();
	replica.flush();
	session.close();
	replica.leave();
	assert.equal(replica.state.get(), 'left');
});

test('rootFrom builds a root of each kind, and refuses anything else', () => {
	const object = createObject();
	const array = createArray();
	const map = createMap();
	assert.equal(idOf(rootFrom(idOf(object), 'object')).join(), idOf(object).join());
	assert.equal(idOf(rootFrom(idOf(array), 'array')).join(), idOf(array).join());
	assert.equal(idOf(rootFrom(idOf(map), 'map')).join(), idOf(map).join());
	assert.throws(
		() => rootFrom(idOf(object), 'nope' as unknown as 'object'),
		/kind-conflict/,
	);
});

test('a mirror keeps a second document in step, both ways, until it is stopped', async () => {
	const stored = createObject<Record<string, unknown>>();
	atomic(() => {
		stored.title = 'plan';
		stored.tasks = createArray<object>([createObject({ title: 'a' })]);
	});

	const editing = mirror(stored);
	await settle(4);
	const copy = editing.document as Record<string, unknown>;
	same(copy, stored, 'the second document was built from the first');

	stored.title = 'from the stored side';
	await settle(4);
	assert.equal(copy.title, 'from the stored side');

	copy.title = 'from the editing side';
	await settle(4);
	assert.equal(stored.title, 'from the editing side', 'and back the other way');

	// The case that matters for an editing mirror: a change made in place, not a swap.
	const held = copy;
	(stored.tasks as object[]).push(createObject({ title: 'b' }));
	await settle(4);
	same(copy, stored, 'a subtree change crossed');
	assert.equal(editing.document, held, 'and the document is the same object throughout');

	editing.stop();
	stored.title = 'after it stopped';
	await settle(4);
	assert.equal(copy.title, 'from the editing side', 'stopping it stops it');
});

test('a mirror can be given the document to keep in step', async () => {
	const stored = createObject<Record<string, unknown>>({ n: 1 });
	const mine = createObject<Record<string, unknown>>(undefined, idOf(stored));
	const editing = mirror(stored, mine);
	await settle(4);

	assert.equal(editing.document, mine);
	assert.equal(mine.n, 1);
	editing.stop();
});

test('a host commit the client cannot apply is answered by asking for the document', async () => {
	const document = createObject<Record<string, unknown>>({ n: 0 });
	const host = serve(() => ({ document, policy: OPEN }), { replay: 0 });

	let resets = 0;
	let inject = false;
	const session = connect(() => {
		const [there, here] = inProcess();
		host.accept({
			...there,
			send: (frame: Frame) => {
				if (frame.kind === 'joined' && frame.reset !== undefined) resets += 1;
				if (inject && frame.kind === 'commits') {
					// A commit the client's document cannot take: `add` on a slot it already holds.
					// The two sides disagree about more than this frame, so the client must ask for
					// the document rather than carry on holding something the host does not have.
					there.send({
						kind: 'commits', topic: frame.topic, first: frame.first,
						commits: [{
							deltas: [{
								type: 'add', id: idOf(document), ref: { kind: 'object', key: 'n' }, value: 9,
							}],
						}],
					});
					return;
				}
				there.send(frame);
			},
		}, { id: 'a' });
		return here;
	}, { retry: () => false });

	const mine = await session.join<Record<string, unknown>>('doc').ready;
	assert.equal(resets, 1);

	inject = true;
	document.n = 1;
	await settle(4);

	inject = false;
	document.n = 2;
	await settle();

	assert.equal(resets, 2, 'it asked for the document');
	same(mine, document, 'and ended in step');
	session.close();
});

test('a topic joined while the link is already up joins straight away', async () => {
	const board = createObject<Record<string, unknown>>({ kind: 'board' });
	const chat = createObject<Record<string, unknown>>({ kind: 'chat' });
	const host = serve((name) => ({ document: name === 'board' ? board : chat, policy: OPEN }));
	const [there, here] = inProcess();
	host.accept(there, { id: 'a' });

	const session = connect(() => here, { retry: () => false });
	const first = await session.join<Record<string, unknown>>('board').ready;
	assert.equal(first.kind, 'board');

	// The link is up now, so this one does not wait for it to be opened.
	const second = await session.join<Record<string, unknown>>('chat').ready;
	assert.equal(second.kind, 'chat');
	session.close();
});

test('closing while a retry is waiting cancels it', async () => {
	let tries = 0;
	const session = connect(() => {
		tries += 1;
		throw new Error('no route to host');
	}, { retry: () => 20 });

	session.join('doc');
	await settle(2);
	assert.equal(tries, 1, 'the first try failed and a retry is waiting');

	session.close();
	await new Promise((done) => setTimeout(done, 60));
	assert.equal(tries, 1, 'and the waiting retry never fired');
});

// Design 045 states both of these as guarantees, and until now neither had a check. The
// actor match is the single most security-relevant line in the package: without it, anyone
// holding a session id inherits how far that client had got.
test('a session resumed by a different actor is worth nothing', async () => {
	const document = createObject<Record<string, unknown>>({ n: 0 });
	const host = serve(() => ({ document, policy: OPEN }));

	const open = (id: string) => {
		const [there, here] = inProcess();
		host.accept(there, { id });
		const heard: Frame[] = [];
		here.receive((frame) => heard.push(frame));
		return { here, there, heard };
	};

	// Alice joins, has one commit accepted, and goes away.
	const alice = open('alice');
	alice.here.send({ kind: 'join', topic: 0, name: 'doc', have: 0 });
	await settle(2);
	const joined = alice.heard.find((f) => f.kind === 'joined');
	assert.ok(joined?.kind === 'joined');
	const session = joined.session;

	alice.here.send({
		kind: 'commits', topic: 0, first: 1,
		commits: [{
			deltas: [{ type: 'replace', id: idOf(document), ref: { kind: 'object', key: 'n' }, value: 1 }],
		}],
	});
	await settle(2);
	alice.there.close();
	await settle(2);

	// Mallory presents Alice's session id.
	const mallory = open('mallory');
	mallory.here.send({ kind: 'join', topic: 0, name: 'doc', have: 0, resume: session });
	await settle(2);
	const stolen = mallory.heard.find((f) => f.kind === 'joined');
	assert.ok(stolen?.kind === 'joined');
	assert.equal(stolen.accepted, 0, 'the session tells a different actor nothing');

	// And Alice still has hers.
	const back = open('alice');
	back.here.send({ kind: 'join', topic: 0, name: 'doc', have: 0, resume: session });
	await settle(2);
	const resumed = back.heard.find((f) => f.kind === 'joined');
	assert.ok(resumed?.kind === 'joined');
	assert.equal(resumed.accepted, 1, 'presenting it as the wrong actor did not consume it');
	host.close();
});

test('a host remembers only as many disconnected sessions as it was told to', async () => {
	const document = createObject<Record<string, unknown>>({ n: 0 });
	const host = serve(() => ({ document, policy: OPEN }), { sessions: 1 });

	const sessions: Uint8Array[] = [];
	for (const id of ['a', 'b']) {
		const [there, here] = inProcess();
		host.accept(there, { id });
		const heard: Frame[] = [];
		here.receive((frame) => heard.push(frame));
		here.send({ kind: 'join', topic: 0, name: 'doc', have: 0 });
		await settle(2);
		const joined = heard.find((f) => f.kind === 'joined');
		assert.ok(joined?.kind === 'joined');
		sessions.push(joined.session);
		here.send({
			kind: 'commits', topic: 0, first: 1,
			commits: [{
				deltas: [{
					type: 'replace', id: idOf(document), ref: { kind: 'object', key: 'n' },
					value: id === 'a' ? 1 : 2,
				}],
			}],
		});
		await settle(2);
		there.close();
		await settle(2);
	}

	// Two went away and the host was told to keep one, so the older is gone.
	const back = (id: string, session: Uint8Array) => {
		const [there, here] = inProcess();
		host.accept(there, { id });
		const heard: Frame[] = [];
		here.receive((frame) => heard.push(frame));
		here.send({ kind: 'join', topic: 0, name: 'doc', have: 0, resume: session });
		return { heard, there };
	};

	const first = back('a', sessions[0]!);
	const second = back('b', sessions[1]!);
	await settle(2);

	const forgotten = first.heard.find((f) => f.kind === 'joined');
	const kept = second.heard.find((f) => f.kind === 'joined');
	assert.ok(forgotten?.kind === 'joined' && kept?.kind === 'joined');
	assert.equal(forgotten.accepted, 0, 'the older session was dropped to stay inside the bound');
	assert.equal(kept.accepted, 1, 'the newer one is still there');
	host.close();
});

// A client that cannot get anywhere with a host has to say so and stop. Asking for the
// document forever is a microtask hot loop: no timer ever runs again, so the process does not
// slow down, it stops, and nothing anywhere reports why.
test('a replica that cannot get in step gives up rather than asking forever', async () => {
	const document = createObject<Record<string, unknown>>({ n: 0 });
	const host = serve(() => ({ document, policy: OPEN }), { replay: 0 });

	let joins = 0;
	const session = connect(() => {
		const [there, here] = inProcess();
		host.accept({
			...there,
			// A host that answers every join by repeating a commit the client cannot apply. No
			// real host does this; a client that met one would never stop asking.
			send: (frame: Frame) => {
				if (frame.kind === 'joined') {
					joins += 1;
					const { reset: _drop, ...rest } = frame;
					there.send({ ...rest, whole: false });
					there.send({
						kind: 'commits', topic: frame.topic, first: 1,
						commits: [{
							deltas: [{
								type: 'add', id: idOf(document), ref: { kind: 'object', key: 'n' }, value: 1,
							}],
						}],
					});
					return;
				}
				there.send(frame);
			},
		}, { id: 'a' });
		return here;
	}, { retry: () => false });

	const faults: string[] = [];
	const replica = session.join<Record<string, unknown>>('doc', {
		document: createObject<Record<string, unknown>>({ n: 0 }, idOf(document)),
		fault: (reason) => faults.push(reason),
	});

	await settle(40);
	assert.deepStrictEqual(faults, ['resync-loop'], 'it said why it stopped');
	assert.equal(replica.state.get(), 'failed');
	assert.ok(joins <= 8, `it stopped asking after ${joins} tries rather than looping`);
	session.close();
	host.close();
});

// The two numbers a caller never passes, so nothing else exercises them.
test('the defaults are the ones the README and design 045 state', async () => {
	// The backoff: 100ms doubling to a cap of 30s, which is what `retry` replaces.
	const waits: number[] = [];
	const timer = globalThis.setTimeout;
	(globalThis as { setTimeout: unknown }).setTimeout = ((fn: () => void, ms: number) => {
		// The test's own settling uses zero, so only a real wait is a backoff.
		if (ms > 0) waits.push(ms);
		return timer(fn, 0);
	}) as typeof setTimeout;

	let tries = 0;
	const session = connect(() => {
		tries += 1;
		if (tries > 4) {
			session.close();
			throw new Error('enough');
		}
		throw new Error('no route to host');
	});
	session.join('doc');
	await settle(8);
	(globalThis as { setTimeout: unknown }).setTimeout = timer;
	session.close();

	assert.deepStrictEqual(waits.slice(0, 4), [100, 200, 400, 800], 'doubling from 100ms');
	assert.ok(Math.min(...waits) >= 100 && Math.max(...waits) <= 30_000, 'inside the stated bounds');

	// The replay window: 256 commits per topic by default, so a client that missed fewer than
	// that is sent what it missed rather than the whole document.
	const document = createObject<Record<string, unknown>>({ n: 0 });
	const host = serve(() => ({ document, policy: OPEN }));
	const [there, here] = inProcess();
	host.accept(there, { id: 'a' });
	const heard: Frame[] = [];
	here.receive((frame) => heard.push(frame));
	here.send({ kind: 'join', topic: 0, name: 'doc', have: 0 });
	await settle(2);
	const joined = heard[0];
	assert.ok(joined?.kind === 'joined');

	for (let i = 1; i <= 200; i++) document.n = i;
	await settle(2);
	there.close();
	await settle(2);

	const [again, back] = inProcess();
	host.accept(again, { id: 'a' });
	const second: Frame[] = [];
	back.receive((frame) => second.push(frame));
	back.send({ kind: 'join', topic: 0, name: 'doc', have: 0, resume: joined.session });
	await settle(2);

	const answer = second.find((f) => f.kind === 'joined');
	assert.ok(answer?.kind === 'joined');
	assert.equal(answer.whole, false, '200 missed commits is inside the default window of 256');
	host.close();
});

// A frame that will not go down a link ends that link. Most of a flush runs in a microtask,
// so a send that throws there has nowhere to go: it leaves as an uncaught exception and takes
// the whole process, along with every other link the host was serving. The shape that found
// this was a value the encoder refuses reaching a byte transport, which core now stops at the
// write, but any transport can throw for its own reasons and the containment is what matters.
test('a channel whose send throws ends that link rather than the process', async () => {
	const doc = createObject() as Record<string, unknown>;
	doc.title = 'fine';

	const [there, here] = inProcess();
	let poisoned = false;
	let sent = 0;
	// Everything a real channel does, until it cannot carry a frame any more.
	const brittle: Channel = {
		send: (frame) => {
			if (!poisoned) return there.send(frame);
			sent++;
			throw new Error('this transport cannot carry that');
		},
		receive: (fn) => there.receive(fn),
		closed: (fn) => there.closed(fn),
		close: () => there.close(),
	};

	const host = serve(() => ({ document: doc, policy: 'trusted' }));
	host.accept(brittle, { id: 'a' });
	const client = connect(() => here);
	const replica = await client.join<Record<string, unknown>>('board').ready;
	assert.equal(replica.title, 'fine', 'the join worked while the channel still carried frames');

	// The host publishes on its own, from a microtask, which is the path with no caller to
	// hand the throw back to.
	poisoned = true;
	doc.title = 'a change worth sending';
	await settle();

	assert.equal(sent, 1, 'nothing behind the bad frame was pushed at a dead channel');
	assert.equal(client.connected.get(), false, 'and the client saw the link end');

	client.close();
	host.close();
});
