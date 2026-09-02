// What replication costs, on the shipped code.
//
// Every performance claim in `packages/sync/README.md` and in decision designs 041 to 043
// comes from here. Run: node bench/replicate.ts
//
// CI does not gate on this.

import { gzipSync } from 'node:zlib';

import { decodeCommit, encodeCommit, encodeValue } from '@aweftjs/codec';
import type { Commit } from '@aweftjs/codec';
import {
	atomic, createArray, createMap, createObject, idOf, insertAt, observer, positionsOf, textIdOf,
} from '@aweftjs/core';
import { REST, type Policy } from '@aweftjs/schema';
import {
	connect, decodeFrame, encodeFrame, inProcess, serve, track,
} from '@aweftjs/sync';
import type { Frame } from '@aweftjs/sync';
import { randomBelow, randomFrom } from '@aweftjs/testing';

const OPEN: Policy = [{ effect: 'allow', path: [REST] }];
const WORDS = ['plan', 'draft', 'ship', 'review', 'fix', 'test', 'write', 'read', 'merge'];

/** A board-shaped edit stream: a map of tasks, an array of columns, the edits a client makes. */
const buildStream = (edits: number, seed = 20260902): Commit[] => {
	const rng = randomFrom(seed);
	const doc = createObject<Record<string, unknown>>();
	const commits: Commit[] = [];
	observer(doc).watch((change) => commits.push({ deltas: [...change.deltas] }));

	const tasks = createMap<Record<string, unknown>>();
	const columns = createArray<string>();
	atomic(() => { doc.tasks = tasks; doc.columns = columns; doc.title = 'board'; });

	const live: Record<string, unknown>[] = [];
	for (let i = 0; i < edits; i++) {
		const roll = randomBelow(rng, 100);
		if (roll < 20 || live.length < 4) {
			const task = createObject<Record<string, unknown>>({
				title: WORDS[randomBelow(rng, WORDS.length)]!, done: false, weight: randomBelow(rng, 100),
			});
			tasks.add(task);
			live.push(task);
		} else if (roll < 30) {
			const at = randomBelow(rng, live.length);
			tasks.delete(textIdOf(live[at]!));
			live.splice(at, 1);
		} else if (roll < 40) {
			columns.push(WORDS[randomBelow(rng, WORDS.length)]!);
		} else if (roll < 45 && columns.length > 0) {
			columns.splice(randomBelow(rng, columns.length), 1);
		} else if (roll < 70) {
			live[randomBelow(rng, live.length)]!.title = `${WORDS[randomBelow(rng, WORDS.length)]} ${i}`;
		} else if (roll < 85) {
			live[randomBelow(rng, live.length)]!.done = randomBelow(rng, 2) === 1;
		} else {
			const task = live[randomBelow(rng, live.length)]!;
			atomic(() => { task.weight = randomBelow(rng, 100); task.touched = i; });
		}
	}
	return commits;
};

const time = (name: string, runs: number, fn: () => void): void => {
	fn();
	const t0 = process.hrtime.bigint();
	for (let i = 0; i < runs; i++) fn();
	const us = Number(process.hrtime.bigint() - t0) / runs / 1000;
	console.log(`  ${name.padEnd(44)} ${us.toFixed(3)} us`);
};

const cat = (parts: Uint8Array[]): Uint8Array => {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const part of parts) { out.set(part, at); at += part.length; }
	return out;
};

const commits = buildStream(2000);
const bodies = commits.map((commit) => encodeCommit(commit));
const raw = bodies.reduce((n, b) => n + b.length, 0);
console.log(`${commits.length} commits, ${commits.reduce((n, c) => n + c.deltas.length, 0)} deltas, ${raw} bytes of commit`);

// --- the envelope, design 042 -------------------------------------------------------------

console.log('\nframing, against the commit bytes alone');
const report = (name: string, frames: Uint8Array[]): void => {
	const total = frames.reduce((n, f) => n + f.length, 0);
	const perFrame = frames.reduce((n, f) => n + gzipSync(f).length, 0);
	const stream = gzipSync(cat(frames)).length;
	console.log(
		`  ${name.padEnd(34)} ${String(total).padStart(7)} raw  ` +
		`${`${((total / raw - 1) * 100).toFixed(1)}%`.padStart(7)}  ` +
		`${String(perFrame).padStart(7)} gz/frame  ${String(stream).padStart(6)} gz/stream  ${frames.length} frames`,
	);
};

