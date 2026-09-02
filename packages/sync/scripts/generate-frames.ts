// The frame fixture corpus.
//
// Each fixture states two things independently: the frame, and the array `spec/replication.md`
// section 6 says that frame is written as. The bytes come from the codec's value encoder,
// which has its own independently anchored corpus, applied to the stated array. So a fixture
// never takes its expected value from `encodeFrame`; it takes it from the spec's table, and
// generation fails when the two disagree.
//
// Run: npm run frames

import { mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
	type WireValue, bytesFromHex, bytesToHex, decodeCommit, encodeCommit, encodeValue,
} from '@aweftjs/codec';
import { decodeFrame, encodeFrame } from '../src/index.ts';
import type { Frame } from '../src/index.ts';

// AWEFT_FRAMES points generation somewhere else, which is how the gate regenerates into a
// scratch directory and compares against what is committed.
const here = process.env['AWEFT_FRAMES']
	?? join(import.meta.dirname, '..', '..', '..', 'spec', 'frames');

const ID = bytesFromHex('0102030405060708090a0b0c');
const OTHER = bytesFromHex('1112131415161718191a1b1c');

const commit = { deltas: [{ type: 'add', id: ID, ref: { kind: 'object', key: 'title' }, value: 'plan' }] } as const;
const second = { deltas: [{ type: 'remove', id: ID, ref: { kind: 'object', key: 'gone' } }] } as const;

/** A frame, and the array section 6 states it is written as. Both written by hand. */
interface Case {
	readonly name: string;
	readonly note: string;
	readonly frame: Frame;
	readonly wire: readonly WireValue[];
}

const cases: Case[] = [
	{
		name: '001-join',
		note: 'A first join: the name rides here and on no other frame, and there is no session yet.',
		frame: { kind: 'join', topic: 0, name: 'board:42', have: 0 },
		wire: [0, 0, 'board:42', 0, null],
	},
	{
		name: '002-join-resume',
		note: 'A rejoin: the topic number is the client\'s to choose, and the session came from a joined.',
		frame: { kind: 'join', topic: 3, name: 'board:42', have: 17, resume: OTHER },
		wire: [0, 3, 'board:42', 17, OTHER],
	},
	{
		name: '003-joined-with-reset',
		note: 'The answer that carries the document: root id and kind, then the whole thing as one commit.',
		frame: {
			kind: 'joined', topic: 0, accepted: 0, seq: 4, whole: true, session: ID,
			root: { id: ID, kind: 'object' }, reset: commit,
		},
		wire: [1, 0, 0, 4, true, ID, ID, 0, encodeCommit(commit)],
	},
	{
		name: '004-joined-resumed',
		note: 'A resume the host could answer from what it still holds: not whole, and seq is the have.',
		frame: {
			kind: 'joined', topic: 2, accepted: 9, seq: 17, whole: false, session: OTHER,
			root: { id: ID, kind: 'map' },
		},
		wire: [1, 2, 9, 17, false, OTHER, ID, 2, null],
	},
	{
		name: '005-commits',
		note: 'Two commits in one frame, numbered from the first. Batching is not rate limiting.',
		frame: { kind: 'commits', topic: 1, first: 5, commits: [commit, second] },
		wire: [2, 1, 5, [encodeCommit(commit), encodeCommit(second)]],
	},
	{
		name: '006-accept',
		note: 'Decided through client sequence 12, which landed at topic sequence 30.',
		frame: { kind: 'accept', topic: 0, through: 12, at: 30 },
		wire: [3, 0, 12, 30],
	},
	{
		name: '007-refuse',
		note: 'One reason per refused delta. A path is present when the refusing side could decide it.',
		frame: {
			kind: 'refuse', topic: 0, seq: 4,
			reasons: [
				{ code: 'unauthorized', message: 'users/x/verified is not granted', path: ['users', 'x', 'verified'] },
				{ code: 'unreachable', message: 'AQIDBAUGBwgJCgsM has no attach path from the root' },
			],
		},
		wire: [4, 0, 4, [
			['unauthorized', 'users/x/verified is not granted', ['users', 'x', 'verified']],
			['unreachable', 'AQIDBAUGBwgJCgsM has no attach path from the root', null],
		]],
	},
	{
		name: '008-leave',
		note: 'Done with this topic. The link stays up for the others.',
		frame: { kind: 'leave', topic: 7 },
		wire: [5, 7],
	},
	{
		name: '009-fault',
		note: 'A join turned away. This one does not end the link; a frame that made no sense would.',
		frame: { kind: 'fault', topic: 0, reason: 'no-topic', message: 'nothing is served as board:42' },
		wire: [6, 0, 'no-topic', 'nothing is served as board:42'],
	},
];

