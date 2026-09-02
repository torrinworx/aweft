// The behavioral corpus for replication.
//
// Each case is a requirement this package must meet, and each is here because getting it
// wrong is a known way for a sync engine to lose data quietly. Append only: taking one out
// needs a design note.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { REST, type Policy } from '@aweftjs/schema';
import {
	atomic, createArray, createMap, createObject, idOf, observer, snapshot, textIdOf,
} from '@aweftjs/core';
import { canonicalJson } from '@aweftjs/testing';
import { connect, inProcess, serve, track } from '@aweftjs/sync';
import type { Commit, Frame, Refused, Session } from '@aweftjs/sync';

const OPEN: Policy = [{ effect: 'allow', path: [REST] }];

const settle = async (rounds = 20): Promise<void> => {
	for (let i = 0; i < rounds; i++) await new Promise((done) => setTimeout(done, 0));
};

const same = (a: unknown, b: unknown, what: string): void => {
	assert.equal(canonicalJson(snapshot(a)), canonicalJson(snapshot(b)), what);
};

const board = (policy: Policy | 'trusted' = OPEN) => {
	const document = createObject<Record<string, unknown>>();
	const host = serve(() => ({ document, policy }));
	const refusals: Refused[] = [];
	const client = (id = 'a'): Session => connect(() => {
		const [there, here] = inProcess();
		host.accept(there, { id });
		return here;
	}, { retry: () => false });
	return { document, host, refusals, client };
};

/** One commit a document made, so a case can hand it somewhere by hand. */
const oneCommit = (document: object, write: () => void): Commit => {
	const held: Commit[] = [];
	const stop = observer(document).watch((change) => held.push({ deltas: [...change.deltas] }));
	write();
	stop();
	assert.equal(held.length, 1, 'the write was one commit');
	return held[0]!;
};

// A watcher that writes in answer to an arriving commit is the ordinary way an application
// reacts to a change. Delivery is deferred, so that write is delivered inside the same drain
// as the commit that caused it: an engine that suppresses its own echo with a plain flag
// swallows it, and the reaction never leaves the machine. Measured in .scratch/sync/e6-echo.ts.
test('a local write made in answer to an arriving commit still replicates', () => {
	const document = createObject<Record<string, unknown>>();
	const outgoing: Commit[] = [];
	const tracker = track(document, ({ commit, landed }) => {
		if (!landed) outgoing.push(commit);
	});

	observer(document).path('remote').watch(() => { document.reacted = true; });

	const source = createObject<Record<string, unknown>>(undefined, idOf(document));
	tracker.receive(oneCommit(source, () => { source.remote = 1; }));

	assert.equal(outgoing.length, 1, 'the reaction is a local commit and goes out');
	assert.equal(document.reacted, true);
	tracker.stop();
});

// A commit whose deltas all write what the slot already holds changes nothing, so nothing is
// delivered for it. An engine that assumes one delivery per receive is then one delivery out
// of step for the rest of its life, and the next genuinely local commit is swallowed.
test('a commit that changes nothing does not swallow the next local one', () => {
	const document = createObject<Record<string, unknown>>({ n: 1 });
	const outgoing: Commit[] = [];
	const tracker = track(document, ({ commit, landed }) => {
		if (!landed) outgoing.push(commit);
	});

	tracker.receive({
		deltas: [{ type: 'replace', id: idOf(document), ref: { kind: 'object', key: 'n' }, value: 1 }],
	});
	document.n = 2;

	assert.equal(outgoing.length, 1, 'the local write was not eaten by the no-op before it');
	tracker.stop();
});

// A client applies its own commit before it sends it. Handing it back would give whatever it
// attached a second attach edge, which the applier refuses, and the replica would be stuck
// asking for the document over and over.
test('a replica is never sent back the commit it sent', async () => {
	const world = board();
	world.document.ready = true;
	const session = world.client();
	const replica = session.join<Record<string, unknown>>('board');
	const mirror = await replica.ready;

	const refusals: Refused[] = [];
	const two = world.client('b').join<Record<string, unknown>>('board', {
		refused: (group) => refusals.push(...group),
	});
	await two.ready;

	mirror.child = createObject({ deep: true });
	await settle();

	assert.equal(refusals.length, 0, 'nothing came back to be refused');
	same(mirror, world.document, 'and the sender is in step');
	session.close();
});

