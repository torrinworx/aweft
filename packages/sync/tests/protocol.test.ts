// The host, driven by hand-built frames, the way a second implementation would drive it.
//
// Everything here is about what a host does with a frame it did not expect. The rule the
// cases hold it to comes from design 012: a refusal refuses the commit and never the link,
// and only a frame that makes no sense ends one.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createId } from '@aweftjs/codec';
import type { Commit } from '@aweftjs/codec';
import { REST, type Policy } from '@aweftjs/schema';
import { atomic, createArray, createMap, createObject, idOf, observer } from '@aweftjs/core';
import { inProcess, serve } from '@aweftjs/sync';
import type { Channel, Frame } from '@aweftjs/sync';

const OPEN: Policy = [{ effect: 'allow', path: [REST] }];
const tick = async (rounds = 4): Promise<void> => {
	for (let i = 0; i < rounds; i++) await new Promise((done) => setTimeout(done, 0));
};

interface Wire {
	readonly heard: Frame[];
	readonly channel: Channel;
	readonly document: Record<string, unknown>;
	send(frame: Frame): Promise<void>;
	ended(): boolean;
}

const wire = (
	build: () => Record<string, unknown> = () => createObject<Record<string, unknown>>({ n: 0 }),
	policy: Policy | 'trusted' = OPEN,
): Wire => {
	const document = build();
	const host = serve((name) => (name === 'doc' ? { document, policy } : undefined));
	const [there, here] = inProcess();
	host.accept(there, { id: 'a' });

	const heard: Frame[] = [];
	let over = false;
	here.receive((frame) => heard.push(frame));
	here.closed(() => { over = true; });

	return {
		heard, channel: here, document,
		send: async (frame) => {
			here.send(frame);
			await tick();
		},
		ended: () => over,
	};
};

const joinFrame = (topic = 0, name = 'doc', have = 0): Frame =>
	({ kind: 'join', topic, name, have });

const setSlot = (id: Uint8Array, key: string, value: string): Commit =>
	({ deltas: [{ type: 'replace', id, ref: { kind: 'object', key }, value }] });

test('a join is answered with the document and a session to resume with', async () => {
	const link = wire();
	await link.send(joinFrame());

	const joined = link.heard[0];
	assert.equal(joined?.kind, 'joined');
	assert.ok(joined.kind === 'joined');
	assert.equal(joined.accepted, 0);
	assert.deepStrictEqual(joined.root, { id: idOf(link.document), kind: 'object' });
	assert.ok(joined.session.length > 0, 'a session id to come back with');
	assert.ok(joined.reset !== undefined, 'and the document');
});

test('an empty document is joined with no reset, because a commit carries at least one delta', async () => {
	const link = wire(() => createObject<Record<string, unknown>>());
	await link.send(joinFrame());
	const joined = link.heard[0];
	assert.ok(joined?.kind === 'joined');
	assert.equal(joined.reset, undefined);
	assert.equal(link.ended(), false);
});

test('a root of each kind is named as the kind it is', async () => {
	for (const [build, kind] of [
		[() => createObject<Record<string, unknown>>(), 'object'],
		[() => createArray() as unknown as Record<string, unknown>, 'array'],
		[() => createMap() as unknown as Record<string, unknown>, 'map'],
	] as const) {
		const link = wire(build);
		await link.send(joinFrame());
		const joined = link.heard[0];
		assert.ok(joined?.kind === 'joined');
		assert.equal(joined.root.kind, kind);
	}
});

test('a name the host does not serve is refused, and the link stays up', async () => {
	const link = wire();
	await link.send(joinFrame(0, 'nothing'));

	assert.deepStrictEqual(link.heard.map((f) => f.kind), ['fault']);
	assert.equal(link.ended(), false, 'a join that is turned away is an answer, not a violation');

	await link.send(joinFrame(1, 'doc'));
	assert.equal(link.heard[1]?.kind, 'joined', 'and another topic still works');
});

