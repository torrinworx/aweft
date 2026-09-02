// The behavioral corpus: bypass attempts, each stated as a requirement.
//
// Every case here is a way someone could try to write where they were not granted, or a way a
// policy could quietly grant more than it says. Append-only: removing one needs a decision
// record, because each is here for a reason someone paid for.

import test from 'node:test';
import assert from 'node:assert/strict';

import { ANY, REST, SELF, createIndex, record, validate } from '../src/index.ts';
import type { Actor, DocumentIndex, Policy, Verdict } from '../src/index.ts';
import { shuffle } from '@aweftjs/testing';

import { commit, id, key, ref, slot } from './documents.ts';

// A document with two actors' regions and a shared region nobody may write.
//   root(1): users -> 2, secrets -> 6
//   users(2): key(3) -> 3 (mine), key(4) -> 4 (theirs)
//   mine(3): name, verified
//   secrets(6): token
const built = (): DocumentIndex => {
	const index = createIndex(id(1));
	record(index, commit(
		slot(1, 'users', ref(2, 'map')),
		slot(1, 'secrets', ref(6)),
		slot(6, 'token', 'shhh'),
	));
	record(index, commit(
		{ type: 'add', id: id(2), ref: { kind: 'map', key: id(3) }, value: ref(3) },
		{ type: 'add', id: id(2), ref: { kind: 'map', key: id(4) }, value: ref(4) },
		slot(3, 'name', 'mine'),
		slot(3, 'verified', false),
		slot(4, 'name', 'theirs'),
	));
	return index;
};

const mine: Actor = { id: key(3) };
const theirs: Actor = { id: key(4) };

/** What every actor gets: their own record, and nothing else. */
const ordinary: Policy = [{ effect: 'allow', path: ['users', SELF, REST] }];

const judge = (
	policy: Policy,
	deltas: Parameters<typeof commit>,
	actor: Actor = mine,
): Verdict => validate(commit(...deltas), { index: built(), policy, actor });

const codes = (verdict: Verdict): string[] =>
	verdict.ok ? [] : verdict.reasons.map((r) => r.code).sort();

test('an actor cannot write another actor region by naming it', () => {
	assert.deepEqual(codes(judge(ordinary, [slot(4, 'name', 'stolen', 'replace')])), ['unauthorized']);
	assert.equal(judge(ordinary, [slot(4, 'name', 'stolen', 'replace')], theirs).ok, true);
});

test('an alias into an authorized region grants nothing about what it names', () => {
	assert.equal(judge(ordinary, [slot(3, 'peek', ref(6, 'object', 'alias'))]).ok, true);
	assert.deepEqual(codes(judge(ordinary, [slot(6, 'token', 'mine now', 'replace')])), ['unauthorized']);
});

test('attaching a protected observable into an authorized region is refused, not adopted', () => {
	assert.deepEqual(
		codes(judge(ordinary, [slot(3, 'stolen', ref(6))])),
		['multiple-attach'],
	);
});

test('moving a protected observable needs authority where it is now, not only where it is going', () => {
	assert.deepEqual(
		codes(judge(ordinary, [slot(1, 'secrets', undefined), slot(3, 'secrets', ref(6))])),
		['unauthorized'],
	);
});

test('a new observable is judged at the path the same commit gives it, not waved through as unknown', () => {
	assert.equal(judge(ordinary, [slot(3, 'pet', ref(9)), slot(9, 'name', 'rex')]).ok, true);
	assert.deepEqual(
		codes(judge(ordinary, [slot(6, 'pet', ref(9)), slot(9, 'name', 'rex')])),
		['unauthorized', 'unauthorized'],
	);
});

test('a commit cannot write into a subtree it detaches in the same breath', () => {
	assert.deepEqual(
		codes(judge([{ effect: 'allow', path: [REST] }], [
			slot(1, 'users', undefined),
			slot(3, 'name', 'too late', 'replace'),
		])),
		['unreachable'],
	);
});

test('observables that only reach each other reach nothing, and are refused', () => {
	assert.deepEqual(
		codes(judge([{ effect: 'allow', path: [REST] }], [
			slot(9, 'down', ref(10)),
			slot(10, 'up', ref(9)),
		])),
		['unreachable', 'unreachable'],
	);
});

test('a deny cannot be escaped by appending an allow after it', () => {
	const guarded: Policy = [
		{ effect: 'deny', path: ['users', ANY, 'verified'] },
		{ effect: 'allow', path: ['users', SELF, REST] },
		{ effect: 'allow', path: ['users', SELF, 'verified'] },
	];

	assert.deepEqual(codes(judge(guarded, [slot(3, 'verified', true, 'replace')])), ['unauthorized']);
	assert.equal(judge(guarded, [slot(3, 'name', 'still fine', 'replace')]).ok, true);
});

test('a grant on a slot does not cascade into what sits in it', () => {
	const policy: Policy = [{ effect: 'allow', path: ['users', SELF] }];

	assert.deepEqual(codes(judge(policy, [slot(3, 'name', 'x', 'replace')])), ['unauthorized']);
});

test('ANY does not stand in for no step at all', () => {
	const policy: Policy = [{ effect: 'allow', path: ['users', ANY] }];

	assert.deepEqual(codes(judge(policy, [slot(1, 'users', 'flattened', 'replace')])), ['unauthorized']);
});

test('an actor cannot claim a role by what their id says', () => {
	const policy: Policy = [{ effect: 'allow', path: [REST], roles: ['moderator'] }];
	const pretender: Actor = { id: 'moderator' };

	assert.deepEqual(
		codes(validate(commit(slot(6, 'token', 'x', 'replace')), {
			index: built(), policy, actor: pretender,
		})),
		['unauthorized'],
	);
});

test('a commit whose deltas are shuffled gets the same verdict', () => {
	const deltas = [
		slot(3, 'name', 'a', 'replace'),
		slot(3, 'verified', true, 'replace'),
		slot(4, 'name', 'b', 'replace'),
		slot(3, 'pet', ref(9)),
		slot(9, 'kind', 'cat'),
	];
	const policy: Policy = [
		{ effect: 'allow', path: ['users', SELF, REST] },
		{ effect: 'deny', path: ['users', ANY, 'verified'] },
	];

	const first = validate(commit(...deltas), { index: built(), policy, actor: mine });
	assert.equal(first.ok, false);
	const expected = first.ok ? [] : first.reasons.map((r) => r.path?.join('/')).sort();

	for (let seed = 1; seed <= 20; seed++) {
		const verdict = validate(commit(...shuffle(deltas, seed * 20260901)), {
			index: built(), policy, actor: mine,
		});
		assert.equal(verdict.ok, false, `a shuffle changed the verdict, at seed ${seed * 20260901}`);
		assert.deepEqual(
			verdict.ok ? [] : verdict.reasons.map((r) => r.path?.join('/')).sort(),
			expected,
			`a shuffle changed which deltas were refused, at seed ${seed * 20260901}`,
		);
	}
});

test('detaching is not deleting: an observable nothing attaches has no owner, and may be adopted', () => {
	// Design 010 decides this: authority is the single chain of attach edges and nothing
	// else, so an observable with no chain has nobody to protect it. A policy that must stop
	// content coming back removes the content, not only the edge.
	const index = built();
	record(index, commit(slot(1, 'secrets', undefined)));

	const verdict = validate(commit(slot(3, 'adopted', ref(6))), {
		index, policy: ordinary, actor: mine,
	});

	assert.equal(verdict.ok, true);
});
