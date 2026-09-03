// Getting from an id to an observable, and from an observable to where it sits.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bytesToHex, idToText, slotKeyOf } from '@aweftjs/codec';
import type { Delta } from '@aweftjs/codec';
import {
	byId, createArray, createMap, createObject, idOf, isReachable, observer, pathOf, positionsOf,
	textIdOf,
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

test('byId still finds what nothing attaches', () => {
	const { doc, task } = build();
	(doc.tasks as unknown[]).splice(0, 1);
	assert.equal(isReachable(task), false);
	assert.equal(byId(doc, idOf(task)), task);
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
