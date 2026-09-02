// The index: where each observable lives, folded from the commits a document accepted.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createIndex, pathOf, record } from '../src/index.ts';

import { at, commit, entry, id, key, ref, slot } from './documents.ts';

test('a fresh index knows the root and nothing else', () => {
	const index = createIndex(id(1));

	assert.deepEqual(pathOf(index, id(1)), []);
	assert.equal(pathOf(index, id(2)), undefined);
});

test('an attach edge gives an observable a path', () => {
	const index = createIndex(id(1));
	record(index, commit(slot(1, 'board', ref(2))));

	assert.deepEqual(pathOf(index, id(2)), ['board']);
});

test('a path is every slot from the root down, whatever kind each holder is', () => {
	const index = createIndex(id(1));
	record(index, commit(
		slot(1, 'users', ref(2, 'map')),
		entry(2, 3, ref(3)),
		slot(3, 'tasks', ref(4, 'array')),
		at(4, [0x40], ref(5)),
	));

	assert.deepEqual(pathOf(index, id(5)), ['users', key(3), 'tasks', '40']);
});

test('an alias names an observable without giving it a place to live', () => {
	const index = createIndex(id(1));
	record(index, commit(slot(1, 'author', ref(2, 'object', 'alias'))));

	assert.equal(pathOf(index, id(2)), undefined);
});

test('removing the slot takes the path away, and the observable stays known', () => {
	const index = createIndex(id(1));
	record(index, commit(slot(1, 'board', ref(2))));
	record(index, commit(slot(1, 'board', undefined)));

	assert.equal(pathOf(index, id(2)), undefined);
});

test('replacing the slot with a primitive detaches what was there', () => {
	const index = createIndex(id(1));
	record(index, commit(slot(1, 'board', ref(2))));
	record(index, commit(slot(1, 'board', 'gone', 'replace')));

	assert.equal(pathOf(index, id(2)), undefined);
});

test('replacing the slot with another observable detaches the old one and places the new', () => {
	const index = createIndex(id(1));
	record(index, commit(slot(1, 'board', ref(2))));
	record(index, commit(slot(1, 'board', ref(3), 'replace')));

	assert.equal(pathOf(index, id(2)), undefined);
	assert.deepEqual(pathOf(index, id(3)), ['board']);
});

test('a move is one commit that takes the old edge away and gives a new one', () => {
	const index = createIndex(id(1));
	record(index, commit(slot(1, 'inbox', ref(2)), slot(1, 'done', ref(3))));
	record(index, commit(slot(2, 'item', ref(4))));
	assert.deepEqual(pathOf(index, id(4)), ['inbox', 'item']);

	record(index, commit(slot(2, 'item', undefined), slot(3, 'item', ref(4))));
	assert.deepEqual(pathOf(index, id(4)), ['done', 'item']);
});

test('a whole subtree recorded in one commit resolves through the commits own attachments', () => {
	const index = createIndex(id(1));
	record(index, commit(
		slot(1, 'blocks', ref(2, 'array')),
		at(2, [0x40], ref(3)),
		slot(3, 'text', 'hello'),
	));

	assert.deepEqual(pathOf(index, id(3)), ['blocks', '40']);
});

test('a second attach edge is refused rather than recorded', () => {
	const index = createIndex(id(1));
	record(index, commit(slot(1, 'here', ref(2))));

	assert.throws(
		() => record(index, commit(slot(1, 'there', ref(2)))),
		(e: Error & { reason?: string }) => e.reason === 'multiple-attach',
	);
	assert.deepEqual(pathOf(index, id(2)), ['here']);
});

test('two attach edges inside one commit are refused, because nothing tie-breaks them', () => {
	const index = createIndex(id(1));

	assert.throws(
		() => record(index, commit(slot(1, 'a', ref(2)), slot(1, 'b', ref(2)))),
		(e: Error & { reason?: string }) => e.reason === 'multiple-attach',
	);
});

test('an observable attached under one that has no path has no path either', () => {
	const index = createIndex(id(1));
	record(index, commit(slot(1, 'board', ref(2))));
	record(index, commit(slot(2, 'item', ref(3))));
	record(index, commit(slot(1, 'board', undefined)));

	assert.equal(pathOf(index, id(2)), undefined);
	assert.equal(pathOf(index, id(3)), undefined);
});

test('a cycle among detached observables answers rather than spinning', () => {
	const index = createIndex(id(1));
	record(index, commit(slot(1, 'a', ref(2))));
	record(index, commit(slot(2, 'b', ref(3))));
	record(index, commit(slot(3, 'c', ref(4))));
	// Take the top edge away, then close the ring below it.
	record(index, commit(slot(1, 'a', undefined)));
	record(index, commit(slot(4, 'up', ref(2))));

	assert.equal(pathOf(index, id(2)), undefined);
	assert.equal(pathOf(index, id(4)), undefined);
});

test('an add into a slot the index already fills is refused, not folded in', () => {
	// The applier refuses that commit as slot-exists, so it was never applied and must not
	// reach the index. Folding it in left two observables claiming one path.
	const index = createIndex(id(1));
	record(index, commit(slot(1, 'here', ref(2))));

	assert.throws(
		() => record(index, commit(slot(1, 'here', ref(3)))),
		(e: Error & { reason?: string }) => e.reason === 'slot-exists',
	);
	assert.deepEqual(pathOf(index, id(2)), ['here']);
	assert.equal(pathOf(index, id(3)), undefined);
});
