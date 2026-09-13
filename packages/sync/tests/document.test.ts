import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	alias, apply, atomic, createArray, createMap, createObject, idOf, kindOf, snapshot,
} from '@aweftjs/core';
import { canonicalJson, randomBelow, randomFrom } from '@aweftjs/testing';
import { asCommit, mirror, reconcile, rootFrom } from '@aweftjs/sync';

const rebuild = (source: object): object => {
	const copy = createObject(undefined, idOf(source));
	const whole = asCommit(source);
	if (whole !== undefined) apply(copy, whole);
	return copy;
};

const equal = (a: unknown, b: unknown, what: string): void => {
	assert.equal(canonicalJson(snapshot(a)), canonicalJson(snapshot(b)), what);
};

test('a document said as one commit rebuilds into the same document', () => {
	const doc = createObject<Record<string, unknown>>();
	atomic(() => {
		doc.title = 'plan';
		doc.count = 3;
		doc.flag = true;
		doc.nothing = null;
		doc.blob = new Uint8Array([1, 2, 3]);
	});

	const tasks = createArray<object>();
	const people = createMap<object>();
	atomic(() => {
		doc.tasks = tasks;
		doc.people = people;
	});

	const first = createObject({ title: 'a', done: false });
	atomic(() => { tasks.push(first, createObject({ title: 'b', done: true })); });
	people.add(createObject({ name: 'x' }));
	doc.featured = alias(first);

	equal(rebuild(doc), doc, 'the rebuild says what the original says');
});

test('an empty document says nothing, because a commit carries at least one delta', () => {
	assert.equal(asCommit(createObject()), undefined);
	assert.equal(asCommit(createArray()), undefined);
});

test('asCommit takes an observable and refuses anything else', () => {
	assert.throws(() => asCommit({ not: 'an observable' }), /not-observable/);
});

test('reconcile moves a drifted document without replacing it', () => {
	const source = createObject<Record<string, unknown>>();
	const copy = createObject<Record<string, unknown>>(undefined, idOf(source));

	atomic(() => {
		source.title = 'plan';
		source.tasks = createArray<object>();
	});
	const fix = reconcile(copy, snapshot(source));
	assert.ok(fix !== undefined);
	apply(copy, fix);
	equal(copy, source, 'the copy caught up');

	// The document itself is still the one the caller holds.
	const held = copy;
	const list = source.tasks as object[];
	atomic(() => { list.push(createObject({ title: 'x' })); });
	source.title = 'plan b';

	const second = reconcile(copy, snapshot(source));
	assert.ok(second !== undefined);
	apply(copy, second);
	equal(copy, source, 'and again, after two more changes');
	assert.equal(held, copy, 'the same object throughout');
});

test('reconcile is empty when there is nothing to say', () => {
	const a = createObject<Record<string, unknown>>({ x: 1 });
	const b = createObject<Record<string, unknown>>(undefined, idOf(a));
	apply(b, asCommit(a)!);
	assert.equal(reconcile(b, snapshot(a)), undefined);
});

test('reconcile refuses two documents that are not the same document', () => {
	assert.throws(
		() => reconcile(createObject({ x: 1 }), snapshot(createObject({ x: 1 }))),
		/root-mismatch/,
	);
});

test('reconcile sees a value change of every shape', () => {
	const source = createObject<Record<string, unknown>>();
	const copy = createObject<Record<string, unknown>>(undefined, idOf(source));
	atomic(() => {
		source.text = 'a';
		source.num = 1;
		source.flag = true;
		source.blob = new Uint8Array([1]);
		source.gone = 'here';
	});
	apply(copy, reconcile(copy, snapshot(source))!);

	atomic(() => {
		source.text = 'b';
		source.num = 2;
		source.flag = false;
		source.blob = new Uint8Array([2]);
		delete source.gone;
	});
	const fix = reconcile(copy, snapshot(source))!;
	assert.equal(fix.deltas.length, 5, 'four replaces and one remove');
	assert.equal(fix.deltas.filter((d) => d.type === 'remove').length, 1);
	apply(copy, fix);
	equal(copy, source, 'every shape of change crossed');
});

test('reconcile sees a byte string that changed content but not length', () => {
	const source = createObject<Record<string, unknown>>({ blob: new Uint8Array([1, 2]) });
	const copy = createObject<Record<string, unknown>>(undefined, idOf(source));
	apply(copy, asCommit(source)!);
	source.blob = new Uint8Array([1, 3]);
	assert.notEqual(reconcile(copy, snapshot(source)), undefined, 'bytes compare by content');
});

