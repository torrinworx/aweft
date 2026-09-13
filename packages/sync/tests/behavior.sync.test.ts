// The behavioral corpus for replication.
//
// Each case is a requirement this package must meet, and each is here because getting it
// wrong is a known way for a sync engine to lose data quietly. Append only: taking one out
// needs a design note.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MessageChannel } from 'node:worker_threads';
import { spawnSync } from 'node:child_process';

import { apply, atomic, createObject, idOf, observer, snapshot } from '@aweftjs/core';
import { canonicalJson, settle as settleRounds, socketPair } from '@aweftjs/testing';

// This suite settled for twenty rounds before the harness shipped one, and its convergence checks
// were tuned against that number rather than the harness's default of ten.
const settle = (rounds = 20): Promise<void> => settleRounds(rounds);
import {
	asCommit, connect, decodeFrame, encodeFrame, fromMessagePort, fromWebSocket, inProcess, track,
} from '@aweftjs/sync';
import type {
	Channel, Commit, Frame, PortLike, Refused, ShareHandlers, SocketLike, WireReason,
} from '@aweftjs/sync';

type Doc = Record<string, unknown>;


const same = (a: unknown, b: unknown, what: string): void => {
	assert.equal(canonicalJson(snapshot(a)), canonicalJson(snapshot(b)), what);
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

/** A channel that records what was put on it, so a case can say what did and did not go. */
const watched = (channel: Channel): { channel: Channel; sent: Frame[] } => {
	const sent: Frame[] = [];
	return {
		sent,
		channel: {
			send: (frame) => { sent.push(frame); channel.send(frame); },
			receive: (fn) => channel.receive(fn),
			closed: (fn) => channel.closed(fn),
			close: () => channel.close(),
		},
	};
};

/** A channel whose deliveries can be held, so a case can make one end fall behind. */
const gated = (channel: Channel): { channel: Channel; hold(): void; release(): void } => {
	const listeners = new Set<(frame: Frame) => void>();
	const queue: Frame[] = [];
	let flowing = true;

	const fire = (frame: Frame): void => {
		for (const fn of [...listeners]) fn(frame);
	};
	channel.receive((frame) => {
		if (flowing) fire(frame);
		else queue.push(frame);
	});

	return {
		hold: () => { flowing = false; },
		release: () => {
			flowing = true;
			while (queue.length > 0) fire(queue.shift()!);
		},
		channel: {
			send: (frame) => channel.send(frame),
			receive: (fn) => {
				listeners.add(fn);
				return () => { listeners.delete(fn); };
			},
			closed: (fn) => channel.closed(fn),
			close: () => channel.close(),
		},
	};
};

/** A second end holding the same document: the same root id, and the same state in it. */
const twin = (source: object): Doc => {
	const copy = createObject<Doc>(undefined, idOf(source));
	const whole = asCommit(source);
	if (whole !== undefined) apply(copy, whole);
	return copy;
};

// --- what `track` guarantees, which every link rests on ------------------------------------

// A watcher that writes in answer to an arriving commit is the ordinary way an application
// reacts to a change. Delivery is deferred, so that write is delivered inside the same drain
// as the commit that caused it: an engine that suppresses its own echo with a plain flag
// swallows it, and the reaction never leaves the machine.
test('a local write made in answer to an arriving commit still replicates', () => {
	const document = createObject<Doc>();
	const outgoing: Commit[] = [];
	const tracker = track(document, ({ commit, landed }) => {
		if (!landed) outgoing.push(commit);
	});

	observer(document).path('remote').watch(() => { document.reacted = true; });

	const source = twin(document);
	tracker.receive(oneCommit(source, () => { source.remote = 1; }));

	assert.equal(outgoing.length, 1, 'the reaction is a local commit and goes out');
	assert.equal(document.reacted, true);
	tracker.stop();
});

// A commit whose deltas all write what the slot already holds changes nothing, so nothing is
// delivered for it. An engine that assumes one delivery per receive is then one delivery out
// of step for the rest of its life, and the next genuinely local commit is swallowed.
test('a commit that changes nothing does not swallow the next local one', () => {
	const document = createObject<Doc>({ n: 1 });
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

// Two trackers on one document is what several networks on one document is made of, and the
// counting rule has to hold per tracker: a commit that lands through one is a local commit to
// the other. Design 055, at the layer that implements it.
test('a commit landing through one tracker is a local commit to a second one', () => {
	const document = createObject<Doc>();
	const first: Commit[] = [];
	const second: Commit[] = [];
	const one = track(document, ({ commit, landed }) => { if (!landed) first.push(commit); });
	const two = track(document, ({ commit, landed }) => { if (!landed) second.push(commit); });

	const source = twin(document);
	one.receive(oneCommit(source, () => { source.n = 1; }));

	assert.equal(first.length, 0, 'the tracker that applied it does not send it back');
	assert.equal(second.length, 1, 'and the other tracker ships it on');
	one.stop();
	two.stop();
});

// --- the handshake --------------------------------------------------------------------------

for (const [order, reversed] of [['shared here first', false], ['shared there first', true]] as const) {
	test(`the topic opens whichever end shares first: ${order}`, async () => {
		const here = createObject<Doc>({ title: 'plan' });
		const there = twin(here);
		const [x, y] = inProcess();
		const a = connect(x);
		const b = connect(y);

		if (reversed) {
			b.share('board', there);
			await settle(2);
			a.share('board', here);
		} else {
			a.share('board', here);
			await settle(2);
			b.share('board', there);
		}
		await settle();

		here.n = 1;
		await settle();
		assert.equal(there.n, 1, 'the topic is live whichever order the two shares happened in');
		a.close();
		b.close();
	});
}

// An end that holds nothing mints the document from the other end's root and asks for its
// state. Building a fresh root of its own instead would give it a different id, and every
// commit about the document would then be unreachable at one of the two ends.
test('an end that holds nothing is handed the document, and it is a live document', async () => {
	const source = createObject<Doc>();
	atomic(() => {
		source.title = 'plan';
		source.child = createObject({ n: 1 });
	});

	const [x, y] = inProcess();
	const a = connect(x);
	const b = connect(y);
	a.share('board', source);
	const shared = b.share<Doc>('board');

	assert.equal(shared.document, undefined, 'there is nothing until the other end says what it is');
	const document = await shared.ready;
	await settle();

	same(document, source, 'the whole document arrived');
	source.title = 'plan b';
	await settle();
	assert.equal(document.title, 'plan b', 'and it goes on receiving');
	(document.child as Doc).n = 2;
	await settle();
	assert.equal((source.child as Doc).n, 2, 'and sending');
	a.close();
	b.close();
});

// A resynchronization moves the document rather than replacing it (design 044). Everything
// holding the old tree would otherwise be pointing at something nothing writes to any more,
// and nothing would say so.
test('state moves the document rather than replacing it, root and children alike', async () => {
	const source = createObject<Doc>();
	atomic(() => {
		source.title = 'plan';
		source.child = createObject({ n: 1 });
	});

	const [x, y] = inProcess();
	const a = connect(x);
	const b = connect(y);
	a.share('board', source);
	const shared = b.share<Doc>('board');
	const document = await shared.ready;
	await settle();

	const root = document;
	const child = document.child as Doc;

	source.title = 'moved on';
	(source.child as Doc).n = 7;
	await settle();
	shared.resync();
	await settle();

	assert.equal(shared.document, root, 'the root is the same object');
	assert.equal(document.child, child, 'and so is the nested observable');
	assert.equal(child.n, 7, 'which now says what the other end says');
	same(document, source, 'the whole document agrees');
	a.close();
	b.close();
});

// Commits made before the other end has opened are not lost. They are also not sent twice:
// an end that asked for state is sent the state, which already says everything they did.
test('commits made before the topic is live go when it goes live', async () => {
	const here = createObject<Doc>({ n: 0 });
	const there = twin(here);
	const [x, y] = inProcess();
	const seen = watched(x);
	const a = connect(seen.channel);
	const b = connect(y);

	a.share('board', here);
	here.n = 1;
	here.n = 2;
	await settle(2);
	b.share('board', there);
	await settle();

	assert.equal(there.n, 2, 'both of them arrived');
	const commits = seen.sent.filter((frame) => frame.kind === 'commits');
	assert.equal(commits.length, 1, 'in one frame, because they were made in one tick');
	assert.equal(commits[0]!.kind === 'commits' && commits[0]!.commits.length, 2);
	a.close();
	b.close();
});

test('commits made before the topic is live are not sent when the other end wanted state', async () => {
	const here = createObject<Doc>({ n: 0 });
	const [x, y] = inProcess();
	const seen = watched(x);
	const a = connect(seen.channel);
	const b = connect(y);

	a.share('board', here);
	here.n = 1;
	await settle(2);
	const shared = b.share<Doc>('board');
	const there = await shared.ready;
	await settle();

	assert.equal(seen.sent.filter((f) => f.kind === 'commits').length, 0,
		'nothing was sent as a commit');
	assert.equal(seen.sent.filter((f) => f.kind === 'state').length, 1, 'the state covered it');
	assert.equal(there.n, 1, 'and it arrived');
	a.close();
	b.close();
});

// --- refusals ------------------------------------------------------------------------------

/** Refuse a commit that writes the named slot, which is a node's own rule and nobody else's. */
const refuseSlot = (key: string): ShareHandlers['accept'] => (commit) =>
	commit.deltas.some((delta) => delta.ref.kind === 'object' && delta.ref.key === key)
		? [{ code: 'not-here', message: `${key} is not written at this end`, path: [key] }]
		: [];

test('a refusal from accept is reported at both ends, and the commit beside it still applies', async () => {
	const here = createObject<Doc>({ ok: '', no: '' });
	const there = twin(here);
	const [x, y] = inProcess();
	const a = connect(x);
	const b = connect(y);

	const mine: Refused[] = [];
	const theirs: Refused[] = [];
	a.share('board', here, { refused: (report) => mine.push(report) });
	b.share('board', there, {
		accept: refuseSlot('no'),
		refused: (report) => theirs.push(report),
	});
	await settle();

	// One tick, so both commits travel in one frame and the second is behind the refused one.
	here.no = 'refused';
	here.ok = 'kept';
	await settle();

	assert.equal(theirs.length, 1, 'the end that refused it heard about it');
	assert.equal(theirs[0]!.mine, false, 'as a commit that arrived here');
	assert.equal(theirs[0]!.reasons[0]!.code, 'not-here');
	assert.deepEqual(theirs[0]!.reasons[0]!.path, ['no']);
	assert.notEqual(theirs[0]!.commit, undefined, 'with the commit it refused');

	assert.equal(mine.length, 1, 'and so did the end that sent it');
	assert.equal(mine[0]!.mine, true, 'as a commit of its own');
	assert.equal(mine[0]!.seq, theirs[0]!.seq, 'about the same commit');
	assert.notEqual(mine[0]!.commit, undefined, 'with the commit');
	assert.notEqual(mine[0]!.undo, undefined, 'and the commit that undoes it');

	assert.equal(there.no, '', 'the refused write never landed');
	assert.equal(there.ok, 'kept', 'and the commit behind it in the frame still did');
	a.close();
	b.close();
});

// The applier refuses for its own reasons, and the report carries the applier's own word for
// it, so the two layers never disagree about the cause.
test('a refusal from the applier is reported at both ends, by the name the applier gave it', async () => {
	const here = createObject<Doc>();
	here.holder = createObject<Doc>({ n: 1 });

	const [x, y] = inProcess();
	const gate = gated(y);
	const a = connect(x);
	const b = connect(gate.channel);
	const mine: Refused[] = [];
	const theirs: Refused[] = [];
	a.share('board', here, { refused: (report) => mine.push(report) });
	const shared = b.share<Doc>('board', undefined, { refused: (report) => theirs.push(report) });
	const there = await shared.ready;
	await settle();
	same(there, here, 'both ends hold the document to start with');

	// One end stops hearing, so it writes into something the other has taken out.
	gate.hold();
	delete here.holder;
	await settle(2);
	(there.holder as Doc).n = 2;
	await settle();

	assert.equal(mine.length, 1, 'the end that could not apply it reported it');
	assert.equal(mine[0]!.mine, false);
	assert.equal(mine[0]!.reasons[0]!.code, 'unreachable', 'by the applier own name for it');
	assert.notEqual(mine[0]!.commit, undefined, 'with the commit that would not apply');

	// The refusal is on its way back while that end is still behind, and it arrives with it.
	gate.release();
	await settle();

	assert.equal(theirs.length, 1, 'and the end that sent it heard the same');
	assert.equal(theirs[0]!.mine, true);
	assert.equal(theirs[0]!.reasons[0]!.code, 'unreachable');
	assert.notEqual(theirs[0]!.undo, undefined, 'with the commit that undoes it');
	assert.equal(there.holder, undefined, 'and the removal it had not heard yet landed');

	a.close();
	b.close();
});

// The window is what makes a refusal reportable with its commit at all. It is bounded because
// a link that kept every commit it ever sent grows for as long as it runs.
test('a refusal past the window is reported with its sequence and nothing else', async () => {
	const here = createObject<Doc>({ n: 0, no: '' });
	const there = twin(here);
	const [x, y] = inProcess();
	const a = connect(x, { window: 2 });
	const b = connect(y);

	const mine: Refused[] = [];
	a.share('board', here, { refused: (report) => mine.push(report) });
	b.share('board', there, { accept: refuseSlot('no') });
	await settle();

	here.no = 'first';           // sequence 1, refused, and long gone from a window of two
	for (let i = 0; i < 4; i++) here.n = i;
	await settle();
	here.no = 'last';            // the newest commit, still held
	await settle();

	assert.equal(mine.length, 2, 'both refusals were reported');
	assert.equal(mine[0]!.seq, 1);
	assert.equal(mine[0]!.commit, undefined, 'the first is past the window');
	assert.equal(mine[0]!.undo, undefined);
	assert.notEqual(mine[1]!.commit, undefined, 'the last is still in it');
	assert.notEqual(mine[1]!.undo, undefined);
	a.close();
	b.close();
});

// --- faults -----------------------------------------------------------------------------

test('two documents that are not one document fault at both ends and never go live', async () => {
	const here = createObject<Doc>({ title: 'mine' });
	const there = createObject<Doc>({ title: 'theirs' });
	const [x, y] = inProcess();
	const a = connect(x);
	const b = connect(y);

	const faults: string[] = [];
	a.share('board', here, { fault: (reason) => faults.push(`a:${reason}`) });
	b.share('board', there, { fault: (reason) => faults.push(`b:${reason}`) });
	await settle();

	assert.deepEqual(faults.sort(), ['a:root-mismatch', 'b:root-mismatch']);
	here.n = 1;
	await settle();
	assert.equal(there.n, undefined, 'and nothing crossed');
	a.close();
	b.close();
});

test('a frame about a topic nothing is open under is answered with a fault, and the link carries on', async () => {
	const here = createObject<Doc>({ n: 0 });
	const [x, y] = inProcess();
	const a = connect(x);
	a.share('board', here);

	const heard: Frame[] = [];
	y.receive((frame) => heard.push(frame));
	y.send({ kind: 'commits', topic: 99, first: 1, commits: [{
		deltas: [{ type: 'replace', id: idOf(here), ref: { kind: 'object', key: 'n' }, value: 5 }],
	}] });
	await settle();

	const fault = heard.find((frame) => frame.kind === 'fault');
	assert.notEqual(fault, undefined, 'it said so');
	assert.equal(fault!.kind === 'fault' && fault!.reason, 'no-topic');
	assert.equal(fault!.kind === 'fault' && fault!.topic, 99, 'naming the number the sender used');
	assert.equal(here.n, 0, 'and applied nothing');
	assert.notEqual(heard.find((frame) => frame.kind === 'open'), undefined,
		'the link carried on, and the topic that is open is still open');
	a.close();
});

// A state answers an open that wanted one. Applied when this end did not ask, it would move the
// document past `accept` from the other end, which is the one rule an end must not get around.
test('a state this end did not ask for is refused with a fault, applies nothing, and ends the topic', async () => {
	const here = createObject<Doc>({ n: 0, items: 'kept' });
	const [x, y] = inProcess();
	const a = connect(x);
	const faults: string[] = [];
	a.share('board', here, {
		accept: () => [{ code: 'read-only', message: 'this end writes, the other reads' }],
		fault: (reason, message) => faults.push(`${reason}:${message}`),
	});
	const heard: Frame[] = [];
	y.receive((frame) => heard.push(frame));
	// The other end pairs holding a copy of its own, and wants nothing.
	y.send({ kind: 'open', topic: 7, name: 'board', root: { id: idOf(here), kind: 'object' }, want: false });
	await settle();
	assert.equal(faults.length, 0, 'paired');

	// Then it sends a state as though this end had asked: an empty one, which would wipe the document.
	y.send({ kind: 'state', topic: 7 });
	await settle();

	assert.equal(here.n, 0, 'nothing was applied');
	assert.equal(here.items, 'kept');
	const fault = heard.find((frame) => frame.kind === 'fault');
	assert.equal(fault?.kind === 'fault' && fault.reason, 'unwanted-state', 'the other end is told');
	assert.equal(fault?.kind === 'fault' && fault.topic, 7, 'by the number it used');
	assert.equal(faults.length, 1, 'and so is this end');
	assert.ok(faults[0]!.startsWith('unwanted-state:'), faults[0]);

	// A commit after the fault is about a topic that is no longer open.
	y.send({ kind: 'commits', topic: 7, first: 1, commits: [{ deltas: [{ type: 'replace', id: idOf(here), ref: { kind: 'object', key: 'n' }, value: 5 }] }] });
	await settle();
	assert.equal(here.n, 0);
	assert.equal(heard.filter((frame) => frame.kind === 'fault' && frame.reason === 'no-topic').length, 1, 'the topic ended');
	a.close();
});

test('an end told its topic is not open there hears it as a fault', async () => {
	const here = createObject<Doc>({ n: 0 });
	const [x, y] = inProcess();
	const a = connect(x);
	const faults: string[] = [];
	a.share('board', here, { fault: (reason, message) => faults.push(`${reason}:${message}`) });
	await settle();

	y.send({ kind: 'fault', topic: 1, reason: 'no-topic', message: 'nothing is open as topic 1' });
	await settle();

	assert.equal(faults.length, 1);
	assert.ok(faults[0]!.startsWith('no-topic:'), faults[0]);
	a.close();
});

test('leaving a topic ends it at the other end too, and the link stays up for the rest', async () => {
	const here = createObject<Doc>({ n: 0 });
	const there = twin(here);
	const other = createObject<Doc>({ n: 0 });
	const otherThere = twin(other);

	const [x, y] = inProcess();
	const a = connect(x);
	const b = connect(y);
	const faults: string[] = [];
	const leaving = a.share('one', here);
	a.share('two', other);
	b.share('one', there, { fault: (reason) => faults.push(reason) });
	b.share('two', otherThere);
	await settle();

	leaving.stop();
	await settle();
	assert.deepEqual(faults, ['left'], 'the other end was told');

	here.n = 1;
	other.n = 1;
	await settle();
	assert.equal(there.n, 0, 'the topic that left carries nothing');
	assert.equal(otherThere.n, 1, 'and the other topic on the same link is untouched');
	a.close();
	b.close();
});

// --- conflicts ---------------------------------------------------------------------------

// Two ends replacing one slot at the same moment end up swapped, and stay swapped until an
// application on one side yields. The link never picks the winner (design 054).
test('a same-slot conflict leaves the two swapped, and resync is how one end yields', async () => {
	const here = createObject<Doc>({ title: 'start' });
	const there = twin(here);
	const [x, y] = inProcess();
	const a = connect(x);
	const b = connect(y);
	const mine = a.share('board', here);
	b.share('board', there);
	await settle();

	here.title = 'from here';
	there.title = 'from there';
	await settle();

	assert.equal(here.title, 'from there');
	assert.equal(there.title, 'from here');
	assert.notEqual(here.title, there.title, 'swapped, and the link chose nothing');

	mine.resync();
	await settle();
	assert.equal(here.title, 'from here', 'the end that yielded took the other end state');
	same(here, there, 'and the two agree');
	a.close();
	b.close();
});

// The ordinary way an application reacts to a change is to write in answer to it. That write
// has to replicate, and it must not come back around as an arriving commit.
test('a watcher that writes in answer to an arriving commit replicates once and does not loop', async () => {
	const here = createObject<Doc>();
	atomic(() => {
		here.from = '';
		here.echo = '';
	});
	const there = twin(here);
	const [x, y] = inProcess();
	const seen = watched(y);
	const a = connect(x);
	const b = connect(seen.channel);
	a.share('board', here);
	const shared = b.share('board', there);
	await shared.ready;
	await settle();

	observer(there).path('from').watch(() => { there.echo = `heard ${String(there.from)}`; });
	const before = seen.sent.length;

	here.from = 'the other end';
	await settle();

	assert.equal(there.echo, 'heard the other end', 'the answer was made');
	assert.equal(here.echo, 'heard the other end', 'and replicated');
	assert.equal(seen.sent.length - before, 1, 'once, and nothing came back around');
	a.close();
	b.close();
});

// --- several networks on one document, design 055 -----------------------------------------

test('a commit arriving over one link is sent over every other link on that document', async () => {
	const middle = createObject<Doc>({ n: 0 });
	const left = twin(middle);
	const right = twin(middle);

	const [lx, ly] = inProcess();
	const [rx, ry] = inProcess();
	const toLeft = watched(lx);
	const hub = connect(toLeft.channel);
	const hubRight = connect(rx);
	const leftLink = connect(ly);
	const rightLink = connect(ry);

	hub.share('board', middle);
	hubRight.share('board', middle);
	leftLink.share('board', left);
	rightLink.share('board', right);
	await settle();

	// A plain watcher on the document hears an arriving commit like any other change.
	const heard: number[] = [];
	observer(middle).path('n').watch(() => heard.push(middle.n as number));

	const before = toLeft.sent.filter((frame) => frame.kind === 'commits').length;
	left.n = 5;
	await settle();

	assert.equal(middle.n, 5, 'it landed in the middle');
	assert.equal(right.n, 5, 'and went on over the other link');
	assert.deepEqual(heard, [5], 'and an ordinary watcher heard it once');
	assert.equal(toLeft.sent.filter((frame) => frame.kind === 'commits').length, before,
		'and nothing went back to the end it came from');

	hub.close();
	hubRight.close();
	leftLink.close();
	rightLink.close();
});

test('a chain of three ends converges, and the middle one is just an end of two links', async () => {
	const first = createObject<Doc>({ a: 0, b: 0, c: 0 });
	const middle = twin(first);
	const last = twin(first);

	const [p, q] = inProcess();
	const [r, s] = inProcess();
	const one = connect(p);
	const two = connect(q);
	const three = connect(r);
	const four = connect(s);
	one.share('board', first);
	two.share('board', middle);
	three.share('board', middle);
	four.share('board', last);
	await settle();

	first.a = 1;
	middle.b = 2;
	last.c = 3;
	await settle();

	same(first, middle, 'the first two agree');
	same(middle, last, 'and so do the last two');
	assert.equal(last.a, 1, 'a write at one end of the chain reached the other');
	assert.equal(first.c, 3, 'and back again');
	one.close();
	two.close();
	three.close();
	four.close();
});

test('one link carries three documents at once, each with its own numbering', async () => {
	const names = ['one', 'two', 'three'];
	const here = names.map(() => createObject<Doc>({ n: 0 }));
	const there = here.map(twin);

	const [x, y] = inProcess();
	const a = connect(x);
	const b = connect(y);
	here.forEach((document, at) => a.share(names[at]!, document));
	there.forEach((document, at) => b.share(names[at]!, document));
	await settle();

	here.forEach((document, at) => { document.n = at + 1; });
	await settle();

	there.forEach((document, at) => {
		assert.equal(document.n, at + 1, `${names[at]} carried its own commits`);
	});
	a.close();
	b.close();
});

// --- the same protocol on every transport ---------------------------------------------------

const transports: Record<string, () => [Channel, Channel]> = {
	'in process': () => inProcess(),
	'a message port': () => {
		const pair = new MessageChannel();
		return [
			fromMessagePort(pair.port1 as unknown as PortLike),
			fromMessagePort(pair.port2 as unknown as PortLike),
		];
	},
	'a socket': () => {
		const [left, right] = socketPair();
		return [fromWebSocket(left), fromWebSocket(right)];
	},
};

for (const [what, build] of Object.entries(transports)) {
	test(`the same protocol over ${what}: share, converge, refuse`, async () => {
		const here = createObject<Doc>();
		atomic(() => {
			here.title = 'plan';
			here.sealed = 'held here';
		});

		const [x, y] = build();
		const a = connect(x);
		const b = connect(y);
		const reports: Refused[] = [];
		a.share('board', here, {
			accept: refuseSlot('sealed'),
			refused: (report) => reports.push(report),
		});
		const shared = b.share<Doc>('board', undefined, { refused: (report) => reports.push(report) });
		const there = await shared.ready;
		await settle();
		same(there, here, `${what}: the document crossed whole`);

		here.title = 'from here';
		there.n = 1;
		await settle();
		same(there, here, `${what}: concurrent commuting edits converge`);

		there.sealed = 'written from there';
		await settle();
		assert.equal(here.sealed, 'held here', `${what}: the refused write never landed`);
		assert.equal(reports.length, 2, `${what}: and both ends heard about it`);
		assert.deepEqual(reports.map((report) => report.mine).sort(), [false, true]);

		a.close();
		b.close();
	});
}

// A frame is a value on one transport and bytes on another, and it is one protocol either
// way: what an in-process link hands over is what a socket writes.
test('a frame carried as bytes says what the same frame carried as a value says', () => {
	const document = createObject<Doc>({ n: 1 });
	const frame: Frame = {
		kind: 'open', topic: 1, name: 'board',
		root: { id: idOf(document), kind: 'object' }, want: true,
	};
	assert.deepStrictEqual(decodeFrame(encodeFrame(frame)), frame);
});

// A reason an application invents rides across unchanged, because `accept` is the node's own
// rule and the protocol does not know what it checks.
test('a reason from accept crosses whole: code, message and path', async () => {
	const here = createObject<Doc>({ no: '' });
	const there = twin(here);
	const [x, y] = inProcess();
	const a = connect(x);
	const b = connect(y);

	const reason: WireReason = { code: 'over-budget', message: 'the total is 12', path: ['no'] };
	const mine: Refused[] = [];
	a.share('board', here, { refused: (report) => mine.push(report) });
	b.share('board', there, { accept: () => [reason] });
	await settle();

	here.no = 'anything';
	await settle();
	assert.deepEqual(mine[0]!.reasons, [reason], 'unchanged, whatever the application put in it');
	a.close();
	b.close();
});

test('a throw out of accept is a refusal, reported at both ends, and the rest of the frame still applies', async () => {
	const [a, b] = inProcess();
	const source = createObject<Doc>({ n: 0 });
	const copy = createObject<Doc>(undefined, idOf(source));
	const heard: Refused[] = [];
	const left = connect(a);
	const right = connect(b);
	left.share('doc', source, { refused: (r) => heard.push(r) });
	right.share('doc', copy, {
		accept: (commit) => {
			if (commit.deltas.some((d) => d.ref.kind === 'object' && d.ref.key === 'boom')) throw new Error('the rule broke');
			return [];
		},
		refused: (r) => heard.push(r),
	});
	await settle();

	source.first = 1;
	source.boom = 2;
	source.last = 3;
	await settle();

	assert.equal(copy.first, 1, 'the commit before the throw applied');
	assert.equal(copy.boom, undefined, 'the commit the rule threw on did not');
	assert.equal(copy.last, 3, 'the commit after it still applied');
	assert.deepEqual(heard.map((r) => [r.mine, r.reasons[0]!.code]).sort(), [[false, 'accept-threw'], [true, 'accept-threw']]);
	assert.match(heard[0]!.reasons[0]!.message, /the rule broke/);
	left.close();
});

test('a watcher that throws while a commit lands is the application\'s error, and the rest of the frame still applies', () => {
	// An uncaught exception cannot be observed from inside the test runner, so the scenario
	// runs in a child process that reports what it saw.
	const child = spawnSync(process.execPath, [new URL('./watcher-throws.ts', import.meta.url).pathname], { encoding: 'utf8' });
	assert.equal(child.status, 0, child.stderr);
	assert.deepEqual(JSON.parse(child.stdout.trim()), {
		first: 1, boom: 2, last: 3, raised: ['a watcher broke'],
	});
});

test('two ends that both share a name with no document fault each other rather than waiting forever', async () => {
	const [a, b] = inProcess();
	const faults: string[] = [];
	const left = connect(a).share<Doc>('empty', undefined, { fault: (reason) => faults.push(reason) });
	const right = connect(b).share<Doc>('empty', undefined, { fault: (reason) => faults.push(reason) });
	await settle();
	assert.deepEqual(faults, ['no-document', 'no-document']);
	await assert.rejects(left.ready, { reason: 'no-document' });
	await assert.rejects(right.ready, { reason: 'no-document' });
});

test('an end with nothing can share first or second, and gets the document either way', async () => {
	for (const emptyFirst of [true, false]) {
		const [a, b] = inProcess();
		const source = createObject<Doc>({ n: 7 });
		const left = connect(a);
		const right = connect(b);
		const shares = emptyFirst
			? [right.share<Doc>('doc'), left.share('doc', source)]
			: [left.share('doc', source), right.share<Doc>('doc')];
		const minted = await (emptyFirst ? shares[0] : shares[1])!.ready as Doc;
		assert.equal(minted.n, 7, `the minted end has the state, empty end ${emptyFirst ? 'first' : 'second'}`);
		source.n = 8;
		await settle();
		assert.equal(minted.n, 8);
		left.close();
	}
});
