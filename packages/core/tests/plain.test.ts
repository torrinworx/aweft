// Plain data in and out of a document (design 311).

import test from 'node:test';
import assert from 'node:assert/strict';

import { randomBelow, randomFrom } from '@aweftjs/testing';

import {
	alias, createArray, createMap, createObject, fromPlain, isObservable, kindOf, mutable, observer,
	textIdOf, toPlain,
} from '../src/index.ts';

const reasonOf = (error: unknown): unknown => (error as { reason?: unknown }).reason;

// A random tree of what JSON holds, with no `undefined` anywhere, so it is its own expected copy.
const tree = (random: () => number, depth: number): unknown => {
	const pick = randomBelow(random, depth > 3 ? 4 : 6);
	if (pick === 0) return null;
	if (pick === 1) return randomBelow(random, 2) === 0;
	if (pick === 2) return randomBelow(random, 1000) - 500;
	if (pick === 3) return `s${String(randomBelow(random, 100))}`;
	if (pick === 4) return Array.from({ length: randomBelow(random, 4) }, () => tree(random, depth + 1));
	const held: Record<string, unknown> = {};
	for (let at = randomBelow(random, 4); at > 0; at -= 1) held[`k${String(randomBelow(random, 9))}`] = tree(random, depth + 1);
	return held;
};

// Every container in a converted tree is an observable of the matching kind.
const observableAll = (value: unknown): boolean => {
	if (value === null || typeof value !== 'object') return true;
	if (!isObservable(value)) return false;
	const kind = kindOf(value);
	if (Array.isArray(value) !== (kind === 'array')) return false;
	return Object.values(value).every(observableAll);
};

test('a random plain tree goes in as observables and comes back out equal to itself', () => {
	for (let seed = 1; seed <= 200; seed += 1) {
		const random = randomFrom(seed);
		const plain = { root: tree(random, 0) };
		const doc = fromPlain(plain);
		assert.ok(isObservable(doc), `seed ${String(seed)}: the root is an observable`);
		assert.ok(observableAll(doc), `seed ${String(seed)}: every container inside is one`);
		assert.deepEqual(toPlain(doc), plain, `seed ${String(seed)}`);
	}
});

test('a converted tree is live: a write to it is a commit', () => {
	const doc = fromPlain({ rows: [{ title: 'a' }] }) as { rows: { title: string }[] };
	const heard: number[] = [];
	observer(doc).watch((change) => { heard.push(change.deltas.length); });
	doc.rows[0]!.title = 'b';
	assert.deepEqual(heard, [1]);
});

test('undefined is dropped from an object and is null in an array, as JSON writes them', () => {
	const doc = fromPlain({ kept: 1, gone: undefined, list: [1, undefined, 3] });
	assert.deepEqual(Object.keys(doc), ['kept', 'list']);
	assert.deepEqual(toPlain(doc), { kept: 1, list: [1, null, 3] });
	assert.deepEqual(JSON.parse(JSON.stringify({ kept: 1, gone: undefined, list: [1, undefined, 3] })), toPlain(doc));
	assert.equal(fromPlain(undefined), undefined);
	assert.equal(fromPlain('text'), 'text');
});

test('a key named __proto__, which JSON.parse makes an own key, is a slot both ways and sets no prototype', () => {
	const parsed = JSON.parse('{"__proto__": {"polluted": true}, "a": 1}') as Record<string, unknown>;
	const doc = fromPlain(parsed) as Record<string, unknown>;
	assert.deepEqual(Object.keys(doc), ['__proto__', 'a']);
	assert.equal(Object.getPrototypeOf(doc), Object.prototype);
	assert.equal((doc as { polluted?: unknown }).polluted, undefined);
	const out = toPlain<Record<string, unknown>>(doc);
	assert.deepEqual(Object.keys(out), ['__proto__', 'a']);
	assert.equal(Object.getPrototypeOf(out), Object.prototype, 'the copy keeps the plain prototype');
	assert.equal(JSON.stringify(out), '{"__proto__":{"polluted":true},"a":1}', 'and says what JSON said');
});

test('a hole in a list is null both ways, as JSON writes it', () => {
	const doc = fromPlain({ list: [1, , 3] }) as { list: unknown[] };
	assert.deepEqual([...doc.list], [1, null, 3]);
	assert.deepEqual(toPlain({ list: [1, , 3] }), { list: [1, null, 3] });
});

test('bytes go in as the bytes, and come out as a copy of them', () => {
	const bytes = new Uint8Array([1, 2, 3]);
	const doc = fromPlain({ bytes }) as { bytes: Uint8Array };
	assert.ok(doc.bytes instanceof Uint8Array);
	assert.deepEqual([...doc.bytes], [1, 2, 3]);
	const out = toPlain<{ bytes: Uint8Array }>(doc);
	assert.ok(out.bytes instanceof Uint8Array);
	assert.deepEqual([...out.bytes], [1, 2, 3]);
	assert.notEqual(out.bytes, doc.bytes, 'a copy, so writing it changes nothing stored');
	// JSON would have made it an object of numbered keys.
	assert.deepEqual(JSON.parse(JSON.stringify({ bytes })), { bytes: { 0: 1, 1: 2, 2: 3 } });
});

