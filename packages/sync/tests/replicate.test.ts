import { test } from 'node:test';
import assert from 'node:assert/strict';

import { REST, type Policy } from '@aweftjs/schema';
import { atomic, createArray, createMap, createObject, idOf, snapshot } from '@aweftjs/core';
import { canonicalJson } from '@aweftjs/testing';
import { connect, inProcess, serve } from '@aweftjs/sync';
import type { Session } from '@aweftjs/sync';

const OPEN: Policy = [{ effect: 'allow', path: [REST] }];
const now = (): number | false => 0;

/** Let every queued microtask and timer settle, so a link has finished talking. */
const settle = async (rounds = 12): Promise<void> => {
	for (let i = 0; i < rounds; i++) await new Promise((done) => setTimeout(done, 0));
};

const same = (a: unknown, b: unknown, what: string): void => {
	assert.equal(canonicalJson(snapshot(a)), canonicalJson(snapshot(b)), what);
};

interface World {
	readonly host: ReturnType<typeof serve>;
	readonly document: Record<string, unknown>;
	client(id?: string): Session;
}

const world = (policy: Policy | 'trusted' = OPEN): World => {
	const document = createObject<Record<string, unknown>>();
	const host = serve((name) => (name === 'board' ? { document, policy } : undefined));
	return {
		host,
		document,
		client: (id = 'a') => connect(() => {
			const [there, here] = inProcess();
			host.accept(there, { id });
			return here;
		}, { retry: now }),
	};
};

test('a replica with nothing is handed the document', async () => {
	const { document, client } = world();
	atomic(() => {
		document.title = 'plan';
		document.tasks = createArray<object>([createObject({ title: 'a' })]);
	});

	const replica = client().join<Record<string, unknown>>('board');
	const mirror = await replica.ready;

	same(mirror, document, 'the replica holds what the host holds');
	assert.equal(replica.state.get(), 'live');
});

test('a local change reaches the host, and the host reaches every other replica', async () => {
	const { document, client } = world();
	document.title = 'plan';

	const one = client('a').join<Record<string, unknown>>('board');
	const two = client('b').join<Record<string, unknown>>('board');
	const [a, b] = [await one.ready, await two.ready];

	a.title = 'plan b';
	await settle();

	assert.equal(document.title, 'plan b', 'the host took it');
	assert.equal(b.title, 'plan b', 'the other replica has it');
	assert.equal(one.pending.get(), 0, 'and it is no longer pending');
});

test('a change on the host reaches every replica', async () => {
	const { document, client } = world();
	document.title = 'plan';
	const replica = client().join<Record<string, unknown>>('board');
	const mirror = await replica.ready;

	atomic(() => {
		document.title = 'from the host';
		document.extra = 1;
	});
	await settle();

	same(mirror, document, 'the replica followed');
});

test('a whole subtree built and attached in one commit crosses whole', async () => {
	const { document, client } = world();
	document.ready = true;
	const replica = client().join<Record<string, unknown>>('board');
	const mirror = await replica.ready;

	atomic(() => {
		document.settings = createObject({ theme: 'dark', limit: 5 });
	});
	await settle();

	same(mirror, document, 'the subtree arrived with its slots');
});

test('two replicas writing at once both end up at what the host says', async () => {
	const { document, client } = world();
	atomic(() => { document.left = 0; document.right = 0; });

	const one = client('a').join<Record<string, unknown>>('board');
	const two = client('b').join<Record<string, unknown>>('board');
	const [a, b] = [await one.ready, await two.ready];

	for (let i = 1; i <= 10; i++) {
		a.left = i;
		b.right = i;
	}
	await settle();

	same(a, document, 'the first replica converged');
	same(b, document, 'the second replica converged');
	assert.equal(document.left, 10);
	assert.equal(document.right, 10);
});

test('a commit the policy refuses is rolled back and reported with its prior values', async () => {
	const document = createObject<Record<string, unknown>>();
	atomic(() => { document.mine = 'a'; document.theirs = 'b'; });

	const policy: Policy = [{ effect: 'allow', path: ['mine'] }];
	const host = serve(() => ({ document, policy }));
	const [there, here] = inProcess();
	host.accept(there, { id: 'a' });

	const refusals: unknown[] = [];
	const replica = connect(() => here, { retry: now })
		.join<Record<string, unknown>>('board', { refused: (group) => refusals.push(...group) });
	const mirror = await replica.ready;

	mirror.mine = 'edited';
	mirror.theirs = 'not allowed';
	await settle();

	assert.equal(mirror.mine, 'edited', 'the allowed change stayed');
	assert.equal(mirror.theirs, 'b', 'the refused change was rolled back');
	assert.equal(document.theirs, 'b', 'and never reached the host');
	assert.equal(refusals.length, 1, 'one refusal reported');

	const refused = refusals[0] as { reasons: { code: string }[]; undo: { deltas: unknown[] } };
	assert.equal(refused.reasons[0]!.code, 'unauthorized');
	assert.ok(refused.undo.deltas.length > 0, 'the prior values came with it');
});