// Undoing a pending list oldest first meets each undo against a state it was not made
// against. The one that matters: a commit that attaches a subtree and a later one that writes
// into it. Undo the attach first and the write's undo has nowhere to land.
test('a pending list is undone newest first', async () => {
	const world = board([{ effect: 'allow', path: ['keep', REST] }]);
	world.document.keep = createObject({});
	const session = world.client();
	const refusals: Refused[] = [];
	const replica = session.join<Record<string, unknown>>('board', {
		refused: (group) => refusals.push(...group),
	});
	const mirror = await replica.ready;

	// Refused, so everything after it is rewound: an attach, then a write inside it.
	mirror.blocked = 1;
	const child = createObject<Record<string, unknown>>({ n: 1 });
	(mirror.keep as Record<string, unknown>).child = child;
	child.n = 2;
	await settle();

	assert.equal(refusals.length, 1, 'only the unauthorized one was refused');
	assert.equal(mirror.blocked, undefined);
	assert.equal(((mirror.keep as Record<string, unknown>).child as Record<string, unknown>).n, 2,
		'the two that were rewound came back');
	same(mirror, world.document, 'and the host agrees');
	session.close();
});

// A well behaved client produces refusals through ordinary races and keeps writing while one
// is in flight. Ending the link would turn every race into a full resynchronization at the
// moment the client is busiest. Design 012.
test('a refusal leaves the link up and the commits around it alone', async () => {
	const world = board([{ effect: 'allow', path: ['ok'] }]);
	const session = world.client();
	const refusals: Refused[] = [];
	const replica = session.join<Record<string, unknown>>('board', {
		refused: (group) => refusals.push(...group),
	});
	const mirror = await replica.ready;

	mirror.ok = 'before';
	mirror.no = 'refused';
	mirror.ok = 'after';
	await settle();

	assert.equal(refusals.length, 1);
	assert.equal(mirror.ok, 'after', 'the commits on either side of it landed');
	assert.equal(world.document.ok, 'after');
	assert.equal(replica.state.get(), 'live', 'and the link never went down');
	session.close();
});

// Rate limiting a commit stream loses one commit of a burst, and a receiver that misses one
// holds a different document forever after. Frames may be batched, which sends every commit
// in fewer messages; they may never be dropped or coalesced across the wire.
test('a burst of commits in one tick all arrive, in order', async () => {
	const world = board();
	world.document.n = 0;
	const session = world.client();
	const replica = session.join<Record<string, unknown>>('board');
	const mirror = await replica.ready;

	const seen: unknown[] = [];
	observer(world.document).path('n').watch(() => seen.push(world.document.n));

	for (let i = 1; i <= 50; i++) mirror.n = i;
	await settle();

	assert.deepStrictEqual(seen, Array.from({ length: 50 }, (_, i) => i + 1),
		'every value of the burst reached the host, in order');
	session.close();
});

// The host decides the order. A commit that arrives while a local one is still in flight has
// to be put underneath it, not on top, or the two sides end at different documents.
test('a commit arriving under a pending one is rebased, not dropped', async () => {
	const world = board();
	atomic(() => { world.document.mine = 0; world.document.theirs = 0; });
	const session = world.client();
	const replica = session.join<Record<string, unknown>>('board');
	const mirror = await replica.ready;

	mirror.mine = 1;                 // pending, not yet accepted
	world.document.theirs = 1;       // and the host writes at the same moment
	await settle();

	assert.equal(mirror.mine, 1);
	assert.equal(mirror.theirs, 1);
	same(mirror, world.document, 'both sides say the same thing');
	session.close();
});

// A commit may write into a subtree it detaches in the same breath. Core found this by
// hand: the walk from the delta up to a listener ran through a parent that was already gone,
// and a replica received half the commit and drifted, silently.
test('a commit that writes into a subtree it detaches crosses whole', async () => {
	const world = board();
	const holder = createObject<Record<string, unknown>>();
	const inner = createObject<Record<string, unknown>>({ n: 1 });
	atomic(() => {
		world.document.holder = holder;
		holder.inner = inner;
	});

	const session = world.client();
	const mirror = await session.join<Record<string, unknown>>('board').ready;
	same(mirror, world.document, 'in step to start with');

	atomic(() => {
		inner.n = 2;
		delete holder.inner;
	});
	await settle();

	same(mirror, world.document, 'the whole commit crossed, not half of it');
	session.close();
});

