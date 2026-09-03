import test from 'node:test';
import assert from 'node:assert/strict';

import { compare, holds } from '../src/query.ts';
import { valueAt } from '../src/query.ts';

// The comparison rules every driver has to agree on. A driver that ordered nulls differently,
// or that let a number and a string compare, would page differently from the others while
// passing every behavioural test, so they are pinned here rather than left to each driver.

test('a condition against a value of a different kind never holds', () => {
	assert.equal(holds({ field: 'f', op: 'gt', value: 3 }, 'four'), false);
	assert.equal(holds({ field: 'f', op: 'lt', value: 'b' }, 1), false);
	assert.equal(holds({ field: 'f', op: 'gte', value: 1 }, true), false);
});

test('null holds only for equality', () => {
	assert.equal(holds({ field: 'f', op: 'eq', value: null }, null), true);
	for (const op of ['gt', 'gte', 'lt', 'lte'] as const) {
		assert.equal(holds({ field: 'f', op, value: null }, 5), false);
		assert.equal(holds({ field: 'f', op, value: 5 }, null), false);
	}
});

test('the range operators', () => {
	assert.equal(holds({ field: 'f', op: 'gt', value: 3 }, 4), true);
	assert.equal(holds({ field: 'f', op: 'gt', value: 3 }, 3), false);
	assert.equal(holds({ field: 'f', op: 'gte', value: 3 }, 3), true);
	assert.equal(holds({ field: 'f', op: 'lt', value: 3 }, 2), true);
	assert.equal(holds({ field: 'f', op: 'lt', value: 3 }, 3), false);
	assert.equal(holds({ field: 'f', op: 'lte', value: 3 }, 3), true);
	assert.equal(holds({ field: 'f', op: 'lte', value: 3 }, 4), false);
	assert.equal(holds({ field: 'f', op: 'gt', value: 'a' }, 'b'), true);
});

test('ordering is total, and nulls sort first', () => {
	assert.equal(compare(1, 1), 0);
	assert.equal(compare(null, null), 0);
	assert.equal(compare(null, 1), -1);
	assert.equal(compare(1, null), 1);
	assert.equal(compare(1, 2), -1);
	assert.equal(compare(2, 1), 1);
	assert.equal(compare('a', 'b'), -1);
	assert.equal(compare(false, true), -1);
	// across kinds, ordered by the kind's own name, so the order is at least stable
	assert.equal(compare(1, 'a'), -1);
	assert.equal(compare('a', 1), 1);
});

test('a path that runs into a primitive, or into bytes, reads as null', () => {
	const rows = new Map([
		['root', { kind: 'object', slots: { a: 'not an object', b: new Uint8Array([1]), c: 5 } }],
	]);
	assert.equal(valueAt(rows, 'root', ['a', 'deeper']), null, 'a primitive part way down');
	assert.equal(valueAt(rows, 'root', ['b']), null, 'bytes are not an index key');
	assert.equal(valueAt(rows, 'root', ['missing']), null);
	assert.equal(valueAt(rows, 'root', ['c']), 5);
	assert.equal(valueAt(new Map(), 'root', ['c']), null, 'a row that is not there');

	const arrayed = new Map([['root', { kind: 'array', slots: { '0a': 1 } }]]);
	assert.throws(() => valueAt(arrayed, 'root', ['0a']), /may not cross an array/,
		'an array position is not a stable name, so a literal step into one is a mistake');
	assert.equal(valueAt(rows, 'root', []), null, 'an empty path names nothing');
});
