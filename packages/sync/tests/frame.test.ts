import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createId, encodeValue } from '@aweftjs/codec';
import type { Commit } from '@aweftjs/codec';
import { decodeFrame, encodeFrame } from '@aweftjs/sync';
import type { Frame } from '@aweftjs/sync';

const id = createId();
const other = createId();

const commit: Commit = {
	deltas: [{ type: 'add', id, ref: { kind: 'object', key: 'title' }, value: 'plan' }],
};

const roundTrip = (frame: Frame): Frame => decodeFrame(encodeFrame(frame));

test('every frame kind round trips through the bytes', () => {
	const frames: Frame[] = [
		{ kind: 'join', topic: 0, name: 'board:42', have: 0 },
		{ kind: 'join', topic: 3, name: 'x', have: 17, resume: other },
		{ kind: 'joined', topic: 0, accepted: 0, seq: 0, whole: true, session: id, root: { id, kind: 'object' } },
		{ kind: 'joined', topic: 1, accepted: 9, seq: 4, whole: true, session: other, root: { id, kind: 'map' }, reset: commit },
		{ kind: 'commits', topic: 2, first: 5, commits: [commit, commit] },
		{ kind: 'accept', topic: 0, through: 12, at: 30 },
		{ kind: 'refuse', topic: 0, seq: 4, reasons: [{ code: 'unauthorized', message: 'no' }] },
		{ kind: 'refuse', topic: 0, seq: 4, reasons: [{ code: 'x', message: 'y', path: ['a', 'b'] }] },
		{ kind: 'leave', topic: 7 },
		{ kind: 'fault', topic: 0, reason: 'no-topic', message: 'nothing is published there' },
	];

	for (const frame of frames) {
		assert.deepStrictEqual(roundTrip(frame), frame, frame.kind);
	}
});

test('the same frame always writes the same bytes', () => {
	const frame: Frame = { kind: 'commits', topic: 2, first: 5, commits: [commit] };
	assert.deepStrictEqual(encodeFrame(frame), encodeFrame(structuredClone(frame)));
});

test('an absent optional field stays absent rather than arriving as undefined', () => {
	const join = roundTrip({ kind: 'join', topic: 0, name: 'a', have: 0 });
	assert.ok(!('resume' in join));

	const joined = roundTrip({
		kind: 'joined', topic: 0, accepted: 0, seq: 0, whole: false, session: id, root: { id, kind: 'array' },
	});
	assert.ok(!('reset' in joined));

	const refuse = roundTrip({ kind: 'refuse', topic: 0, seq: 1, reasons: [{ code: 'a', message: 'b' }] });
	assert.ok(refuse.kind === 'refuse' && !('path' in refuse.reasons[0]!));
});

const refused = (bytes: Uint8Array, detail: string): void => {
	assert.throws(() => decodeFrame(bytes), (error: unknown) => {
		assert.equal((error as { reason?: string }).reason, 'bad-frame', detail);
		return true;
	}, detail);
};

test('bytes that are not a frame are refused, and the reason says which field', () => {
	refused(encodeValue('not a frame') as Uint8Array, 'a frame is an array');
	refused(encodeValue([]) as Uint8Array, 'an empty array is not a frame');
	refused(encodeValue([99, 0]) as Uint8Array, '99 is not a frame kind');
	refused(encodeValue([-1, 0]) as Uint8Array, 'a kind is a whole number');
	refused(encodeValue([3, 0]) as Uint8Array, 'an accept has four elements');
	refused(encodeValue([3, 0, 1, 2, 3]) as Uint8Array, 'an accept has four elements');
	refused(encodeValue([3, 'a', 1, 2]) as Uint8Array, 'a topic is a number');
	refused(encodeValue([0, 0, 7, 0, null]) as Uint8Array, 'a topic name is text');
	refused(encodeValue([0, 0, 'a', 0, 'not bytes']) as Uint8Array, 'a session id is bytes');
	refused(encodeValue([2, 0, 0, 'not a list']) as Uint8Array, 'commits are a list');
	refused(encodeValue([2, 0, 0, []]) as Uint8Array, 'a commits frame carries at least one');
	refused(encodeValue([2, 0, 0, ['not bytes']]) as Uint8Array, 'a commit is bytes');
	refused(encodeValue([4, 0, 0, 'not a list']) as Uint8Array, 'reasons are a list');
	refused(encodeValue([4, 0, 0, []]) as Uint8Array, 'a refuse carries at least one reason');
	refused(encodeValue([4, 0, 0, [['a', 'b']]]) as Uint8Array, 'a reason has three elements');
	refused(encodeValue([4, 0, 0, [['a', 'b', 'not a list']]]) as Uint8Array, 'a path is a list or null');
	refused(encodeValue([4, 0, 0, [['a', 'b', [1]]]]) as Uint8Array, 'a path step is text');
	refused(encodeValue([5, 0, 0]) as Uint8Array, 'a leave has two elements');
	refused(encodeValue([6, 0, 'why', 1]) as Uint8Array, 'a fault message is text');
	refused(encodeValue([1, 0, 0, 0, true, id, id, 9, null]) as Uint8Array, '9 is not an observable kind');
	refused(encodeValue([1, 0, 0, 0, 'yes', id, id, 0, null]) as Uint8Array, 'a whole flag is a boolean');
});

test('a topic name rides on the join and nowhere else', () => {
	// The measurement behind this: a string topic on every frame costs 29.5% over the commit
	// bytes it carries. If a later frame kind ever grew one, this goes red.
	const withName = encodeFrame({ kind: 'join', topic: 0, name: 'board:42', have: 0 }).length;
	const withoutName = encodeFrame({ kind: 'join', topic: 0, name: '', have: 0 }).length;
	assert.equal(withName - withoutName, 'board:42'.length);

	for (const frame of [
		{ kind: 'commits', topic: 0, first: 0, commits: [commit] },
		{ kind: 'accept', topic: 0, through: 1, at: 1 },
		{ kind: 'leave', topic: 0 },
	] satisfies Frame[]) {
		const text = new TextDecoder().decode(encodeFrame(frame));
		assert.ok(!text.includes('board:42'), `${frame.kind} carries no topic name`);
	}
});