test('one topic number for two names is refused without ending the link', async () => {
	const document = createObject<Record<string, unknown>>({ n: 0 });
	const other = createObject<Record<string, unknown>>({ n: 1 });
	const host = serve((name) => ({ document: name === 'doc' ? document : other, policy: OPEN }));
	const [there, here] = inProcess();
	host.accept(there, { id: 'a' });
	const heard: Frame[] = [];
	let over = false;
	here.receive((frame) => heard.push(frame));
	here.closed(() => { over = true; });

	here.send(joinFrame(0, 'doc'));
	await tick();
	here.send(joinFrame(0, 'another'));
	await tick();

	const fault = heard[heard.length - 1];
	assert.ok(fault?.kind === 'fault');
	assert.equal(fault.reason, 'topic-in-use');
	assert.equal(over, false);
});

test('joining a topic this connection already holds starts it again', async () => {
	const link = wire();
	await link.send(joinFrame());
	link.heard.length = 0;

	// This is a client saying it lost the thread. It is not a mistake, and it must not end
	// the link or leave the topic without a member.
	await link.send(joinFrame(0, 'doc', 0));
	const joined = link.heard.find((f) => f.kind === 'joined');
	assert.ok(joined?.kind === 'joined');
	assert.equal(link.ended(), false);

	link.heard.length = 0;
	link.document.n = 5;
	await tick();
	assert.ok(link.heard.some((f) => f.kind === 'commits'), 'and the topic still has a member');
});

test('a rejoin from before what the host still holds is sent the document again', async () => {
	const document = createObject<Record<string, unknown>>({ n: 0 });
	const host = serve(() => ({ document, policy: OPEN }), { replay: 0 });
	const [there, here] = inProcess();
	host.accept(there, { id: 'a' });
	const heard: Frame[] = [];
	here.receive((frame) => heard.push(frame));

	here.send(joinFrame());
	await tick();
	document.n = 1;
	await tick();
	heard.length = 0;

	here.send(joinFrame(0, 'doc', 0));
	await tick();
	const joined = heard.find((f) => f.kind === 'joined');
	assert.ok(joined?.kind === 'joined');
	assert.ok(joined.reset !== undefined, 'nothing was kept, so the whole document came');
	assert.equal(joined.seq, 1, 'and it says where that leaves the client');
});

test('a commit for a topic that was never joined ends the link', async () => {
	const link = wire();
	await link.send({ kind: 'commits', topic: 3, first: 1, commits: [setSlot(createId(), 'n', 'x')] });

	const fault = link.heard[0];
	assert.ok(fault?.kind === 'fault');
	assert.equal(fault.reason, 'no-such-topic');
	assert.equal(link.ended(), true);
});

test('a sequence number out of order ends the link', async () => {
	const link = wire();
	await link.send(joinFrame());
	await link.send({
		kind: 'commits', topic: 0, first: 7,
		commits: [setSlot(idOf(link.document), 'n', 'x')],
	});

	const fault = link.heard[link.heard.length - 1];
	assert.ok(fault?.kind === 'fault');
	assert.equal(fault.reason, 'out-of-order');
	assert.ok(fault.message.includes('1'), 'and says what it was expecting');
	assert.equal(link.ended(), true);
});

test('a frame only a client is ever sent ends the link', async () => {
	const link = wire();
	await link.send(joinFrame());
	await link.send({ kind: 'accept', topic: 0, through: 1, at: 1 });

	const fault = link.heard[link.heard.length - 1];
	assert.ok(fault?.kind === 'fault');
	assert.equal(fault.reason, 'not-for-a-host');
	assert.equal(link.ended(), true);
});

test('a commit the applier will not take is refused by name, and the next one still applies', async () => {
	const link = wire();
	await link.send(joinFrame());

	const id = idOf(link.document);
	await link.send({
		kind: 'commits', topic: 0, first: 1,
		commits: [
			// `add` on a slot that is already taken. The applier's own word for it is slot-exists.
			{ deltas: [{ type: 'add', id, ref: { kind: 'object', key: 'n' }, value: 1 }] },
			setSlot(id, 'n', 'after the refusal'),
		],
	});

	const refuse = link.heard.find((f) => f.kind === 'refuse');
	assert.ok(refuse?.kind === 'refuse');
	assert.equal(refuse.seq, 1);
	assert.equal(refuse.reasons[0]!.code, 'slot-exists');
	assert.equal(link.ended(), false, 'a refusal never ends a link');
	assert.equal(link.document.n, 'after the refusal', 'and the one after it applied');

	const accept = link.heard.find((f) => f.kind === 'accept');
	assert.ok(accept?.kind === 'accept');
	assert.equal(accept.through, 2);
});

