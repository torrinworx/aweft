// What a commit contains, when it closes, and what happens when a block does not finish.

import test from 'node:test';
import assert from 'node:assert/strict';

import { encodeCommit, idToText } from '@aweftjs/codec';
import type { Delta } from '@aweftjs/codec';

import {
	apply, atomic, createArray, createObject, idOf, observer, parentOf, snapshot, textIdOf,
} from '../src/index.ts';
import type { Change, Commit } from '../src/index.ts';

interface Block {
	text: string;
}

interface Doc extends Record<string, unknown> {
	title?: string;
	width?: number;
	height?: number;
	blocks?: Block[];
	held?: Block;
	moved?: Block;
}

const recorded = (target: object): Change[] => {
	const seen: Change[] = [];
	observer(target).watch((change) => seen.push(change));
	return seen;
};

const shapeOf = (deltas: readonly Delta[]): string[] =>
	deltas.map((d) => `${d.type} ${idToText(d.id)} ${String(d.ref.key)}`);

test('one mutation is one commit', () => {
	const doc = createObject<Doc>({ title: 'a' });
	const seen = recorded(doc);

	doc.title = 'b';
	doc.width = 3;

	assert.equal(seen.length, 2);
	assert.deepEqual(seen[0]!.deltas.map((d) => d.type), ['replace']);
	assert.deepEqual(seen[1]!.deltas.map((d) => d.type), ['add']);
});

test('a block is one commit, however many mutations it made', () => {
	const doc = createObject<Doc>({ title: 'a' });
	const seen = recorded(doc);

	atomic(() => {
		doc.width = 3;
		doc.height = 4;
		doc.title = 'b';
	});

	assert.equal(seen.length, 1);
	assert.equal(seen[0]!.deltas.length, 3);
});

test('a nested block joins the one already open', () => {
	const doc = createObject<Doc>();
	const seen = recorded(doc);

	const out = atomic(() => {
		doc.width = 1;
		return atomic(() => {
			doc.height = 2;
			return 'done';
		});
	});

	assert.equal(out, 'done');
	assert.equal(seen.length, 1);
	assert.equal(seen[0]!.deltas.length, 2);
});

test('a slot written twice in one block appears once, as its net effect', () => {
	const doc = createObject<Doc>({ title: 'a' });
	const seen = recorded(doc);

	atomic(() => {
		doc.title = 'b';
		doc.title = 'c';
		doc.width = 1;
		delete doc.width;
	});

	assert.equal(seen.length, 1);
	assert.deepEqual(seen[0]!.deltas.map((d) => [d.type, d.value]), [['replace', 'c']]);
});

test('a slot whose net effect is no change is not in the commit at all', () => {
	const doc = createObject<Doc>({ title: 'a' });
	const seen = recorded(doc);

	atomic(() => {
		doc.title = 'b';
		doc.title = 'a';
	});

	assert.equal(seen.length, 0, 'nothing changed, so there is nothing to send');
});

test('writing a slot the value it already holds is not a change', () => {
	const doc = createObject<Doc>({ title: 'a' });
	const seen = recorded(doc);

	doc.title = 'a';
	assert.equal(seen.length, 0);
});

test('a subtree arriving in the document arrives whole, in one commit', () => {
	const doc = createObject<Doc>();
	const seen = recorded(doc);

	doc.blocks = createArray<Block>([createObject<Block>({ text: 'hi' })]);

	assert.equal(seen.length, 1);
	assert.equal(seen[0]!.deltas.length, 3, 'the array, the element, and the element text');
	assert.doesNotThrow(() => encodeCommit({ deltas: [...seen[0]!.deltas] }));
});

test('a commit built here is one the encoder accepts, in canonical order', () => {
	const doc = createObject<Doc>();
	const seen = recorded(doc);

	atomic(() => {
		doc.blocks = createArray<Block>([createObject<Block>({ text: 'hi' })]);
		doc.title = 'notes';
	});

	const deltas = [...seen[0]!.deltas];
	const bytes = encodeCommit({ deltas });
	const shuffled = encodeCommit({ deltas: [...deltas].reverse() });

	assert.deepEqual(bytes, shuffled, 'the order deltas were delivered in is already canonical');
});