/** Inputs that must be refused, each naming the reason it is refused for. */
const invalid: { name: string; note: string; wire: WireValue; reason: string }[] = [
	{ name: '001-not-an-array', note: 'A frame is an array.', wire: 'join', reason: 'bad-frame' },
	{ name: '002-empty', note: 'And a non-empty one.', wire: [], reason: 'bad-frame' },
	{ name: '003-unknown-kind', note: 'Seven kinds, and nothing else.', wire: [99, 0], reason: 'bad-frame' },
	{ name: '004-wrong-arity', note: 'An accept has four elements.', wire: [3, 0, 1], reason: 'bad-frame' },
	{ name: '005-topic-not-a-number', note: 'A topic is the number agreed at the join.', wire: [5, 'board'], reason: 'bad-frame' },
	{ name: '006-empty-commits', note: 'A commits frame carries at least one commit.', wire: [2, 0, 1, []], reason: 'bad-frame' },
	{ name: '007-empty-reasons', note: 'A refuse carries at least one reason.', wire: [4, 0, 1, []], reason: 'bad-frame' },
	{ name: '008-unknown-root-kind', note: 'Three observable kinds, and nothing else.', wire: [1, 0, 0, 0, true, ID, ID, 9, null], reason: 'bad-frame' },
	{ name: '010-whole-not-a-boolean', note: 'Whether a frame describes the whole document is a yes or a no.', wire: [1, 0, 0, 0, 'yes', ID, ID, 0, null], reason: 'bad-frame' },
	{ name: '009-reason-path-not-text', note: 'A path is text steps or nothing.', wire: [4, 0, 1, [['a', 'b', [1]]]], reason: 'bad-frame' },
];

/** A frame as plain JSON: bytes in hex, commits in hex, so a fixture is readable. */
const frameToJson = (frame: Frame): unknown =>
	JSON.parse(JSON.stringify(frame, (_, value) => {
		if (value instanceof Uint8Array) return bytesToHex(value);
		if (Array.isArray(value) && value.length === 0) return value;
		return value;
	}));

const wireToJson = (value: WireValue): unknown => {
	if (value instanceof Uint8Array) return { hex: bytesToHex(value) };
	if (Array.isArray(value)) return value.map(wireToJson);
	return value;
};

mkdirSync(here, { recursive: true });
for (const name of readdirSync(here)) unlinkSync(join(here, name));

for (const item of cases) {
	const bytes = encodeValue(item.wire) as Uint8Array;
	const written = encodeFrame(item.frame);

	if (bytesToHex(written) !== bytesToHex(bytes)) {
		throw new Error(`${item.name}: the encoder writes ${bytesToHex(written)}, the spec says ${bytesToHex(bytes)}`);
	}
	const back = encodeFrame(decodeFrame(bytes));
	if (bytesToHex(back) !== bytesToHex(bytes)) {
		throw new Error(`${item.name}: decoding and re-encoding does not reproduce the bytes`);
	}

	writeFileSync(join(here, `${item.name}.json`), `${JSON.stringify({
		note: item.note,
		frame: frameToJson(item.frame),
		wire: item.wire.map(wireToJson),
		bytes: bytesToHex(bytes),
	}, null, '\t')}\n`);
}

for (const item of invalid) {
	const bytes = encodeValue(item.wire) as Uint8Array;
	let refused: string | undefined;
	try {
		decodeFrame(bytes);
	} catch (error) {
		refused = (error as { reason?: string }).reason;
	}
	if (refused !== item.reason) {
		throw new Error(`${item.name}: refused for ${String(refused)}, not ${item.reason}`);
	}

	writeFileSync(join(here, `invalid-${item.name}.json`), `${JSON.stringify({
		note: item.note,
		reason: item.reason,
		bytes: bytesToHex(bytes),
	}, null, '\t')}\n`);
}

// The commit inside a fixture has to be a commit, not just bytes that decode.
decodeCommit(encodeCommit(commit));

console.log(`frames: ${cases.length} fixtures, ${invalid.length} rejections`);