test('a refusal from the policy names the path it was about', async () => {
	const link = wire(
		() => createObject<Record<string, unknown>>({ n: 0 }),
		[{ effect: 'allow', path: ['other'] }],
	);
	await link.send(joinFrame());
	await link.send({
		kind: 'commits', topic: 0, first: 1, commits: [setSlot(idOf(link.document), 'n', 'nope')],
	});

	const refuse = link.heard.find((f) => f.kind === 'refuse');
	assert.ok(refuse?.kind === 'refuse');
	assert.equal(refuse.reasons[0]!.code, 'unauthorized');
	assert.deepStrictEqual(refuse.reasons[0]!.path, ['n']);
});

test('leaving stops the frames without ending the link', async () => {
	const link = wire();
	await link.send(joinFrame());
	const before = link.heard.length;

	await link.send({ kind: 'leave', topic: 0 });
	link.document.n = 99;
	await tick();

	assert.equal(link.heard.length, before, 'nothing more arrived');
	assert.equal(link.ended(), false);
});

test('a host whose resolve throws says so and ends that link only', async () => {
	const host = serve(() => { throw new Error('the database is down'); });
	const [there, here] = inProcess();
	host.accept(there, { id: 'a' });

	const heard: Frame[] = [];
	here.receive((frame) => heard.push(frame));
	here.send(joinFrame());
	await tick();

	const fault = heard[0];
	assert.ok(fault?.kind === 'fault');
	assert.equal(fault.reason, 'host-error');
	assert.ok(fault.message.includes('the database is down'));
});

test('a policy that cannot mean what it says is refused when the topic is first reached', async () => {
	const document = createObject<Record<string, unknown>>({ n: 0 });
	const host = serve(() => ({ document, policy: [{ effect: 'allow', path: [] }] }));
	const [there, here] = inProcess();
	host.accept(there, { id: 'a' });

	const heard: Frame[] = [];
	here.receive((frame) => heard.push(frame));
	here.send(joinFrame());
	await tick();

	const fault = heard[0];
	assert.ok(fault?.kind === 'fault');
	assert.equal(fault.reason, 'bad-pattern', 'and it says which rule cannot mean what it says');
});

test('two names for one document are one topic, and a write on either reaches both', async () => {
	const document = createObject<Record<string, unknown>>({ n: 0 });
	const host = serve(() => ({ document, policy: OPEN }));

	const links = ['a', 'b'].map((id) => {
		const [there, here] = inProcess();
		host.accept(there, { id });
		const heard: Frame[] = [];
		here.receive((frame) => heard.push(frame));
		return { here, heard };
	});

	links[0]!.here.send({ kind: 'join', topic: 0, name: 'one', have: 0 });
	links[1]!.here.send({ kind: 'join', topic: 0, name: 'another', have: 0 });
	await tick();

	links[0]!.here.send({
		kind: 'commits', topic: 0, first: 1, commits: [setSlot(idOf(document), 'n', 'written')],
	});
	await tick();

	assert.equal(document.n, 'written');
	assert.ok(
		links[1]!.heard.some((f) => f.kind === 'commits'),
		'the other name saw it, because it is the same document',
	);
	assert.ok(
		!links[0]!.heard.some((f) => f.kind === 'commits'),
		'and the sender was not handed back its own work',
	);
});

test('a host mutating its own document publishes it, in the order it happened', async () => {
	const link = wire();
	await link.send(joinFrame());
	link.heard.length = 0;

	atomic(() => {
		link.document.a = 1;
		link.document.b = 2;
	});
	link.document.c = 3;
	await tick();

	const commits = link.heard.filter((f) => f.kind === 'commits');
	assert.equal(commits.length, 1, 'one tick is one frame');
	assert.ok(commits[0]!.kind === 'commits');
	assert.equal(commits[0]!.first, 1);
	assert.equal(commits[0]!.commits.length, 2, 'an atomic block is one commit and the write is another');
	assert.equal(commits[0]!.commits[0]!.deltas.length, 2);
});