test('a move is one commit that removes one edge and adds another', () => {
	const doc = createObject<Doc>({ held: createObject<Block>({ text: 'hi' }) });
	const seen = recorded(doc);
	const block = doc.held!;

	atomic(() => {
		doc.moved = block;
		delete doc.held;
	});

	assert.equal(seen.length, 1);
	assert.deepEqual(shapeOf(seen[0]!.deltas).sort(), [
		`add ${textIdOf(doc)} moved`,
		`remove ${textIdOf(doc)} held`,
	].sort());
	assert.equal(parentOf(block), doc);
	assert.equal(doc.moved, block);
	assert.equal(doc.held, undefined);
});

test('a move that never let go is refused when the block closes', () => {
	const doc = createObject<Doc>({ held: createObject<Block>({ text: 'hi' }) });
	const seen = recorded(doc);
	const block = doc.held!;

	assert.throws(() => atomic(() => { doc.moved = block; }), { reason: 'multiple-attach' });

	assert.equal(seen.length, 0);
	assert.equal(doc.moved, undefined);
	assert.equal(doc.held, block, 'the tree is exactly as it was');
});

test('a block that throws leaves nothing behind', () => {
	const doc = createObject<Doc>({ title: 'a' });
	const seen = recorded(doc);

	assert.throws(() => atomic(() => {
		doc.title = 'b';
		doc.blocks = createArray<Block>([createObject<Block>({ text: 'hi' })]);
		throw new Error('stop');
	}), /stop/);

	assert.equal(seen.length, 0);
	assert.equal(doc.title, 'a');
	assert.equal(doc.blocks, undefined);
});

test('a block that throws puts an observable it moved back where it was', () => {
	const block = createObject<Block>({ text: 'hi' });
	const doc = createObject<Doc>({ held: block });
	const seen = recorded(doc);

	assert.throws(() => atomic(() => {
		doc.moved = block;
		delete doc.held;
		throw new Error('stop');
	}), /stop/);

	assert.equal(seen.length, 0);
	assert.equal(doc.held, block);
	assert.equal(doc.moved, undefined);
	assert.equal(parentOf(block), doc);
});

test('a block cannot be asynchronous, and says so rather than closing early', () => {
	const doc = createObject<Doc>();

	assert.throws(
		() => atomic(() => { doc.title = 'a'; return Promise.resolve(1); }),
		{ reason: 'async-atomic' },
	);
	assert.equal(doc.title, undefined, 'the block that could not close changed nothing');
});

test('a document nothing watches still mutates, and joins a watched one whole', () => {
	const draft = createObject<Doc>({ title: 'draft' });
	draft.width = 2;

	const doc = createObject<Doc>();
	const seen = recorded(doc);
	doc.blocks = createArray<Block>();
	seen.length = 0;

	doc.held = draft as unknown as Block;
	assert.equal(seen.length, 1);
	assert.equal(seen[0]!.deltas.length, 3, 'the edge, and both slots the draft already had');
});

test('an observable that lost its edge cannot be written to on its own', () => {
	const doc = createObject<Doc>({ held: createObject<Block>({ text: 'hi' }) });
	recorded(doc);

	const block = doc.held!;
	delete doc.held;

	assert.throws(() => { block.text = 'later'; }, { reason: 'unreachable' });
	assert.equal(block.text, 'hi', 'the refused write changed nothing');
});

test('detaching and reattaching in one block writes into the subtree on the way', () => {
	const doc = createObject<Doc>({ held: createObject<Block>({ text: 'hi' }) });
	const seen = recorded(doc);
	const block = doc.held!;

	atomic(() => {
		block.text = 'later';
		doc.moved = block;
		delete doc.held;
	});

	assert.equal(seen.length, 1);
	assert.equal(seen[0]!.deltas.length, 3);
	assert.equal(doc.moved!.text, 'later');
});

