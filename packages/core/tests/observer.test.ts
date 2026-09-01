// Scopes: what a listener sees, and what it does not.

import test from 'node:test';
import assert from 'node:assert/strict';

import { alias, atomic, createArray, createObject, observer } from '../src/index.ts';
import type { Change } from '../src/index.ts';

interface Block {
	text: string;
	done?: boolean;
}

interface Doc extends Record<string, unknown> {
	title?: string;
	draft?: string;
	settings?: Settings;
	blocks?: Block[];
}

interface Settings extends Record<string, unknown> {
	theme?: string;
	draft?: string;
	nested?: Record<string, unknown>;
}

test('a scope keeps the deltas below it and drops the rest', () => {
	const doc = createObject<Doc>({ title: 'a', settings: createObject<Settings>({ theme: 'dark' }) });
	const seen: Change[] = [];
	observer(doc).path('settings').watch((change) => seen.push(change));

	doc.settings!.theme = 'light';
	doc.title = 'b';

	assert.equal(seen.length, 1);
	assert.equal(seen[0]!.deltas.length, 1);
	assert.equal(seen[0]!.deltas[0]!.value, 'light');
});

test('a scope on a slot fires for that slot and nothing beside it', () => {
	const doc = createObject<Doc>({ settings: createObject<Settings>({ theme: 'dark', draft: 'x' }) });
	const seen: Change[] = [];
	observer(doc).path('settings', 'theme').watch((change) => seen.push(change));

	doc.settings!.draft = 'y';
	assert.equal(seen.length, 0);

	doc.settings!.theme = 'light';
	assert.equal(seen.length, 1);
});

test('a scope reads and writes what its path names', () => {
	const doc = createObject<Doc>({ settings: createObject<Settings>({ theme: 'dark' }) });
	const theme = observer(doc).path('settings', 'theme');

	assert.equal(theme.get(), 'dark');
	theme.set('light');
	assert.equal(doc.settings!.theme, 'light');

	assert.equal(observer(doc).get(), doc, 'a scope with no path is the observable itself');
	assert.equal(observer(doc).path('settings').get(), doc.settings);
	assert.equal(observer(doc).path('missing', 'deeper').get(), undefined);

	assert.throws(() => observer(doc).set('x'), { reason: 'slot-missing' });
	assert.throws(() => observer(doc).path('missing', 'deeper').set('x'), { reason: 'slot-missing' });
	assert.throws(() => observer({}), { reason: 'not-observable' });
});

test('a scope is a description, so it survives the slot it names being replaced', () => {
	const doc = createObject<Doc>();
	const seen: Change[] = [];
	observer(doc).path('settings', 'theme').watch((change) => seen.push(change));

	doc.settings = createObject<Settings>({ theme: 'dark' });
	assert.equal(seen.length, 1, 'the slot arriving is a change to it');

	doc.settings = createObject<Settings>({ theme: 'light' });
	assert.equal(seen.length, 2, 'and so is the whole holder being replaced');

	doc.settings!.theme = 'darker';
	assert.equal(seen.length, 3, 'the scope followed, without being re-registered');
});

test('ignore drops one branch of a scope', () => {
	const doc = createObject<Doc>({ settings: createObject<Settings>({ theme: 'dark', draft: 'x' }) });
	const seen: Change[] = [];
	observer(doc).path('settings').ignore('draft').watch((change) => seen.push(change));

	doc.settings!.draft = 'y';
	assert.equal(seen.length, 0);

	doc.settings!.theme = 'light';
	assert.equal(seen.length, 1);
});

test('ignore drops everything under the branch, not just the slot itself', () => {
	const doc = createObject<Doc>({
		settings: createObject<Settings>({ nested: createObject<Record<string, unknown>>({ a: 1 }) }),
	});
	const seen: Change[] = [];
	observer(doc).path('settings').ignore('nested').watch((change) => seen.push(change));

	(doc.settings!.nested as Record<string, unknown>).a = 2;
	assert.equal(seen.length, 0);
});

test('shallow keeps only the scoped observable own slots', () => {
	const doc = createObject<Doc>({ settings: createObject<Settings>({ theme: 'dark' }) });
	const seen: Change[] = [];
	observer(doc).shallow().watch((change) => seen.push(change));

	doc.settings!.theme = 'light';
	assert.equal(seen.length, 0, 'that is a change to settings, not to doc');

	doc.title = 'b';
	assert.equal(seen.length, 1);
});

