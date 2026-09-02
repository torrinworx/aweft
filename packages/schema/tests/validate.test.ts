// Deciding a commit: what a policy grants, what it refuses, and what it says about why.

import test from 'node:test';
import assert from 'node:assert/strict';

import { ANY, REST, SELF, createIndex, record, validate } from '../src/index.ts';
import type { Actor, DocumentIndex, Policy, Verdict } from '../src/index.ts';

import { at, commit, entry, id, key, ref, slot } from './documents.ts';

const me: Actor = { id: key(3) };

/** A document with a users map, one record for the acting actor, and a posts object. */
const seeded = (): DocumentIndex => {
	const index = createIndex(id(1));
	record(index, commit(
		slot(1, 'users', ref(2, 'map')),
		entry(2, 3, ref(3)),
		slot(3, 'name', 'me'),
		slot(1, 'posts', ref(4)),
		slot(4, 'p1', ref(5)),
		slot(5, 'title', 'first'),
	));
	return index;
};

const decide = (policy: Policy, deltas: Parameters<typeof commit>, actor: Actor = me): Verdict =>
	validate(commit(...deltas), { index: seeded(), policy, actor });

const codes = (verdict: Verdict): string[] =>
	verdict.ok ? [] : verdict.reasons.map((r) => r.code);

test('an empty policy authorizes nothing', () => {
	const verdict = decide([], [slot(3, 'name', 'you', 'replace')]);

	assert.equal(verdict.ok, false);
	assert.deepEqual(codes(verdict), ['unauthorized']);
});

test('allowing everything takes one rule, and then everything passes', () => {
	const verdict = decide([{ effect: 'allow', path: [REST] }], [
		slot(3, 'name', 'you', 'replace'),
		slot(5, 'title', 'second', 'replace'),
	]);

	assert.equal(verdict.ok, true);
});

test('a literal grant covers its slot and nothing under it', () => {
	const policy: Policy = [{ effect: 'allow', path: ['posts', 'p1'] }];

	assert.equal(decide(policy, [slot(4, 'p1', 'flat', 'replace')]).ok, true);
	assert.equal(decide(policy, [slot(5, 'title', 'x', 'replace')]).ok, false);
});

test('a subtree grant covers the slot and everything below it', () => {
	const policy: Policy = [{ effect: 'allow', path: ['posts', REST] }];

	assert.equal(decide(policy, [slot(4, 'p1', 'flat', 'replace')]).ok, true);
	assert.equal(decide(policy, [slot(5, 'title', 'x', 'replace')]).ok, true);
	assert.equal(decide(policy, [slot(3, 'name', 'x', 'replace')]).ok, false);
});

test('SELF binds to the acting actor, so one rule is every actor own region', () => {
	const policy: Policy = [{ effect: 'allow', path: ['users', SELF, REST] }];

	assert.equal(decide(policy, [slot(3, 'name', 'x', 'replace')]).ok, true);
	assert.equal(decide(policy, [slot(3, 'name', 'x', 'replace')], { id: key(9) }).ok, false);
});

test('a rule that names roles reaches only actors holding one', () => {
	const policy: Policy = [{ effect: 'allow', path: [REST], roles: ['moderator'] }];
	const delta = [slot(5, 'title', 'x', 'replace')] as Parameters<typeof commit>;

	assert.equal(validate(commit(...delta), { index: seeded(), policy, actor: me }).ok, false);
	assert.equal(validate(commit(...delta), {
		index: seeded(), policy, actor: { id: me.id, roles: ['moderator'] },
	}).ok, true);
	assert.equal(validate(commit(...delta), {
		index: seeded(), policy, actor: { id: me.id, roles: ['reader'] },
	}).ok, false);
});

test('a rule that names types covers only those', () => {
	const policy: Policy = [
		{ effect: 'allow', path: ['posts', REST], types: ['add', 'replace'] },
	];

	assert.equal(decide(policy, [slot(5, 'body', 'new')]).ok, true);
	assert.equal(decide(policy, [slot(5, 'title', 'x', 'replace')]).ok, true);
	assert.equal(decide(policy, [slot(5, 'title', undefined)]).ok, false);
});

