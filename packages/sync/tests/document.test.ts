import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	alias, apply, atomic, createArray, createMap, createObject, idOf, snapshot,
} from '@aweftjs/core';
import { canonicalJson, randomBelow, randomFrom } from '@aweftjs/testing';
import { asCommit, reconcile } from '@aweftjs/sync';

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
	const server = createObject<Record<string, unknown>>();
	const client = createObject<Record<string, unknown>>(undefined, idOf(server));

	atomic(() => {
		server.title = 'plan';
		server.tasks = createArray<object>();
	});
	const fix = reconcile(client, snapshot(server));
	assert.ok(fix !== undefined);
	apply(client, fix);
	equal(client, server, 'the client caught up');

	// The document itself is still the one the caller holds.
	const held = client;
	const list = server.tasks as object[];
	atomic(() => { list.push(createObject({ title: 'x' })); });
	server.title = 'plan b';

	const second = reconcile(client, snapshot(server));
	assert.ok(second !== undefined);
	apply(client, second);
	equal(client, server, 'and again, after two more changes');
	assert.equal(held, client, 'the same object throughout');
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
	const server = createObject<Record<string, unknown>>();
	const client = createObject<Record<string, unknown>>(undefined, idOf(server));
	atomic(() => {
		server.text = 'a';
		server.num = 1;
		server.flag = true;
		server.blob = new Uint8Array([1]);
		server.gone = 'here';
	});
	apply(client, reconcile(client, snapshot(server))!);

	atomic(() => {
		server.text = 'b';
		server.num = 2;
		server.flag = false;
		server.blob = new Uint8Array([2]);
		delete server.gone;
	});
	const fix = reconcile(client, snapshot(server))!;
	assert.equal(fix.deltas.length, 5, 'four replaces and one remove');
	assert.equal(fix.deltas.filter((d) => d.type === 'remove').length, 1);
	apply(client, fix);
	equal(client, server, 'every shape of change crossed');
});

test('reconcile sees a byte string that changed content but not length', () => {
	const server = createObject<Record<string, unknown>>({ blob: new Uint8Array([1, 2]) });
	const client = createObject<Record<string, unknown>>(undefined, idOf(server));
	apply(client, asCommit(server)!);
	server.blob = new Uint8Array([1, 3]);
	assert.notEqual(reconcile(client, snapshot(server)), undefined, 'bytes compare by content');
});

test('reconcile follows an observable that moved rather than re-sending it', () => {
	const server = createObject<Record<string, unknown>>();
	const client = createObject<Record<string, unknown>>(undefined, idOf(server));
	const moved = createObject({ deep: 'value' });
	atomic(() => {
		server.left = createArray<object>([moved]);
		server.right = createArray<object>();
	});
	apply(client, asCommit(server)!);

	atomic(() => {
		(server.left as object[]).splice(0, 1);
		(server.right as object[]).push(moved);
	});
	const fix = reconcile(client, snapshot(server))!;
	assert.equal(fix.deltas.length, 2, 'one slot given up and one taken, not a resend of the subtree');
	apply(client, fix);
	equal(client, server, 'the move crossed');
});

test('reconcile crosses an alias and the observable it names', () => {
	const server = createObject<Record<string, unknown>>();
	const client = createObject<Record<string, unknown>>(undefined, idOf(server));
	const task = createObject({ title: 'a' });
	atomic(() => {
		server.tasks = createArray<object>([task]);
		server.featured = alias(task);
	});
	apply(client, reconcile(client, snapshot(server))!);
	equal(client, server, 'the alias points at the same observable on both sides');
});

// The property this whole package rests on: whatever a document reaches, one commit says it
// and one commit corrects it. Both directions, over a stream nobody chose by hand.
test('over a random edit stream, a replica rebuilt and a replica corrected both match', () => {
	const rng = randomFrom(20260902);
	const server = createObject<Record<string, unknown>>();
	const corrected = createObject<Record<string, unknown>>(undefined, idOf(server));
	const tasks = createArray<Record<string, unknown>>();
	const people = createMap<Record<string, unknown>>();
	atomic(() => {
		server.tasks = tasks;
		server.people = people;
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
			server.round = round;
		}

		const fix = reconcile(corrected, snapshot(server));
		if (fix !== undefined) apply(corrected, fix);
		equal(corrected, server, `corrected replica at round ${round}`);
		equal(rebuild(server), server, `rebuilt replica at round ${round}`);
	}
});