test('reconcile follows an observable that moved rather than re-sending it', () => {
	const source = createObject<Record<string, unknown>>();
	const copy = createObject<Record<string, unknown>>(undefined, idOf(source));
	const moved = createObject({ deep: 'value' });
	atomic(() => {
		source.left = createArray<object>([moved]);
		source.right = createArray<object>();
	});
	apply(copy, asCommit(source)!);

	atomic(() => {
		(source.left as object[]).splice(0, 1);
		(source.right as object[]).push(moved);
	});
	const fix = reconcile(copy, snapshot(source))!;
	assert.equal(fix.deltas.length, 2, 'one slot given up and one taken, not a resend of the subtree');
	apply(copy, fix);
	equal(copy, source, 'the move crossed');
});

test('reconcile crosses an alias and the observable it names', () => {
	const source = createObject<Record<string, unknown>>();
	const copy = createObject<Record<string, unknown>>(undefined, idOf(source));
	const task = createObject({ title: 'a' });
	atomic(() => {
		source.tasks = createArray<object>([task]);
		source.featured = alias(task);
	});
	apply(copy, reconcile(copy, snapshot(source))!);
	equal(copy, source, 'the alias points at the same observable on both sides');
});

// The property this whole package rests on: whatever a document reaches, one commit says it
// and one commit corrects it. Both directions, over a stream nobody chose by hand.
test('over a random edit stream, a replica rebuilt and a replica corrected both match', () => {
	const rng = randomFrom(20260902);
	const source = createObject<Record<string, unknown>>();
	const corrected = createObject<Record<string, unknown>>(undefined, idOf(source));
	const tasks = createArray<Record<string, unknown>>();
	const people = createMap<Record<string, unknown>>();
	atomic(() => {
		source.tasks = tasks;
		source.people = people;
	});

	for (let round = 0; round < 60; round++) {
		const roll = randomBelow(rng, 10);
		if (roll < 3) {
			tasks.push(createObject({ title: `t${round}`, done: false, weight: round }));
		} else if (roll < 4 && tasks.length > 0) {
			tasks.splice(randomBelow(rng, tasks.length), 1);
		} else if (roll < 6) {
			people.add(createObject({ name: `p${round}` }));
		} else if (roll < 7 && people.size > 0) {
			people.delete(people.keys()[randomBelow(rng, people.size)]!);
		} else if (roll < 9 && tasks.length > 0) {
			tasks[randomBelow(rng, tasks.length)]!.title = `edited ${round}`;
		} else {
			source.round = round;
		}

		const fix = reconcile(corrected, snapshot(source));
		if (fix !== undefined) apply(corrected, fix);
		equal(corrected, source, `corrected replica at round ${round}`);
		equal(rebuild(source), source, `rebuilt replica at round ${round}`);
	}
});

test('rootFrom mints an empty root of the kind and id it is given, and refuses a kind that is not one', () => {
	const id = idOf(createObject());
	for (const kind of ['object', 'array', 'map'] as const) {
		const root = rootFrom(id, kind);
		assert.equal(kindOf(root), kind);
		assert.deepEqual(idOf(root), id, 'the id is the one asked for, so commits about it are reachable');
		assert.equal(asCommit(root), undefined, 'it holds nothing');
	}
	assert.throws(() => rootFrom(id, 'set' as never), /kind-conflict/);
});

test('mirror keeps a second document in step with the first, both ways, until stopped', async () => {
	const source = createObject<Record<string, unknown>>({ title: 'draft', list: createArray([1]) });
	const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 0));

	const { document, stop } = mirror(source);
	assert.notEqual(document, source, 'a second document, not the same object');
	assert.deepEqual(idOf(document), idOf(source), 'of the same identity');
	await settle();
	assert.equal(canonicalJson(snapshot(document)), canonicalJson(snapshot(source)), 'starting where the source is');

	source['title'] = 'one';
	await settle();
	assert.equal((document as Record<string, unknown>)['title'], 'one', 'a source write reaches the copy');

	(document as Record<string, unknown>)['title'] = 'two';
	await settle();
	assert.equal(source['title'], 'two', 'and a copy write reaches the source');

	stop();
	source['title'] = 'three';
	await settle();
	assert.equal((document as Record<string, unknown>)['title'], 'two', 'nothing crosses after stop');
});

test('mirror moves a target that holds something else to the source, and refuses a source that is not a document', async () => {
	const source = createObject<Record<string, unknown>>({ title: 'theirs' });
	const target = createObject<Record<string, unknown>>({ title: 'mine', extra: 1 }, idOf(source));
	const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 0));

	const { document, stop } = mirror(source, target);
	assert.equal(document, target, 'the target handed in is the document kept in step');
	await settle();
	assert.equal(canonicalJson(snapshot(target)), canonicalJson(snapshot(source)), 'moved to the source, extra slot and all');
	stop();

	assert.throws(() => mirror({ not: 'a document' }), /not-observable/);
});