report('commit bytes alone', bodies);
for (const size of [1, 4, 16, 64]) {
	const frames: Frame[] = [];
	for (let i = 0; i < commits.length; i += size) {
		frames.push({ kind: 'commits', topic: 0, first: i + 1, commits: commits.slice(i, i + size) });
	}
	report(`${String(size).padStart(2)} commit(s) per frame`, frames.map(encodeFrame));
}
// The measurement behind "the topic is a number, not a string".
report('topic named on every frame', commits.map((commit, i) =>
	encodeValue([2, 'board:42', i + 1, [encodeCommit(commit)]]) as Uint8Array));

// --- frames or bytes, design 041 ----------------------------------------------------------

console.log('\ncarrying one commit across a link');
const one = commits[Math.floor(commits.length / 2)]!;
const frame: Frame = { kind: 'commits', topic: 0, first: 1, commits: [one] };
time('handed over as a frame (in process)', 20000, () => { const f = frame; if (f.kind !== 'commits') throw 0; });
time('encoded and decoded as bytes', 20000, () => { decodeFrame(encodeFrame(frame)); });
time('structured-cloned as a commit', 20000, () => { structuredClone(one); });
time('encoded, cloned, decoded', 20000, () => { decodeCommit(structuredClone(encodeCommit(one))); });

// --- the rebase, design 043 ---------------------------------------------------------------

console.log('\nundo, apply, redo, by how many commits are pending');
for (const depth of [0, 1, 4, 16]) {
	const doc = createObject<Record<string, unknown>>();
	doc.base = 0;
	const undos: Commit[] = [];
	const redos: Commit[] = [];
	const tracker = track(doc, ({ commit, undo, landed }) => {
		if (landed) return;
		redos.push(commit);
		undos.push(undo);
	});
	for (let i = 0; i < depth; i++) doc[`pending${i}`] = i;

	// One commit arriving from elsewhere, replacing a slot the document already holds.
	const arriving = (value: number): Commit => ({
		deltas: [{ type: 'replace', id: idOf(doc), ref: { kind: 'object', key: 'base' }, value }],
	});
	let flip = 0;

	time(`${String(depth).padStart(2)} pending`, 20000, () => {
		for (let i = undos.length - 1; i >= 0; i--) tracker.receive(undos[i]!);
		flip = 1 - flip;
		tracker.receive(arriving(flip));
		for (const commit of redos) tracker.receive(commit);
	});
	tracker.stop();
}

// --- array positions, design 040 ----------------------------------------------------------

console.log('\narray position keys, four-byte levels of a digit and three random bytes');
const keys = (build: (list: number[]) => void, count: number): Uint8Array[] => {
	const list = createArray<number>([0, 9]);
	for (let i = 0; i < count; i++) build(list);
	return positionsOf(list);
};
for (const [what, build, count] of [
	['2,000 appends', (list: number[]) => { list.push(0); }, 2000],
	['2,000 prepends', (list: number[]) => { list.unshift(0); }, 2000],
	['500 inserts between one pair', (list: number[]) => { list.splice(1, 0, 0); }, 500],
] as const) {
	const made = keys(build, count);
	const longest = Math.max(...made.map((k) => k.length));
	const mean = made.reduce((n, k) => n + k.length, 0) / made.length;
	console.log(`  ${what.padEnd(44)} ${String(longest).padStart(3)} bytes longest, ${mean.toFixed(1)} mean`);
}
// Two replicas of one array, each inserting at the same place with the same neighbours.
const source = createArray<number>([0, 9]);
const bounds = positionsOf(source);
const chosen = new Set<string>();
for (let replica = 0; replica < 1000; replica++) {
	const copy = createArray<number>();
	insertAt(copy, bounds[0]!, 0);
	insertAt(copy, bounds[1]!, 9);
	copy.splice(1, 0, 1);
	chosen.add([...positionsOf(copy)[1]!].join(','));
}
console.log(`  ${'1,000 replicas inserting at one place'.padEnd(44)} ${chosen.size} distinct slots`);

// --- end to end -------------------------------------------------------------------------

const roundTrip = async (): Promise<void> => {
	const document = createObject<Record<string, unknown>>({ n: 0 });
	const host = serve(() => ({ document, policy: OPEN }));
	const session = connect(() => {
		const [there, here] = inProcess();
		host.accept(there, { id: 'a' });
		return here;
	}, { retry: () => false });

	const mirror = await session.join<Record<string, unknown>>('doc').ready;
	const rounds = 20000;

	const t0 = process.hrtime.bigint();
	for (let i = 1; i <= rounds; i++) mirror.n = i;
	while (document.n !== rounds) await new Promise((done) => setTimeout(done, 0));
	const us = Number(process.hrtime.bigint() - t0) / rounds / 1000;

	console.log(`\nend to end, one client to a host with a policy`);
	console.log(`  ${'commit written, sent, validated, applied'.padEnd(44)} ${us.toFixed(3)} us`);
	session.close();
	host.close();
};

await roundTrip();