test('a join turned away for any reason leaves the link up', async () => {
	// Design 012 and `spec/replication.md` 2: a join that is refused is an answer, not a
	// protocol violation. All four reasons, not just the two that are easy.
	// A document per case: one that lingers under a second host would confuse what is being
	// measured here, which is only whether the link survives.
	const build = (): [Record<string, unknown>, string, Parameters<typeof serve>[0]][] => {
		const a = createObject<Record<string, unknown>>({ n: 0 });
		const b = createObject<Record<string, unknown>>({ n: 0 });
		const c = createObject<Record<string, unknown>>({ n: 0 });
		return [
			[a, 'no-topic', (name) => (name === 'good' ? { document: a, policy: OPEN } : undefined)],
			[b, 'bad-pattern', (name) => ({
				document: name === 'good' ? b : createObject({}),
				policy: name === 'good' ? OPEN : [{ effect: 'allow', path: [] }],
			})],
			[c, 'policy-mismatch', (name) => ({
				document: c,
				policy: name === 'good' ? OPEN : [{ effect: 'allow', path: ['other'] }],
			})],
		];
	};

	for (const [good, reason, resolve] of build()) {
		const host = serve(resolve);
		const [there, here] = inProcess();
		host.accept(there, { id: 'a' });
		const heard: Frame[] = [];
		let over = false;
		here.receive((frame) => heard.push(frame));
		here.closed(() => { over = true; });

		here.send(joinFrame(0, 'good'));
		await tick();
		here.send(joinFrame(1, 'bad'));
		await tick();

		const fault = heard.find((f) => f.kind === 'fault');
		assert.ok(fault?.kind === 'fault', `${reason}: a fault came back`);
		assert.equal(fault.reason, reason);
		assert.equal(over, false, `${reason}: and the link is still up`);

		// The topic that was fine still works afterwards.
		heard.length = 0;
		good.n = 1;
		await tick();
		assert.ok(heard.some((f) => f.kind === 'commits'), `${reason}: the other topic carried on`);
		host.close();
	}
});

test('one link may not sync one document under two numbers', async () => {
	// Every commit on one would be published to the other, applied, and published back. It is
	// a caller's mistake, and left alone it is a silent permanent spin.
	const document = createObject<Record<string, unknown>>({ n: 0 });
	const host = serve(() => ({ document, policy: OPEN }));
	const [there, here] = inProcess();
	host.accept(there, { id: 'a' });
	const heard: Frame[] = [];
	let over = false;
	here.receive((frame) => heard.push(frame));
	here.closed(() => { over = true; });

	here.send(joinFrame(0, 'one'));
	await tick();
	here.send(joinFrame(1, 'another'));
	await tick();

	const fault = heard.find((f) => f.kind === 'fault');
	assert.ok(fault?.kind === 'fault');
	assert.equal(fault.reason, 'document-in-use');
	assert.equal(over, false, 'refused, not fatal');

	heard.length = 0;
	document.n = 1;
	await tick();
	const commits = heard.filter((f) => f.kind === 'commits');
	assert.equal(commits.length, 1, 'one write reaches this link once');
	host.close();
});

test('a host lets go of a document nothing is syncing or can come back to', async () => {
	const made: Record<string, unknown>[] = [];
	const host = serve((name) => {
		const document = createObject<Record<string, unknown>>({ name });
		made.push(document);
		return { document, policy: OPEN };
	}, { sessions: 1 });

	// A host whose resolve opens a document per name is the shape the README shows.
	const links = [];
	for (let i = 0; i < 5; i++) {
		const [there, here] = inProcess();
		host.accept(there, { id: 'a' });
		here.send(joinFrame(0, `room:${i}`));
		await tick();
		links.push(there);
	}
	assert.equal(made.length, 5, 'five documents were opened');

	// Everyone leaves. One session is remembered, so one document is held for it.
	for (const there of links) there.close();
	await tick();

	// Whether the tracker was let go is the observable part: a document nothing holds no longer
	// pays for a watch on every write to it.
	const watched = made.filter((document) => {
		let heard = false;
		const stop = observer(document).path('probe').watch(() => { heard = true; });
		document.probe = 1;
		stop();
		return heard;
	});
	assert.equal(watched.length, 5, 'the documents themselves still work; the host simply let go');

	const [there, here] = inProcess();
	host.accept(there, { id: 'a' });
	const heard: Frame[] = [];
	here.receive((frame) => heard.push(frame));
	here.send(joinFrame(0, 'room:0'));
	await tick();
	const joined = heard.find((f) => f.kind === 'joined');
	assert.ok(joined?.kind === 'joined');
	assert.equal(joined.seq, 0, 'a released document is served fresh, from the top');
	host.close();
});
