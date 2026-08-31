// What a commit contains, when it closes, and what happens when a block does not finish.

import test from 'node:test';
import assert from 'node:assert/strict';

import { encodeCommit, idToText } from '@aweftjs/codec';
import type { Delta } from '@aweftjs/codec';

import { atomic, createArray, createObject, observer, parentOf, textIdOf } from '../src/index.ts';
import type { Change } from '../src/index.ts';

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
