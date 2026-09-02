// Checking a policy: what a rule may not say, refused where the author can see it.

import test from 'node:test';
import assert from 'node:assert/strict';

import { atomic, createMap, createObject, idOf, observer } from '@aweftjs/core';
import type { ObservableMap } from '@aweftjs/core';
import type { Commit } from '@aweftjs/codec';

import { ANY, REST, SELF, checkPolicy, createIndex, record, validate } from '../src/index.ts';
import type { Policy, Rule } from '../src/index.ts';

import { commit, id, slot } from './documents.ts';

const reason = (name: string) => (e: Error & { reason?: string }): boolean => e.reason === name;

test('REST anywhere but last is refused when the policy is checked, not when a path reaches it', () => {
	assert.throws(() => checkPolicy([{ effect: 'allow', path: ['a', REST, 'b'] }]), reason('bad-pattern'));
});

test('a step that is not a step is refused, whatever shape it is', () => {
	for (const step of [{ nonsense: true }, 7, null]) {
		assert.throws(
			() => checkPolicy([{ effect: 'allow', path: [step as unknown as string] }]),
			reason('bad-pattern'),
		);
	}
});

test('an effect that is not one, and a delta type that is not one, are refused', () => {
	assert.throws(() => checkPolicy([{ effect: 'maybe' as 'allow', path: [REST] }]), reason('bad-rule'));
	assert.throws(
		() => checkPolicy([{ effect: 'allow', path: [REST], types: ['delete' as 'add'] }]),
		reason('bad-rule'),
	);
});

test('a well formed policy is accepted, including the empty one', () => {
	assert.equal(checkPolicy([]), undefined);
	assert.equal(checkPolicy([{ effect: 'deny', path: ['a', ANY, SELF, REST] }]), undefined);
});

test('validate refuses a malformed policy itself, so a caller who never calls checkPolicy still finds out', () => {
	const index = createIndex(id(1));
	assert.throws(
		() => validate(commit(slot(1, 'a', 1)), {
			index,
			policy: [{ effect: 'allow', path: [REST, 'b'] }],
			actor: { id: 'me' },
		}),
		reason('bad-pattern'),
	);
});

test('an empty pattern is refused, because no delta lands at a path it could match', () => {
	assert.throws(() => checkPolicy([{ effect: 'allow', path: [] }]), reason('bad-pattern'));
	assert.throws(() => checkPolicy([{ effect: 'deny', path: [] }]), reason('bad-pattern'));
});

test('a rule added to a policy after it was first used is checked like any other', () => {
	// The check used to be cached on the policy array's identity, so a rule appended after the
	// first call was never looked at. Because matching stops at the first REST, an unchecked
	// `[REST, 'x']` then matched every path in the document, which is a grant nobody wrote.
	const policy: Rule[] = [{ effect: 'allow', path: ['users', REST] }];
	checkPolicy(policy);

	policy.push({ effect: 'allow', path: [REST, 'anything'] });

	assert.throws(() => checkPolicy(policy), reason('bad-pattern'));
	assert.throws(
		() => validate(commit(slot(1, 'anything', 1)), {
			index: createIndex(id(1)), policy, actor: { id: 'me' },
		}),
		reason('bad-pattern'),
	);
});

// The README claims a task built with a field only a moderator may write is refused for
// everyone else, because attaching an observable emits the slots it was built with in the
// same commit and a commit is authorized whole. A real program crashed into this while it
// was undocumented, so this is the check that goes red if it stops being true.
test('a slot a constructed observable carries is judged like any other write', () => {
	const doc = createObject<Record<string, unknown>>();
	const index = createIndex(idOf(doc));
	const commits: Commit[] = [];
	observer(doc).watch((change) => commits.push({ deltas: [...change.deltas] }));

	atomic(() => { doc.tasks = createMap(); });
	for (const commit of commits.splice(0)) record(index, commit);

	const policy: Policy = [
		{ effect: 'allow', path: ['tasks', ANY] },
		{ effect: 'allow', path: ['tasks', ANY, 'title'] },
		{ effect: 'allow', path: ['tasks', ANY, 'flagged'], roles: ['moderator'] },
	];
	const member = { id: 'member' };

	const tasks = doc.tasks as ObservableMap<object>;
	tasks.add(createObject({ title: 'write it up', flagged: false }));
	const withFlag = commits.splice(0)[0]!;

	const refused = validate(withFlag, { index, policy, actor: member });
	assert.equal(refused.ok, false, 'a default for a field they cannot write refuses the whole commit');
	assert.ok(!refused.ok && refused.reasons.some((r) => r.path?.[2] === 'flagged'));

	tasks.add(createObject({ title: 'book the room' }));
	const without = commits.splice(0)[0]!;
	assert.equal(validate(without, { index, policy, actor: member }).ok, true, 'leaving it out works');
	assert.equal(
		validate(withFlag, { index, policy, actor: { id: 'mod', roles: ['moderator'] } }).ok, true,
		'and a moderator may build it either way',
	);
});
