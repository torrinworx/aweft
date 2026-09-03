// The frame fixture corpus.
//
// Each fixture states two things independently: the frame, and the array `spec/replication.md`
// section 5 says that frame is written as. The bytes come from the codec's value encoder,
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

/** A frame, and the array section 5 states it is written as. Both written by hand. */
interface Case {
	readonly name: string;
	readonly note: string;
	readonly frame: Frame;
	readonly wire: readonly WireValue[];
}

const cases: Case[] = [
	{
		name: '001-open',
		note: 'Sharing a document. The name rides here and on no other frame, and this end already holds it.',
		frame: { kind: 'open', topic: 1, name: 'board:42', root: { id: ID, kind: 'object' }, want: false },
		wire: [0, 1, 'board:42', ID, 0, false],
	},
	{
		name: '002-open-want',
		note: 'An end holding nothing asks for the whole document. The topic number is that end own.',
		frame: { kind: 'open', topic: 4, name: 'board:42', root: { id: OTHER, kind: 'map' }, want: true },
		wire: [0, 4, 'board:42', OTHER, 2, true],
	},
	{
		name: '010-open-nothing',
		note: 'An end that holds nothing under the name: no root, and it wants the other end\'s state.',
		frame: { kind: 'open', topic: 2, name: 'board:42', root: null, want: true },
		wire: [0, 2, 'board:42', null, null, true],
	},
	{
		name: '003-state',
		note: 'The whole document, said as one commit of adds, in answer to a want.',
		frame: { kind: 'state', topic: 2, commit },
		wire: [1, 2, encodeCommit(commit)],
	},
	{
		name: '004-state-empty',
		note: 'An empty document has no commit to say, and saying so is what drops whatever the other end held.',
		frame: { kind: 'state', topic: 2 },
		wire: [1, 2, null],
	},
	{
		name: '005-commits',
		note: 'Two commits in one frame, numbered from the first. Batching is not rate limiting.',
		frame: { kind: 'commits', topic: 1, first: 5, commits: [commit, second] },
		wire: [2, 1, 5, [encodeCommit(commit), encodeCommit(second)]],
	},
	{
		name: '006-refused',
		note: 'One commit did not apply here. A path is present when the refusing end could decide it.',
		frame: {
			kind: 'refused', topic: 3, seq: 4,
			reasons: [
				{ code: 'not-here', message: 'users/x/verified is not written at this end', path: ['users', 'x', 'verified'] },
				{ code: 'unreachable', message: 'AQIDBAUGBwgJCgsM has no attach path from the root' },
			],
		},
		wire: [3, 3, 4, [
			['not-here', 'users/x/verified is not written at this end', ['users', 'x', 'verified']],
			['unreachable', 'AQIDBAUGBwgJCgsM has no attach path from the root', null],
		]],
	},
	{
		name: '007-leave',
		note: 'Done with this topic. The link stays up for the others.',
		frame: { kind: 'leave', topic: 7 },
		wire: [4, 7],
	},
	{
		name: '008-fault-topic',
		note: 'A frame arrived about a topic nothing is open under. The number is the one its sender uses.',
		frame: { kind: 'fault', topic: 6, reason: 'no-topic', message: 'nothing here is open as topic 6' },
		wire: [5, 6, 'no-topic', 'nothing here is open as topic 6'],
	},
	{
		name: '009-fault-link',
		note: 'Topic 0 is the link itself, and a fault naming it ends the link rather than one topic.',
		frame: { kind: 'fault', topic: 0, reason: 'bad-frame', message: 'a frame is a non-empty array' },
		wire: [5, 0, 'bad-frame', 'a frame is a non-empty array'],
	},
];

/** Inputs that must be refused, each naming the reason it is refused for. */
const invalid: { name: string; note: string; wire: WireValue; reason: string }[] = [
	{ name: '001-not-an-array', note: 'A frame is an array.', wire: 'open', reason: 'bad-frame' },
	{ name: '002-empty', note: 'And a non-empty one.', wire: [], reason: 'bad-frame' },
	{ name: '003-unknown-kind', note: 'Six kinds, and nothing else.', wire: [99, 1], reason: 'bad-frame' },
	{ name: '004-wrong-arity', note: 'A leave has two elements.', wire: [4, 1, 0], reason: 'bad-frame' },
	{ name: '005-topic-not-a-number', note: 'A topic is the number its sender gave it.', wire: [4, 'board'], reason: 'bad-frame' },
	{ name: '006-empty-commits', note: 'A commits frame carries at least one commit.', wire: [2, 1, 1, []], reason: 'bad-frame' },
	{ name: '007-empty-reasons', note: 'A refused carries at least one reason.', wire: [3, 1, 1, []], reason: 'bad-frame' },
	{ name: '008-unknown-root-kind', note: 'Three observable kinds, and nothing else.', wire: [0, 1, 'b', ID, 9, false], reason: 'bad-frame' },
	{ name: '009-want-not-a-boolean', note: 'Whether an end wants the whole document is a yes or a no.', wire: [0, 1, 'b', ID, 0, 'yes'], reason: 'bad-frame' },
	{ name: '010-name-not-text', note: 'A topic name is the string the application chose.', wire: [0, 1, 7, ID, 0, false], reason: 'bad-frame' },
	{ name: '011-root-not-bytes', note: 'A root id is an id, which is bytes.', wire: [0, 1, 'b', 'not bytes', 0, false], reason: 'bad-frame' },
	{ name: '012-commit-not-bytes', note: 'A commit rides as the bytes the format states.', wire: [2, 1, 1, ['not bytes']], reason: 'bad-frame' },
	{ name: '013-reason-path-not-text', note: 'A path is text steps or nothing.', wire: [3, 1, 1, [['a', 'b', [1]]]], reason: 'bad-frame' },
	{ name: '014-reason-wrong-arity', note: 'A reason is a code, a message and a path.', wire: [3, 1, 1, [['a', 'b']]], reason: 'bad-frame' },
	{ name: '019-open-half-a-root', note: 'An open with no root has neither an id nor a kind; one without the other is neither.', wire: [0, 1, 'b', null, 0, true], reason: 'bad-frame' },
	{ name: '020-open-nothing-without-want', note: 'An end that holds nothing under a name wants the other end\'s state; saying otherwise is a mistake.', wire: [0, 1, 'b', null, null, false], reason: 'bad-frame' },
	{ name: '016-topic-zero', note: 'Topic numbers start at 1; zero names the link, and only a fault may name the link.', wire: [4, 0], reason: 'bad-frame' },
	{ name: '017-sequence-zero', note: 'Sequence numbers start at 1.', wire: [2, 1, 0, [encodeCommit(commit)]], reason: 'bad-frame' },
	{ name: '018-refused-sequence-zero', note: 'A refused names a sequence, and sequences start at 1.', wire: [3, 1, 0, [['a', 'b', null]]], reason: 'bad-frame' },
	{ name: '015-fault-message-not-text', note: 'A fault says why in words.', wire: [5, 0, 'why', 1], reason: 'bad-frame' },
];

/** A frame as plain JSON: bytes in hex, commits in hex, so a fixture is readable. */
const frameToJson = (frame: Frame): unknown =>
	JSON.parse(JSON.stringify(frame, (_, value) => {
		if (value instanceof Uint8Array) return bytesToHex(value);
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
