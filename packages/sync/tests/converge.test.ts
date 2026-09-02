import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ANY, REST, type Policy } from '@aweftjs/schema';
import { atomic, createMap, createObject, isReachable, snapshot, textIdOf } from '@aweftjs/core';
import { canonicalJson, randomBelow, randomFrom } from '@aweftjs/testing';
import { connect, inProcess, serve } from '@aweftjs/sync';
import type { Channel, Refused, Session } from '@aweftjs/sync';

// Everything under `tasks` and `notes` is fair game; `sealed` belongs to nobody, so a client
// that writes it produces a real refusal in the middle of everything else.
const POLICY: Policy = [
	{ effect: 'allow', path: ['tasks', REST] },
	{ effect: 'allow', path: ['notes', ANY] },
	{ effect: 'allow', path: ['counter'] },
];

const settle = async (rounds: number): Promise<void> => {
	for (let i = 0; i < rounds; i++) await new Promise((done) => setTimeout(done, 0));
};

interface Peer {
	readonly session: Session;
	readonly replica: ReturnType<Session['join']>;
	document: Record<string, unknown>;
	readonly refused: Refused[];
	cut(): void;
}

const board = () => {
	const document = createObject<Record<string, unknown>>();
	atomic(() => {
		document.tasks = createMap<Record<string, unknown>>();
		document.notes = createObject<Record<string, unknown>>();
		document.counter = 0;
		document.sealed = 'nobody writes this';
	});
	return { document, host: serve(() => ({ document, policy: POLICY })) };
};

const peer = (host: ReturnType<typeof serve>, id: string): Peer => {
	let live: Channel | undefined;
	const refused: Refused[] = [];

	const session = connect(() => {
		const [there, here] = inProcess();
		live = there;
		host.accept(there, { id });
		return here;
	}, { retry: () => 0 });

	const replica = session.join<Record<string, unknown>>('board', {
		refused: (group) => refused.push(...group),
	});

	return {
		session, replica, refused,
		get document() {
			return replica.document as Record<string, unknown>;
		},
		set document(_) {},
		cut: () => { live?.close(); },
	};
};

/** Every reachable task on this replica, so an edit picks one that is still there. */
const tasksOf = (doc: Record<string, unknown>): Record<string, unknown>[] => {
	const tasks = doc.tasks as { values(): Record<string, unknown>[] } | undefined;
	return tasks === undefined ? [] : tasks.values().filter((task) => isReachable(task));
};

const edit = (
	rng: () => number, doc: Record<string, unknown>, round: number, mayWriteSealed = false,
): void => {
	const roll = randomBelow(rng, 100);
	const tasks = doc.tasks as {
		add(o: object): void; delete(k: unknown): boolean; values(): Record<string, unknown>[];
	};
	const notes = doc.notes as Record<string, unknown>;
	const live = tasksOf(doc);

	if (roll < 22 || live.length === 0) {
		tasks.add(createObject({ title: `t${round}`, done: false, weight: randomBelow(rng, 50) }));
	} else if (roll < 32) {
		tasks.delete(textIdOf(live[randomBelow(rng, live.length)]!));
	} else if (roll < 55) {
		live[randomBelow(rng, live.length)]!.title = `edited ${round}`;
	} else if (roll < 68) {
		live[randomBelow(rng, live.length)]!.done = randomBelow(rng, 2) === 1;
	} else if (roll < 78) {
		atomic(() => {
			const task = live[randomBelow(rng, live.length)]!;
			task.weight = randomBelow(rng, 50);
			task.touched = round;
		});
	} else if (roll < 88) {
		notes[`n${randomBelow(rng, 6)}`] = `note ${round}`;
	} else if (roll < 94) {
		doc.counter = round;
	} else if (!mayWriteSealed) {
		// Refused every time, for a client. It runs beside everything else on purpose: a
		// rollback has to leave the commits around it alone.
		doc.sealed = `attempt ${round}`;
	} else {
		doc.counter = round;
	}
};

/** Run until nothing is pending anywhere and the links have gone quiet. */
const quiesce = async (peers: readonly Peer[]): Promise<void> => {
	for (let i = 0; i < 400; i++) {
		await settle(2);
		if (peers.every((p) => p.replica.pending.get() === 0 && p.replica.state.get() === 'live')) {
			await settle(4);
			if (peers.every((p) => p.replica.pending.get() === 0)) return;
		}
	}
	assert.fail('the replicas never went quiet');
};

const run = async (seed: number, rounds: number, cuts: boolean): Promise<void> => {
	const rng = randomFrom(seed);
	const { document, host } = board();
	const peers = ['a', 'b', 'c'].map((id) => peer(host, id));
	for (const p of peers) await p.replica.ready;

	for (let round = 0; round < rounds; round++) {
		const writers = 1 + randomBelow(rng, peers.length);
		for (let i = 0; i < writers; i++) {
			const who = peers[randomBelow(rng, peers.length)]!;
			try {
				edit(rng, who.document, round);
			} catch {
				// Writing into something another replica took out throws locally, exactly as it
				// would in an application. Nothing about replication is involved.
			}
		}

		if (randomBelow(rng, 100) < 20) {
			try {
				// The host owns the document, so no policy is consulted for its own writes. It
				// leaves `sealed` alone so the assertion below is about clients.
				edit(rng, document, round, true);
			} catch { /* same, on the host's own document */ }
		}

		if (cuts && randomBelow(rng, 100) < 12) peers[randomBelow(rng, peers.length)]!.cut();

		if (randomBelow(rng, 100) < 25) await settle(1 + randomBelow(rng, 3));
	}

	await quiesce(peers);

	const truth = canonicalJson(snapshot(document));
	for (const p of peers) {
		assert.equal(canonicalJson(snapshot(p.document)), truth, `replica converged (seed ${seed})`);
	}
	assert.notEqual(document.sealed, undefined, 'the sealed slot is untouched');
	assert.equal(document.sealed, 'nobody writes this');
	assert.ok(
		peers.some((p) => p.refused.length > 0),
		'the run actually produced refusals, so the rollback path was exercised',
	);

	for (const p of peers) p.session.close();
	host.close();
};

// The property the whole package rests on: whatever order three replicas and a host write in,
// they all end at what the host says. The seeds are committed, so a failure repeats exactly.
for (const seed of [20260902, 424242, 7]) {
	test(`three replicas converge under concurrent edits, seed ${seed}`, async () => {
		await run(seed, 120, false);
	});
}

for (const seed of [20260902, 909090]) {
	test(`three replicas converge with the link cut under them, seed ${seed}`, async () => {
		await run(seed, 120, true);
	});
}