test('re-attaching a dropped observable re-sends what it holds, and a replica applies it', () => {
	const doc = createObject<Record<string, unknown>>();
	const mirror = createObject<Record<string, unknown>>(undefined, idOf(doc));

	// Collected rather than applied inside the watcher, because a userspace call from inside a
	// delivery is deferred and would land after this one returned.
	const commits: Commit[] = [];
	observer(doc).watch((change) => commits.push({ deltas: [...change.deltas] }));

	const shelf = createArray<object>();
	const other = createArray<object>();
	doc.shelf = shelf;
	doc.other = other;

	const row = createObject<Record<string, unknown>>({ label: 'a', done: false });
	shelf.push(row);
	shelf.splice(0, 1);
	assert.equal(parentOf(row), undefined, 'nothing attaches it now');

	other.push(row);
	const last = commits.at(-1)!;
	assert.equal(last.deltas.length, 3,
		'the attach edge and the two slots the row holds, because the document had forgotten it');
	assert.equal(last.deltas.filter((d) => idToText(d.id) === textIdOf(row)).length, 2);

	for (const commit of commits) apply(mirror, commit);
	assert.deepEqual(snapshot(mirror), snapshot(doc), 'a replica that dropped it too gets it back');
	assert.equal((((mirror as Record<string, unknown>)['other'] as Record<string, unknown>[])[0])!['label'], 'a');
});

// The inverse of a commit that dropped a subtree has to describe it, because the document has
// forgotten it and a commit that attaches it again says what it holds (design 084).

const undoOf = (doc: object, edit: () => void): Commit => {
	let taken: Commit | undefined;
	const stop = observer(doc).watch((change) => { taken = change.inverse(); });
	edit();
	stop();
	return taken!;
};

test('undoing a removal puts the observable back with everything it held', () => {
	const doc = createObject<Record<string, unknown>>();
	const rows = createArray<Record<string, unknown>>();
	doc['rows'] = rows;
	const row = createObject<Record<string, unknown>>({ label: 'a', done: false });
	const inner = createObject({ note: 'n' });
	row['inner'] = inner;
	rows.push(row);

	const undo = undoOf(doc, () => { rows.splice(0, 1); });
	assert.equal(idOf(row).length, 12);

	apply(doc, undo);
	const back = (doc['rows'] as Record<string, unknown>[])[0]!;
	assert.equal(textIdOf(back), textIdOf(row), 'the same id came back');
	assert.equal(back['label'], 'a');
	assert.equal(back['done'], false);
	assert.equal((back['inner'] as Record<string, unknown>)['note'], 'n', 'and the subtree under it');
});

test('the inverse of an edit and a removal in one block restores what was there before it', () => {
	const doc = createObject<Record<string, unknown>>();
	const rows = createArray<Record<string, unknown>>();
	doc['rows'] = rows;
	const row = createObject<Record<string, unknown>>({ label: 'a', done: false });
	rows.push(row);

	const undo = undoOf(doc, () => {
		atomic(() => {
			row['label'] = 'edited';
			delete row['done'];
			row['fresh'] = 1;
			rows.splice(0, 1);
		});
	});

	apply(doc, undo);
	const back = (doc['rows'] as Record<string, unknown>[])[0]!;
	assert.equal(back['label'], 'a', 'the value from before the block, not the one it wrote');
	assert.equal(back['done'], false, 'a slot the block deleted comes back');
	assert.equal(back['fresh'], undefined, 'a slot the block added does not');
});

test('the inverse of a dropped subtree names what it held then, not what it holds now', () => {
	const doc = createObject<Record<string, unknown>>();
	const mirror = createObject<Record<string, unknown>>(undefined, idOf(doc));

	const commits: Commit[] = [];
	const changes: Change[] = [];
	observer(doc).watch((change) => {
		commits.push({ deltas: [...change.deltas] });
		changes.push(change);
	});

	const rows = createArray<Record<string, unknown>>();
	doc['rows'] = rows;
	const row = createObject<Record<string, unknown>>({ label: 'a' });
	rows.push(row);

	const at = commits.length;
	rows.splice(0, 1);
	const dropped = changes[at]!;

	// The replica has seen everything up to and including the commit that dropped the row.
	for (const commit of commits) apply(mirror, commit);

	// Two later commits put the row back and edit it. Neither is in the commit being undone.
	rows.push(row);
	row['label'] = 'edited';

	apply(mirror, dropped.inverse());
	const back = (mirror['rows'] as Record<string, unknown>[])[0]!;
	assert.equal(back['label'], 'a', 'the value from before the commit, not the one written after it');
});

test('an observable that came and went inside one block is not in the commit', () => {
	const doc = createObject<Doc>({ title: 'a' });
	const seen = recorded(doc);

	atomic(() => {
		doc.held = createObject<Block>({ text: 'hi' });
		delete doc.held;
		doc.title = 'b';
	});

	assert.equal(seen.length, 1);
	assert.deepEqual(seen[0]!.deltas.map((d) => d.type), ['replace']);
});