// Two replicas inserting at the same place in one array is the case an index-addressed list
// cannot survive. Positions are ordered keys chosen by whoever inserted, so two inserts get
// two distinct keys and neither shifts the other.
test('two replicas inserting at the same place in one array do not collide', async () => {
	const world = board();
	const list = createArray<string>(['a', 'z']);
	world.document.list = list;

	const one = world.client('a');
	const two = world.client('b');
	const a = await one.join<Record<string, unknown>>('board').ready;
	const b = await two.join<Record<string, unknown>>('board').ready;

	(a.list as string[]).splice(1, 0, 'from a');
	(b.list as string[]).splice(1, 0, 'from b');
	await settle();

	assert.equal(list.length, 4, 'both inserts survived');
	same(a, world.document, 'the first replica agrees with the host');
	same(b, world.document, 'and so does the second');
	one.close();
	two.close();
});

// An id-keyed map is the collection to reach for when what matters is which thing an entry
// is about. Two replicas filing under the same id is a genuine conflict; two replicas filing
// different entries is not, and must not behave like one.
test('two replicas filing into one map keep both entries', async () => {
	const world = board();
	const people = createMap<Record<string, unknown>>();
	world.document.people = people;

	const one = world.client('a');
	const two = world.client('b');
	const a = await one.join<Record<string, unknown>>('board').ready;
	const b = await two.join<Record<string, unknown>>('board').ready;

	(a.people as typeof people).add(createObject({ name: 'from a' }));
	(b.people as typeof people).add(createObject({ name: 'from b' }));
	await settle();

	assert.equal(people.size, 2);
	same(a, world.document, 'the first replica agrees with the host');
	same(b, world.document, 'and so does the second');
	one.close();
	two.close();
});

// A replica that writes into something another replica has just taken out cannot have its
// write, and has to be told rather than left showing it. The applier's own word for it is
// what the report carries, so the two layers never disagree about the cause.
test('writing into what another replica removed is refused by name', async () => {
	const world = board();
	const tasks = createMap<Record<string, unknown>>();
	world.document.tasks = tasks;
	const doomed = createObject<Record<string, unknown>>({ title: 'about to go' });
	tasks.add(doomed);

	const one = world.client('a');
	const two = world.client('b');
	const refusals: Refused[] = [];
	const a = await one.join<Record<string, unknown>>('board').ready;
	const b = await two.join<Record<string, unknown>>('board', {
		refused: (group) => refusals.push(...group),
	}).ready;

	const key = textIdOf(doomed);
	const mine = (b.tasks as typeof tasks).get(key)!;
	(a.tasks as typeof tasks).delete(key);
	mine.title = 'written after it was taken out';
	await settle();

	assert.equal(refusals.length, 1, 'the write was refused, once');
	assert.equal(refusals[0]!.reasons[0]!.code, 'unreachable');
	same(b, world.document, 'and the replica ends where the host is');
	one.close();
	two.close();
});

// A host that writes in answer to a client's commit is the action pattern the architecture
// prescribes: an intent goes into the document as state and a handler with wider authority
// writes the outcome. That write is published to the client before the batch it arrived in
// has finished, so the accept for the client's own commit has to be numbered where the commit
// is numbered, not held to the end. Held to the end, the client sees a hole in the topic
// stream that is not there, asks to start over, and never stops asking.
test('a host writing in answer to a commit does not put the sender out of step', async () => {
	const world = board();
	atomic(() => {
		world.document.intent = '';
		world.document.outcome = '';
	});
	// The handler with wider authority, on the host.
	observer(world.document).path('intent').watch(() => {
		world.document.outcome = `did ${String(world.document.intent)}`;
	});

	const session = world.client();
	const faults: string[] = [];
	const replica = session.join<Record<string, unknown>>('board', {
		fault: (reason) => faults.push(reason),
	});
	const mirror = await replica.ready;

	mirror.intent = 'ship it';
	await settle();

	// A client that cannot get anywhere gives up loudly rather than asking forever, so this
	// case fails rather than starving the machine when the ordering it rests on is broken.
	assert.deepStrictEqual(faults, [], 'it never had to ask for the document');
	assert.equal(world.document.outcome, 'did ship it', 'the host answered');
	assert.equal(mirror.outcome, 'did ship it', 'and the client heard the answer');
	assert.equal(replica.state.get(), 'live', 'without ever losing its place');
	same(mirror, world.document, 'in step');
	session.close();
});

