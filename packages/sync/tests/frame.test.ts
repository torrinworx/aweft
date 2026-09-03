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
		{ kind: 'open', topic: 1, name: 'board:42', root: { id, kind: 'object' }, want: false },
		{ kind: 'open', topic: 9, name: 'x', root: { id: other, kind: 'array' }, want: true },
		{ kind: 'state', topic: 2 },
		{ kind: 'state', topic: 2, commit },
		{ kind: 'commits', topic: 2, first: 5, commits: [commit, commit] },
		{ kind: 'refused', topic: 3, seq: 4, reasons: [{ code: 'not-here', message: 'no' }] },
		{ kind: 'refused', topic: 3, seq: 4, reasons: [{ code: 'x', message: 'y', path: ['a', 'b'] }] },
		{ kind: 'leave', topic: 7 },
		{ kind: 'fault', topic: 0, reason: 'bad-frame', message: 'not a frame' },
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
	const state = roundTrip({ kind: 'state', topic: 1 });
	assert.ok(!('commit' in state));

	const refused = roundTrip({ kind: 'refused', topic: 1, seq: 1, reasons: [{ code: 'a', message: 'b' }] });
	assert.ok(refused.kind === 'refused' && !('path' in refused.reasons[0]!));
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
	refused(encodeValue([99, 1]) as Uint8Array, '99 is not a frame kind');
	refused(encodeValue([-1, 1]) as Uint8Array, 'a kind is a whole number');
	refused(encodeValue([0, 1, 'b', id, 0]) as Uint8Array, 'an open has six elements');
	refused(encodeValue([0, 1, 'b', id, 0, false, 1]) as Uint8Array, 'an open has six elements');
	refused(encodeValue([0, 'a', 'b', id, 0, false]) as Uint8Array, 'a topic is a number');
	refused(encodeValue([0, 1, 7, id, 0, false]) as Uint8Array, 'a topic name is text');
	refused(encodeValue([0, 1, 'b', 'not bytes', 0, false]) as Uint8Array, 'a root id is bytes');
	refused(encodeValue([0, 1, 'b', id, 9, false]) as Uint8Array, '9 is not an observable kind');
	refused(encodeValue([0, 1, 'b', id, 0, 'yes']) as Uint8Array, 'a want is a boolean');
	refused(encodeValue([1, 1, 'not bytes']) as Uint8Array, 'a state carries a commit or nothing');
	refused(encodeValue([2, 1, 1, 'not a list']) as Uint8Array, 'commits are a list');
	refused(encodeValue([2, 1, 1, []]) as Uint8Array, 'a commits frame carries at least one');
	refused(encodeValue([2, 1, 1, ['not bytes']]) as Uint8Array, 'a commit is bytes');
	refused(encodeValue([3, 1, 1, 'not a list']) as Uint8Array, 'reasons are a list');
	refused(encodeValue([3, 1, 1, []]) as Uint8Array, 'a refused carries at least one reason');
	refused(encodeValue([3, 1, 1, [['a', 'b']]]) as Uint8Array, 'a reason has three elements');
	refused(encodeValue([3, 1, 1, [['a', 'b', 'not a list']]]) as Uint8Array, 'a path is a list or null');
	refused(encodeValue([3, 1, 1, [['a', 'b', [1]]]]) as Uint8Array, 'a path step is text');
	refused(encodeValue([3, 1, 1, [[1, 'b', null]]]) as Uint8Array, 'a reason code is text');
	refused(encodeValue([3, 1, 1, [['a', 2, null]]]) as Uint8Array, 'a reason message is text');
	refused(encodeValue([4, 1, 0]) as Uint8Array, 'a leave has two elements');
	refused(encodeValue([5, 0, 1, 'why']) as Uint8Array, 'a fault reason is text');
	refused(encodeValue([5, 0, 'why', 1]) as Uint8Array, 'a fault message is text');
});

test('a topic name rides on the open and nowhere else', () => {
	// The measurement behind this: a string topic on every frame costs 29.5% over the commit
	// bytes it carries. If a later frame kind ever grew one, this goes red.
	const withName = encodeFrame({
		kind: 'open', topic: 1, name: 'board:42', root: { id, kind: 'object' }, want: false,
	}).length;
	const withoutName = encodeFrame({
		kind: 'open', topic: 1, name: '', root: { id, kind: 'object' }, want: false,
	}).length;
	assert.equal(withName - withoutName, 'board:42'.length);

	for (const frame of [
		{ kind: 'commits', topic: 1, first: 1, commits: [commit] },
		{ kind: 'state', topic: 1, commit },
		{ kind: 'refused', topic: 1, seq: 1, reasons: [{ code: 'a', message: 'b' }] },
		{ kind: 'leave', topic: 1 },
	] satisfies Frame[]) {
		const text = new TextDecoder().decode(encodeFrame(frame));
		assert.ok(!text.includes('board:42'), `${frame.kind} carries no topic name`);
	}
});