test('a commit written on top of a doomed one is refused with it, as one group', async () => {
	const document = createObject<Record<string, unknown>>();
	document.mine = 'a';

	const policy: Policy = [{ effect: 'allow', path: ['mine', REST] }];
	const host = serve(() => ({ document, policy }));
	const [there, here] = inProcess();
	host.accept(there, { id: 'a' });

	const groups: number[] = [];
	const replica = connect(() => here, { retry: now })
		.join<Record<string, unknown>>('board', { refused: (group) => groups.push(group.length) });
	const mirror = await replica.ready;

	// The first is refused; the second only makes sense if the first landed.
	const child = createObject<Record<string, unknown>>({ n: 1 });
	mirror.nope = child;
	child.n = 2;
	await settle();

	assert.equal(mirror.nope, undefined, 'the refused attach is gone');
	assert.equal(groups.length, 1, 'one group, not one event per commit');
	assert.equal(groups[0], 2, 'the dependent commit came with it');
});

test('a topic the host does not serve is a fault, and ready rejects', async () => {
	const { client } = world();
	const faults: string[] = [];
	const replica = client().join('nothing', { fault: (reason) => faults.push(reason) });

	await assert.rejects(replica.ready, /no-topic/);
	await settle();
	assert.deepStrictEqual(faults, ['no-topic']);
	assert.equal(replica.state.get(), 'failed');
});

test('a trusted topic runs with no policy and no index', async () => {
	const document = createObject<Record<string, unknown>>({ n: 0 });
	const host = serve(() => ({ document, policy: 'trusted' }));
	const [there, here] = inProcess();
	host.accept(there, { id: 'a' });

	const replica = connect(() => here, { retry: now }).join<Record<string, unknown>>('x');
	const mirror = await replica.ready;
	mirror.n = 7;
	await settle();

	assert.equal(document.n, 7);
});

test('one session carries several documents at once', async () => {
	const board = createObject<Record<string, unknown>>({ kind: 'board' });
	const chat = createObject<Record<string, unknown>>({ kind: 'chat' });
	const host = serve((name) => {
		if (name === 'board') return { document: board, policy: OPEN };
		if (name === 'chat') return { document: chat, policy: OPEN };
		return undefined;
	});
	const [there, here] = inProcess();
	host.accept(there, { id: 'a' });

	const session = connect(() => here, { retry: now });
	const one = session.join<Record<string, unknown>>('board');
	const two = session.join<Record<string, unknown>>('chat');
	const [a, b] = [await one.ready, await two.ready];

	assert.equal(a.kind, 'board');
	assert.equal(b.kind, 'chat');

	a.note = 'x';
	b.note = 'y';
	await settle();
	assert.equal(board.note, 'x');
	assert.equal(chat.note, 'y');
	assert.equal(host.connections, 1, 'one connection for both');
});

test('leaving one topic leaves the others alone', async () => {
	const { document, client } = world();
	document.n = 0;
	const session = client();
	const replica = session.join<Record<string, unknown>>('board');
	const mirror = await replica.ready;

	replica.leave();
	await settle();
	document.n = 5;
	await settle();

	assert.equal(mirror.n, 0, 'no longer following');
	assert.equal(replica.state.get(), 'left');
});

test('a document handed in is synced in place rather than replaced', async () => {
	const { document, client } = world();
	document.title = 'plan';

	const mine = createObject<Record<string, unknown>>(undefined, idOf(document));
	const replica = client().join('board', { document: mine });
	assert.equal(replica.document, mine, 'the document is the one handed in, immediately');

	await replica.ready;
	assert.equal(mine.title, 'plan', 'and it was filled in, not swapped');
	assert.equal(replica.document, mine);
});

test('a map keyed by identity replicates', async () => {
	const { document, client } = world();
	const people = createMap<object>();
	document.people = people;
	const replica = client().join<Record<string, unknown>>('board');
	const mirror = await replica.ready;

	people.add(createObject({ name: 'x' }));
	await settle();
	same(mirror, document, 'the map entry crossed');
});