test('a deny beats an allow whichever order they are written in', () => {
	const allow = { effect: 'allow', path: ['users', REST] } as const;
	const deny = { effect: 'deny', path: ['users', ANY, 'name'] } as const;
	const write = [slot(3, 'name', 'x', 'replace')] as Parameters<typeof commit>;

	assert.equal(decide([allow, deny], write).ok, false);
	assert.equal(decide([deny, allow], write).ok, false);
	assert.equal(decide([allow, deny], [slot(3, 'colour', 'blue')]).ok, true);
});

test('a commit is refused whole when any one delta is not authorized', () => {
	const policy: Policy = [{ effect: 'allow', path: ['posts', REST] }];
	const verdict = decide(policy, [
		slot(5, 'title', 'fine', 'replace'),
		slot(3, 'name', 'not fine', 'replace'),
	]);

	assert.equal(verdict.ok, false);
	assert.deepEqual(codes(verdict), ['unauthorized']);
});

test('every refused delta gets its own reason, so a policy shows every path it missed', () => {
	const verdict = decide([], [slot(3, 'name', 'a', 'replace'), slot(5, 'title', 'b', 'replace')]);

	assert.equal(verdict.ok, false);
	assert.equal(verdict.ok === false && verdict.reasons.length, 2);
});

test('an unauthorized reason names where the delta lands', () => {
	const verdict = decide([], [slot(5, 'title', 'x', 'replace')]);

	assert.equal(verdict.ok, false);
	if (verdict.ok) return;
	assert.deepEqual(verdict.reasons[0]!.path, ['posts', 'p1', 'title']);
	assert.match(verdict.reasons[0]!.message, /may not replace posts\/p1\/title/);
});

test('a delta into something nothing attaches is unreachable, not unauthorized', () => {
	const verdict = decide([{ effect: 'allow', path: [REST] }], [slot(9, 'anything', 1)]);

	assert.deepEqual(codes(verdict), ['unreachable']);
	assert.equal(verdict.ok === false && verdict.reasons[0]!.path, undefined);
});

test('a whole new subtree is judged at the paths the same commit gives it', () => {
	const policy: Policy = [{ effect: 'allow', path: ['posts', REST] }];
	const verdict = decide(policy, [
		slot(4, 'p2', ref(6)),
		slot(6, 'body', ref(7, 'array')),
		at(7, [0x40], 'first line'),
	]);

	assert.equal(verdict.ok, true);
});

test('a new subtree hung off a region the actor may not write is refused there', () => {
	const policy: Policy = [{ effect: 'allow', path: ['posts', REST] }];
	const verdict = decide(policy, [slot(3, 'pet', ref(6)), slot(6, 'name', 'rex')]);

	assert.equal(verdict.ok, false);
	assert.deepEqual(codes(verdict).sort(), ['unauthorized', 'unauthorized']);
});

test('a commit cannot write into a subtree it is detaching in the same breath', () => {
	const verdict = decide([{ effect: 'allow', path: [REST] }], [
		slot(1, 'posts', undefined),
		slot(5, 'title', 'too late', 'replace'),
	]);

	assert.deepEqual(codes(verdict), ['unreachable']);
});

test('a second attach edge refuses the delta that writes it and any delta that reads through it', () => {
	const verdict = decide([{ effect: 'allow', path: [REST] }], [
		slot(3, 'stolen', ref(5)),
		slot(5, 'title', 'mine now', 'replace'),
	]);

	assert.equal(verdict.ok, false);
	assert.deepEqual(codes(verdict).sort(), ['multiple-attach', 'multiple-attach']);
});

test('moving an observable is authorized at both ends, not one', () => {
	const move = [slot(1, 'posts', undefined), slot(3, 'posts', ref(4))] as Parameters<typeof commit>;

	assert.equal(decide([{ effect: 'allow', path: [REST] }], move).ok, true);
	assert.equal(decide([{ effect: 'allow', path: ['users', REST] }], move).ok, false);
});

test('a delta on the root itself is one step long', () => {
	assert.equal(decide([{ effect: 'allow', path: ['motd'] }], [slot(1, 'motd', 'hi')]).ok, true);
	assert.equal(decide([{ effect: 'allow', path: ['users', REST] }], [slot(1, 'motd', 'hi')]).ok, false);
});

test('an alias is authorized where it is written, and grants nothing where it points', () => {
	const policy: Policy = [{ effect: 'allow', path: ['users', SELF, REST] }];

	assert.equal(decide(policy, [slot(3, 'favourite', ref(5, 'object', 'alias'))]).ok, true);
	assert.equal(decide(policy, [slot(5, 'title', 'through the alias', 'replace')]).ok, false);
});
