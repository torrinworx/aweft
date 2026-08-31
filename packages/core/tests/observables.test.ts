// The three kinds, read and written the way an application writes them.

import test from 'node:test';
import assert from 'node:assert/strict';

import { idToText } from '@aweftjs/codec';

import {
	alias, createArray, createMap, createObject, idOf, isObservable, kindOf, parentOf,
	positionsOf, insertAt, snapshot, textIdOf,
} from '../src/index.ts';

interface Block {
	text: string;
	done?: boolean;
}

test('an object slot holds a primitive and reads back', () => {
	const doc = createObject<Record<string, unknown>>({ title: 'notes', count: 2, on: true });

	assert.equal(doc.title, 'notes');
	assert.equal(doc.count, 2);
	assert.equal(doc.on, true);

	doc.title = 'aweft';
	assert.equal(doc.title, 'aweft');

	delete doc.count;
	assert.equal(doc.count, undefined);
	assert.equal('count' in doc, false);
});

test('an object enumerates as an object', () => {
	const doc = createObject<Record<string, unknown>>({ a: 1, b: 'two' });

	assert.deepEqual(Object.keys(doc), ['a', 'b']);
	assert.deepEqual(Object.entries(doc), [['a', 1], ['b', 'two']]);
	assert.equal(JSON.stringify(doc), '{"a":1,"b":"two"}');
});

test('every property belongs to the user, including ones a framework would want', () => {
	const doc = createObject<Record<string, unknown>>({ watch: 'mine', get: 'mine too' });

	assert.equal(doc.watch, 'mine');
	assert.equal(doc.get, 'mine too');
});

test('a plain object is refused rather than copied', () => {
	const doc = createObject<Record<string, unknown>>();

	assert.throws(() => { doc.nested = { a: 1 }; }, { reason: 'inline-container' });
	assert.throws(() => { doc.list = [1, 2]; }, { reason: 'inline-container' });
	assert.throws(() => { doc.when = new Date(); }, { reason: 'inline-container' });
});

test('a value with no encoding is refused where it is written', () => {
	const doc = createObject<Record<string, unknown>>();

	assert.throws(() => { doc.n = Number.NaN; }, { reason: 'invalid-number' });
	assert.throws(() => { doc.n = Number.POSITIVE_INFINITY; }, { reason: 'invalid-number' });
	assert.throws(() => { doc.n = undefined; }, { reason: 'invalid-value' });
	assert.throws(() => { doc.n = () => 1; }, { reason: 'invalid-value' });
	const keyed = doc as unknown as Record<symbol, unknown>;
	assert.throws(() => { keyed[Symbol.for('x')] = 1; }, { reason: 'invalid-key' });
});

test('a byte string is a value, and reads back as the same bytes', () => {
	const doc = createObject<Record<string, unknown>>({ blob: Uint8Array.of(1, 2, 3) });
	assert.deepEqual(doc.blob, Uint8Array.of(1, 2, 3));
});

test('an array reads with the array methods', () => {
	const list = createArray<number>([1, 2, 3]);

	assert.equal(list.length, 3);
	assert.equal(list[1], 2);
	assert.deepEqual(list.map((n) => n * 2), [2, 4, 6]);
	assert.deepEqual(list.filter((n) => n > 1), [2, 3]);
	assert.equal(list.find((n) => n === 3), 3);
	assert.equal(list.join('-'), '1-2-3');
	assert.deepEqual([...list], [1, 2, 3]);
	assert.equal(list.includes(2), true);
});

test('an array is edited by the methods that can be expressed as slots', () => {
	const list = createArray<number>([1, 2, 3]);

	assert.equal(list.push(4), 4);
	assert.deepEqual([...list], [1, 2, 3, 4]);

	assert.equal(list.pop(), 4);
	assert.equal(list.shift(), 1);
	assert.deepEqual([...list], [2, 3]);

	assert.equal(list.unshift(0, 1), 4);
	assert.deepEqual([...list], [0, 1, 2, 3]);

	assert.deepEqual(list.splice(1, 2, 9), [1, 2]);
	assert.deepEqual([...list], [0, 9, 3]);

	list[0] = 7;
	assert.deepEqual([...list], [7, 9, 3]);

	list[3] = 4;
	assert.deepEqual([...list], [7, 9, 3, 4]);

	list.length = 2;
	assert.deepEqual([...list], [7, 9]);
});

test('an array refuses the edits that would rewrite every slot, and says so', () => {
	const list = createArray<number>([3, 1, 2]);

	assert.throws(() => list.sort(), { reason: 'unsupported' });
	assert.throws(() => list.reverse(), { reason: 'unsupported' });
	assert.throws(() => list.fill(0), { reason: 'unsupported' });
	assert.throws(() => list.copyWithin(0, 1), { reason: 'unsupported' });
	assert.throws(() => { delete list[0]; }, { reason: 'invalid-write' });
	assert.throws(() => { list[9] = 1; }, { reason: 'invalid-write' });
	assert.throws(() => { list.length = 9; }, { reason: 'invalid-write' });
});

