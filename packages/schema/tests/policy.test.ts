// Checking a policy: what a rule may not say, refused where the author can see it.

import test from 'node:test';
import assert from 'node:assert/strict';

import { ANY, REST, SELF, checkPolicy, createIndex, validate } from '../src/index.ts';

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