test('an observable already in the tree is kept as itself, not copied', () => {
	const kept = createObject({ x: 1 });
	const list = createArray([1]);
	const doc = fromPlain({ kept, nested: { list } }) as { kept: object; nested: { list: object } };
	assert.equal(doc.kept, kept);
	assert.equal(doc.nested.list, list);
	assert.equal(fromPlain(kept), kept);
});

test('every slot comes out, a private one included, and a map comes out keyed by id', () => {
	const author = createObject({ name: 'ada' });
	const people = createMap<object>();
	people.add(author);
	const doc = createObject({ _draft: 'not public', people });
	assert.deepEqual(toPlain(doc), { _draft: 'not public', people: { [textIdOf(author)]: { name: 'ada' } } });
});

test('an observable reached twice through an alias is copied at each place', () => {
	const shared = createObject({ name: 'ada' });
	const doc = createObject({ owner: shared, again: alias(shared) });
	const out = toPlain<{ owner: object; again: object }>(doc);
	assert.deepEqual(out, { owner: { name: 'ada' }, again: { name: 'ada' } });
	assert.notEqual(out.owner, out.again);
});

test('an alias marker in plain data stays an alias on the way in, and is what it names on the way out', () => {
	const person = createObject({ name: 'ada' });
	const doc = fromPlain({ owner: person, again: alias(person) }) as { owner: object; again: object };
	assert.equal(doc.again, person, 'the slot is an alias edge to the observable, not an empty copy');
	assert.deepEqual(toPlain(doc), { owner: { name: 'ada' }, again: { name: 'ada' } });
	assert.deepEqual(toPlain({ again: alias(person) }), { again: { name: 'ada' } });
});

test('a plain value that holds itself is refused on the way in too', () => {
	const plain: Record<string, unknown> = { a: 1 };
	plain.self = plain;
	assert.throws(() => fromPlain(plain), (error: unknown) => reasonOf(error) === 'cycle' && /self holds itself/.test((error as Error).message));
	const shared = { x: 1 };
	assert.deepEqual(toPlain(fromPlain({ one: shared, two: shared })), { one: { x: 1 }, two: { x: 1 } }, 'a value reached twice side by side is no loop');
});

test('a value nested deeper than the stack is refused in the stack\'s shape both ways', () => {
	const top: Record<string, unknown> = {};
	let deep = top;
	for (let at = 0; at < 50_000; at += 1) {
		const next: Record<string, unknown> = {};
		deep.n = next;
		deep = next;
	}
	assert.throws(() => fromPlain(top), (error: unknown) => reasonOf(error) === 'too-deep');
	assert.throws(() => toPlain(top), (error: unknown) => reasonOf(error) === 'too-deep');
});

test('a loop through an alias is refused, naming where it closed', () => {
	const doc = createObject<Record<string, unknown>>({ inner: createObject({}) });
	(doc.inner as Record<string, unknown>).back = alias(doc);
	assert.throws(() => toPlain(doc), (error: unknown) => reasonOf(error) === 'cycle' && /inner\.back/.test((error as Error).message));
	const plain: Record<string, unknown> = {};
	plain.self = plain;
	assert.throws(() => toPlain(plain), (error: unknown) => reasonOf(error) === 'cycle');
});

test('what is not plain data is refused on the way in, naming where it was', () => {
	class Point { x = 1; }
	const cases: [unknown, RegExp][] = [
		[{ when: new Date(0) }, /when is a Date/],
		[{ rows: [new Map()] }, /rows\.0 is a Map/],
		[{ at: new Point() }, /at is a Point/],
		[{ run: () => 1 }, /run is a function/],
		[{ big: 1n }, /big is a bigint/],
		[{ count: mutable(1) }, /count is a cell/],
		[{ view: new Int8Array(1) }, /view is a Int8Array/],
	];
	for (const [value, named] of cases) {
		assert.throws(() => fromPlain(value), (error: unknown) => reasonOf(error) === 'invalid-value' && named.test((error as Error).message), String(named));
	}
	assert.throws(() => fromPlain(Symbol('s')), (error: unknown) => reasonOf(error) === 'invalid-value' && /the value is a symbol/.test((error as Error).message));
});

test('what is not plain data is refused on the way out too', () => {
	assert.throws(() => toPlain({ when: new Date(0) }), (error: unknown) => reasonOf(error) === 'invalid-value' && /when is a Date/.test((error as Error).message));
	assert.throws(() => toPlain([() => 1]), (error: unknown) => reasonOf(error) === 'invalid-value' && /0 is a function/.test((error as Error).message));
	assert.deepEqual(toPlain({ gone: undefined, list: [undefined] }), { list: [null] });
	assert.equal(toPlain(null), null);
	assert.equal(toPlain(undefined), undefined);
	assert.deepEqual(toPlain(Object.assign(Object.create(null) as object, { a: 1 })), { a: 1 });
});