// A commit a rebase gives up on has already been numbered, or is about to be. Taking it out of
// the pending list leaves a hole in the run, and the next frame arrives at the host as
// out-of-order, which ends the link and loses whatever was behind it with nothing reported.
test('a commit a rebase gives up on leaves no hole in what is sent', async () => {
	const document = createObject<Record<string, unknown>>();
	document.holder = createObject({});
	const host = serve(() => ({ document, policy: OPEN }), { replay: 0 });

	let cut: (() => void) | undefined;
	const session = connect(() => {
		const [there, here] = inProcess();
		cut = () => there.close();
		host.accept(there, { id: 'a' });
		return here;
	}, { retry: () => false });

	const refusals: Refused[] = [];
	const replica = session.join<Record<string, unknown>>('doc', {
		refused: (group) => refusals.push(...group),
	});
	const mirror = await replica.ready;

	// Two commits held while the link is down. The first cannot survive what the host does in
	// the meantime; the second can, and must not be lost with it.
	cut!();
	await settle(2);
	(mirror.holder as Record<string, unknown>).child = createObject({ n: 1 });
	mirror.y = 2;

	delete document.holder;
	await settle(2);

	session.reconnect();
	await settle();

	assert.equal(refusals.length, 1, 'the doomed one was reported');
	assert.equal(mirror.y, 2, 'and the one behind it survived');
	assert.equal(document.y, 2, 'and reached the host');
	assert.equal(replica.state.get(), 'live', 'the link is still up');
	same(mirror, document, 'both sides agree');
	session.close();
});

// One document under two policies would take whichever join arrived first, and every actor
// after that writes under a policy that was never resolved for them.
test('one document may not be served under two policies', async () => {
	const document = createObject<Record<string, unknown>>({ secret: 'kept' });
	const host = serve((_name, actor) => ({
		document,
		policy: actor.id === 'admin' ? 'trusted' : [{ effect: 'allow', path: ['pub'] }],
	}));

	const admin = connect(() => {
		const [there, here] = inProcess();
		host.accept(there, { id: 'admin' });
		return here;
	}, { retry: () => false });
	await admin.join('doc').ready;

	const faults: string[] = [];
	const other = connect(() => {
		const [there, here] = inProcess();
		host.accept(there, { id: 'mallory' });
		return here;
	}, { retry: () => false });
	const replica = other.join('doc', { fault: (reason) => faults.push(reason) });

	await assert.rejects(replica.ready, /policy-mismatch/);
	assert.deepStrictEqual(faults, ['policy-mismatch']);
	assert.equal(document.secret, 'kept');
	admin.close();
	other.close();
});

// A commit whose deltas all write what the slot already holds changes nothing, so the host
// publishes nothing for it. It was still decided, and a client that is never told waits on it
// forever: the replica reads `live` with work pending that will never clear.
test('a commit that changed nothing is still accepted', async () => {
	const world = board();
	world.document.n = 1;
	const session = world.client();
	const replica = session.join<Record<string, unknown>>('board');
	const mirror = await replica.ready;

	// Written on this side, so it is a real commit here and a no-op at the host.
	world.document.n = 2;
	await settle();
	mirror.n = 1;
	mirror.n = 2;
	await settle();

	assert.equal(replica.pending.get(), 0, 'both were decided, including the one that did nothing');
	same(mirror, world.document, 'and the two sides agree');
	session.close();
});

// The host forgets a client's numbering when that client joins as if it had never been here,
// so the client has to renumber what it is still holding. Otherwise its next frame states a
// sequence the host stopped expecting, the host ends the link, and everything behind it goes.
test('a replica that asks for the document renumbers what it still holds', async () => {
	const document = createObject<Record<string, unknown>>({ n: 0 });
	const host = serve(() => ({ document, policy: OPEN }), { replay: 0 });

	let drop = false;
	const session = connect(() => {
		const [there, here] = inProcess();
		host.accept({
			...there,
			send: (frame: Frame) => {
				if (drop && frame.kind === 'commits') return;
				there.send(frame);
			},
		}, { id: 'a' });
		return here;
	}, { retry: () => false });

	const replica = session.join<Record<string, unknown>>('doc');
	const mirror = await replica.ready;

	// Get the client's own numbering well past one, then make it lose the thread.
	for (let i = 1; i <= 20; i++) mirror.n = i;
	await settle();

	drop = true;
	document.other = 'while it was not listening';
	await settle(4);
	drop = false;
	mirror.n = 99;
	await settle();

	assert.equal(replica.state.get(), 'live', 'the link survived');
	assert.equal(document.n, 99, 'and the write after it got through');
	same(mirror, document, 'in step');
	session.close();
});
