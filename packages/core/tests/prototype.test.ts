// A slot is a slot whatever it is called. A peer that writes `__proto__` or `constructor` into a
// shared object is writing two ordinary slots, and the object's prototype, and every other
// object's, is what it was.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createObject } from '../src/index.ts';

test('a slot named __proto__ or constructor is an own slot and changes no prototype', () => {
	const doc = createObject<Record<string, unknown>>({});
	const planted = createObject<Record<string, unknown>>({ polluted: true });
	doc['__proto__'] = planted;
	doc['constructor' as string] = 'x';
	assert.ok(Object.prototype.hasOwnProperty.call(doc, '__proto__'), 'an own slot');
	assert.equal(doc['__proto__'], planted, 'holding what was written');
	assert.equal(Object.getPrototypeOf(doc), Object.prototype, 'the prototype did not move');
	assert.equal((doc as { polluted?: unknown }).polluted, undefined, 'nothing is read through it');
	assert.equal(({} as { polluted?: unknown }).polluted, undefined, 'and nothing else changed');
	assert.deepEqual(Object.keys(doc).sort(), ['__proto__', 'constructor']);
});