test('positions name array slots, and a caller may choose one', () => {
	const list = createArray<string>(['a', 'c']);
	const [first, last] = positionsOf(list);

	assert.ok(first !== undefined && last !== undefined);
	assert.ok(first.length > 0 && first[first.length - 1] !== 0);

	list.splice(1, 0, 'b');
	const middle = positionsOf(list)[1]!;
	assert.deepEqual([...list], ['a', 'b', 'c']);

	assert.throws(() => insertAt(list, middle, 'x'), { reason: 'slot-exists' });
	assert.throws(() => insertAt(createObject(), middle, 'x'), { reason: 'not-observable' });
	assert.throws(() => positionsOf(createObject()), { reason: 'not-observable' });
});

test('a map is keyed by identity, in bytes or in text, and files an observable under its own id', () => {
	const presence = createMap();
	const cursor = createObject<Record<string, unknown>>({ at: 3 });

	presence.add(cursor);
	assert.equal(presence.size, 1);
	assert.equal(presence.get(idOf(cursor)), cursor);
	assert.equal(presence.get(textIdOf(cursor)), cursor);
	assert.equal(presence.has(cursor), true);

	assert.deepEqual(presence.keys(), [textIdOf(cursor)]);
	assert.deepEqual(presence.values(), [cursor]);
	assert.deepEqual([...presence], [[textIdOf(cursor), cursor]]);
	assert.deepEqual([...presence.entries()], [[textIdOf(cursor), cursor]]);

	assert.equal(presence.delete(cursor), true);
	assert.equal(presence.delete(cursor), false);
	assert.equal(presence.size, 0);

	assert.throws(() => presence.get('not an id'), { reason: 'invalid-id' });
	assert.throws(() => presence.get(7), { reason: 'invalid-key' });
	assert.throws(() => presence.add({} as object), { reason: 'not-observable' });
});

test('a map states its entries up front the way the other two do', () => {
	const held = createObject<Record<string, unknown>>({ at: 1 });
	const presence = createMap([[idOf(held), held]]);

	assert.equal(presence.get(held), held);
});

test('an observable lives at one attach edge, and an alias names it without moving it', () => {
	const block: Block = createObject<Block>({ text: 'hi' });
	const doc = createObject<{ blocks: Block[]; first?: Block }>({ blocks: createArray<Block>([block]) });

	assert.equal(parentOf(block), doc.blocks);

	doc.first = alias(block) as Block;
	assert.equal(doc.first, block);
	assert.equal(parentOf(block), doc.blocks, 'an alias grants no home');

	assert.throws(() => alias({} as object), { reason: 'not-observable' });
});

test('assigning an observable that already lives somewhere is refused', () => {
	const block = createObject<Block>({ text: 'hi' });
	const doc = createObject<Record<string, unknown>>({ a: block });

	assert.throws(() => { doc.b = block; }, { reason: 'multiple-attach' });
	assert.equal(doc.b, undefined, 'the refused write left nothing behind');
	assert.equal(parentOf(block), doc);
});

test('an observable cannot be attached inside itself', () => {
	const doc = createObject<Record<string, unknown>>({ inner: createObject() });

	assert.throws(() => { (doc.inner as Record<string, unknown>).loop = doc; }, { reason: 'unreachable' });
	assert.throws(() => { doc.self = doc; }, { reason: 'unreachable' });
});

test('identity is readable, and says what it is', () => {
	const doc = createObject();

	assert.equal(idOf(doc).length, 12);
	assert.equal(textIdOf(doc), idToText(idOf(doc)));
	assert.equal(kindOf(doc), 'object');
	assert.equal(kindOf(createArray()), 'array');
	assert.equal(kindOf(createMap()), 'map');

	assert.equal(isObservable(doc), true);
	assert.equal(isObservable({}), false);
	assert.equal(isObservable(null), false);
	assert.equal(parentOf(doc), undefined);

	assert.throws(() => idOf({}), { reason: 'not-observable' });
});

test('two observables never share an id, and one cannot be planted twice', () => {
	const first = createObject();
	const second = createObject(undefined, idOf(first));
	const doc = createObject<Record<string, unknown>>({ a: first });

	assert.throws(() => { doc.b = second; }, { reason: 'duplicate-id' });
});

test('a snapshot is the whole document as plain data', () => {
	const block = createObject<Block>({ text: 'hi' });
	const doc = createObject<{ blocks: Block[]; first?: Block; note: string }>({
		note: 'x',
		blocks: createArray<Block>([block]),
	});
	doc.first = alias(block) as Block;

	const taken = snapshot(doc);
	assert.equal(taken.root, textIdOf(doc));
	assert.equal(Object.keys(taken.observables).length, 3);
	assert.deepEqual(taken.observables[textIdOf(doc)]?.slots.first, {
		ref: textIdOf(block),
		kind: 'object',
		edge: 'alias',
	});
	assert.equal(taken.observables[textIdOf(block)]?.slots.text, 'hi');

	// Any observable in the document answers for the document.
	assert.deepEqual(snapshot(block), taken);
	assert.throws(() => snapshot({}), { reason: 'not-observable' });
});
