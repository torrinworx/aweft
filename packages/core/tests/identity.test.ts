// Getting from an id to an observable, and from an observable to where it sits.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bytesToHex, idToText, slotKeyOf } from '@aweftjs/codec';
import type { Delta } from '@aweftjs/codec';
import {
	atomic, byId, createArray, createMap, createObject, idOf, isReachable, observer, pathOf,
	positionsOf, textIdOf,
} from '@aweftjs/core';

const build = () => {
	const task = createObject<Record<string, unknown>>({ title: 'plan' });
	const list = createArray<object>([task]);
	const entry = createObject<Record<string, unknown>>({ name: 'a' });
	const people = createMap<object>();
	people.add(entry);
	const doc = createObject<Record<string, unknown>>({ tasks: list, people });
	return { doc, list, task, people, entry };
};

test('byId answers the root and anything below it, by bytes or by text', () => {
	const { doc, task, entry } = build();
	assert.equal(byId(doc, idOf(doc)), doc);
	assert.equal(byId(doc, textIdOf(doc)), doc);
	assert.equal(byId(task, idOf(entry)), entry, 'asked from anywhere in the document');
	assert.equal(byId(doc, idOf(createObject())), undefined, 'an id the document never held');
});

test('byId stops finding a row the list cleared, and everything under it', () => {
	const { doc, task } = build();
	(doc.tasks as unknown[]).splice(0, 1);
	assert.equal(isReachable(task), false);
	assert.equal(byId(doc, idOf(task)), undefined, 'the commit that detached it took it out (084)');

	// The whole subtree goes, not only the observable whose edge went.
	const inner = createObject({ deep: true });
	const held = createArray<object>([inner]);
	doc.held = held;
	assert.equal(byId(doc, idOf(inner)), inner);
	delete (doc as Record<string, unknown>)['held'];
	assert.equal(byId(doc, idOf(held)), undefined);
	assert.equal(byId(doc, idOf(inner)), undefined, 'the subtree under the detached top');
});

test('re-attaching what was dropped puts it and its subtree back in the document', () => {
	const { doc, task } = build();
	(doc.tasks as unknown[]).splice(0, 1);

	const done = createArray<object>();
	doc.done = done;
	done.push(task);
	assert.equal(byId(doc, idOf(task)), task, 'attaching it again re-indexes it');
	assert.equal(isReachable(task), true);
});

test('an observable moved inside one block stays in the document', () => {
	const doc = createObject<Record<string, unknown>>();
	const from = createArray<Record<string, unknown>>();
	const to = createArray<Record<string, unknown>>();
	doc['from'] = from;
	doc['to'] = to;
	const task = createObject<Record<string, unknown>>({ label: 'a' });
	from.push(task);

	atomic(() => { from.splice(0, 1); to.push(task); });
	assert.equal(byId(doc, idOf(task)), task, 'a move is not a drop');
	assert.equal(isReachable(task), true);

	// And moving it again says nothing about the row itself, because the document never lost it.
	const seen: Delta[][] = [];
	const stop = observer(doc).watch((change) => seen.push([...change.deltas]));
	const third = createArray<Record<string, unknown>>();
	doc['third'] = third;
	atomic(() => { to.splice(0, 1); third.push(task); });
	stop();
	assert.equal(seen.at(-1)!.length, 2, 'the two edges, and nothing about the row');
});

test('pathOf spells each step the way a delta spells its slot', () => {
	const { doc, list, task, entry } = build();
	assert.deepEqual(pathOf(doc), []);
	assert.deepEqual(pathOf(task), ['tasks', bytesToHex(positionsOf(list)[0]!)]);
	assert.deepEqual(pathOf(entry), ['people', textIdOf(entry)]);

	// The last step of an attached observable is the slot the attaching delta names.
	const seen: Delta[] = [];
	observer(doc).watch((change) => seen.push(...change.deltas));
	const fresh = createObject({ title: 'new' });
	list.push(fresh);
	const attach = seen.find((d) => idToText(d.id) === textIdOf(list))!;
	assert.equal(pathOf(fresh)!.at(-1), slotKeyOf(attach.ref));
});

test('pathOf follows a move and forgets a detach', () => {
	const { doc, task } = build();
	const done = createArray<object>();
	doc.done = done;
	(doc.tasks as unknown[]).splice(0, 1);
	assert.equal(pathOf(task), undefined, 'detached: nothing attaches it');
	done.push(task);
	assert.deepEqual(pathOf(task), ['done', bytesToHex(positionsOf(done)[0]!)]);
});