test('an array index names whichever element sits there now', () => {
	const doc = createObject<Doc>({
		blocks: createArray<Block>([createObject<Block>({ text: 'a' }), createObject<Block>({ text: 'b' })]),
	});
	const seen: Change[] = [];
	observer(doc).path('blocks', 0, 'text').watch((change) => seen.push(change));

	assert.equal(observer(doc).path('blocks', 1, 'text').get(), 'b');

	doc.blocks![1]!.text = 'B';
	assert.equal(seen.length, 0);

	doc.blocks![0]!.text = 'A';
	assert.equal(seen.length, 1);

	doc.blocks!.shift();
	doc.blocks![0]!.text = 'still watched';
	assert.equal(seen.length, 2, 'the scope follows the place, not the element that was there');
});

test('an effect runs now and after every change in scope', () => {
	const doc = createObject<Doc>({ title: 'a' });
	const values: unknown[] = [];
	const stop = observer(doc).path('title').effect((value) => values.push(value));

	assert.deepEqual(values, ['a']);
	doc.title = 'b';
	assert.deepEqual(values, ['a', 'b']);

	stop();
	doc.title = 'c';
	assert.deepEqual(values, ['a', 'b']);
});

test('watching returns its unsubscribe, and unsubscribing twice is harmless', () => {
	const doc = createObject<Doc>();
	const seen: Change[] = [];
	const stop = observer(doc).watch((change) => seen.push(change));

	doc.title = 'a';
	stop();
	stop();
	doc.title = 'b';

	assert.equal(seen.length, 1);
});

test('narrowing an observer leaves the one it was narrowed from alone', () => {
	const doc = createObject<Doc>({ settings: createObject<Settings>({ theme: 'dark' }) });
	const base = observer(doc);
	const narrow = base.path('settings', 'theme');

	const wide: Change[] = [];
	const tight: Change[] = [];
	base.watch((change) => wide.push(change));
	narrow.watch((change) => tight.push(change));

	doc.title = 'b';
	assert.equal(wide.length, 1);
	assert.equal(tight.length, 0);
});

test('two watchers on one commit are each called once, with what they asked for', () => {
	const doc = createObject<Doc>({ settings: createObject<Settings>({ theme: 'dark' }) });
	const wide: Change[] = [];
	const tight: Change[] = [];

	observer(doc).watch((change) => wide.push(change));
	observer(doc).path('settings').watch((change) => tight.push(change));

	atomic(() => {
		doc.title = 'b';
		doc.settings!.theme = 'light';
	});

	assert.equal(wide.length, 1);
	assert.equal(wide[0]!.deltas.length, 2);
	assert.equal(tight.length, 1);
	assert.equal(tight[0]!.deltas.length, 1);
});

test('a path stops at an alias, so reading and watching agree', () => {
	const person = createObject<Settings>({ theme: 'dark' });
	const doc = createObject<Doc>({ settings: person });
	(doc as Record<string, unknown>).shortcut = alias(person);

	const seen: Change[] = [];
	observer(doc).path('shortcut', 'theme').watch((change) => seen.push(change));

	assert.equal(observer(doc).path('shortcut').get(), person, 'the alias slot still reads');
	assert.equal(
		observer(doc).path('shortcut', 'theme').get(), undefined,
		'but a path does not cross it, because delivery cannot either',
	);

	person.theme = 'light';
	assert.equal(seen.length, 0);
	assert.equal(observer(doc).path('shortcut', 'theme').get(), undefined, 'still nothing, consistently');

	// The attach path is the one that works, for reading and for watching alike.
	const viaAttach: Change[] = [];
	observer(doc).path('settings', 'theme').watch((change) => viaAttach.push(change));
	person.theme = 'darker';

	assert.equal(observer(doc).path('settings', 'theme').get(), 'darker');
	assert.equal(viaAttach.length, 1);

	assert.throws(() => observer(doc).path('shortcut', 'theme').set('x'), { reason: 'slot-missing' });
});

test('a watcher receives a commit in canonical order, not the order the block wrote', () => {
	const doc = createObject<Doc>({});
	const seen: Change[] = [];
	observer(doc).watch((change) => seen.push(change));

	atomic(() => {
		doc.title = 'written first';
		doc.draft = 'written second';
	});

	assert.equal(seen.length, 1);
	const keys = seen[0]!.deltas.map((d) => (d.ref.kind === 'object' ? d.ref.key : ''));
	assert.deepEqual(keys, ['draft', 'title']);
});

test('a scope rooted at a nested observable hears nothing about its siblings', () => {
	const settings = createObject<Settings>({ theme: 'dark' });
	const doc = createObject<Doc>({ title: 'a', settings });
	let heard = 0;

	observer(settings).watch(() => heard += 1);

	doc.title = 'b';
	doc.draft = 'c';
	assert.equal(heard, 0);

	settings.theme = 'light';
	assert.equal(heard, 1);
});
