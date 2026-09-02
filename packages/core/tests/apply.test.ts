// Applying a commit from elsewhere, and undoing one by inversion.
//
// The rejection fixtures already prove that a commit breaking a rule is refused for the stated
// reason. What they cannot say is what a live tree does around that: that a refused commit
// changed nothing, that watchers hear an applied one once, and that the commit a change hands
// back really does put the document where it was.

import test from 'node:test';
import assert from 'node:assert/strict';

import { decodeCommit, encodeCommit } from '@aweftjs/codec';
import type { Commit } from '@aweftjs/codec';

import { apply, atomic, createArray, createObject, idOf, observer, snapshot } from '../src/index.ts';
import type { Change } from '../src/index.ts';

interface Block {
	text: string;
}

interface Doc extends Record<string, unknown> {
	title?: string;
	count?: number;
	blocks?: Block[];
}

/** One document mutated, another fed the commits it produced. The pair is a replica. */
const replicated = (): { source: Doc; replica: Doc } => {
	const source = createObject<Doc>();
	const replica = createObject<Doc>(undefined, idOf(source));

	observer(source).watch((change) => {
		// Through the encoder and back, so what crosses is bytes rather than the same objects.
		apply(replica, decodeCommit(encodeCommit({ deltas: [...change.deltas] })));
	});

	return { source, replica };
};

test('a commit crosses to another document and reaches the same state', () => {
	const { source, replica } = replicated();

	source.title = 'notes';
	atomic(() => {
		source.count = 2;
		source.blocks = createArray<Block>([createObject<Block>({ text: 'hi' })]);
	});
	source.blocks!.push(createObject<Block>({ text: 'there' }));
	source.blocks!.shift();

	assert.deepEqual(snapshot(replica), snapshot(source));
});

test('a refused commit changes nothing and tells no one', () => {
	const doc = createObject<Doc>({ title: 'a' });
	const before = snapshot(doc);
	const seen: Change[] = [];
	observer(doc).watch((change) => seen.push(change));

	const other = createObject<Doc>({ title: 'b' });
	const commits: Change[] = [];
	observer(other).watch((change) => commits.push(change));
	other.count = 7;

	assert.throws(() => apply(doc, { deltas: [...commits[0]!.deltas] }), { reason: 'unreachable' });
	assert.deepEqual(snapshot(doc), before);
	assert.equal(seen.length, 0);
});

test('applying tells watchers once, with the deltas in their scope', () => {
	const { source, replica } = replicated();
	const seen: Change[] = [];
	observer(replica).path('blocks').watch((change) => seen.push(change));

	atomic(() => {
		source.title = 'notes';
		source.blocks = createArray<Block>([createObject<Block>({ text: 'hi' })]);
	});

	assert.equal(seen.length, 1);
	assert.equal(seen[0]!.deltas.length, 3, 'the array, its element and the element text, not the title');
});

test('a change hands back the commit that undoes it', () => {
	const doc = createObject<Doc>({ title: 'a' });
	const seen: Change[] = [];
	observer(doc).watch((change) => seen.push(change));

	const before = snapshot(doc);
	atomic(() => {
		doc.title = 'b';
		doc.count = 2;
		doc.blocks = createArray<Block>([createObject<Block>({ text: 'hi' })]);
	});

	apply(doc, seen[0]!.inverse());
	assert.deepEqual(snapshot(doc), before);
});

test('undo is a commit, so undoing it again is redo', () => {
	const doc = createObject<Doc>({ title: 'a' });
	const seen: Change[] = [];
	observer(doc).watch((change) => seen.push(change));

	doc.title = 'b';
	const after = snapshot(doc);

	apply(doc, seen[0]!.inverse());
	assert.equal(doc.title, 'a');

	apply(doc, seen[1]!.inverse());
	assert.deepEqual(snapshot(doc), after);
	assert.equal(doc.title, 'b');
});

test('a removal inverts to the value that was there', () => {
	const doc = createObject<Doc>({ title: 'a', count: 2 });
	const seen: Change[] = [];
	observer(doc).watch((change) => seen.push(change));

	delete doc.count;
	apply(doc, seen[0]!.inverse());

	assert.equal(doc.count, 2);
});

test('an empty commit is refused', () => {
	const doc = createObject<Doc>();
	assert.throws(() => apply(doc, { deltas: [] }), { reason: 'empty-commit' });
	assert.throws(() => apply({}, { deltas: [] }), { reason: 'not-observable' });
});

test('an integrity tag is carried without being checked', () => {
	const source = createObject<Doc>();
	const target = createObject<Doc>(undefined, idOf(source));
	const seen: Change[] = [];
	observer(source).watch((change) => seen.push(change));

	source.title = 'notes';
	const tagged = { deltas: [...seen[0]!.deltas], tag: Uint8Array.of(1, 2, 3, 4) };

	assert.doesNotThrow(() => apply(target, tagged));
	assert.equal(target.title, 'notes');
});

test('a commit applied from inside a watcher delivers after that watcher has returned', () => {
	// Userspace calls are deferred, so a nested apply's own deliveries queue behind the
	// delivery already running. A flag held across the apply call is therefore already clear
	// when the second document's watchers see the commit, which is exactly what a replication
	// seam reaches for first. The README and apply's own docs say to queue instead, and this is
	// the behaviour they are describing.
	const source = createObject<Record<string, unknown>>();
	const mirror = createObject<Record<string, unknown>>(undefined, idOf(source));

	let inside = false;
	const seen: boolean[] = [];

	observer(source).watch((change) => {
		inside = true;
		apply(mirror, change);
		inside = false;
	});
	observer(mirror).watch(() => seen.push(inside));

	source.title = 'shared';

	assert.deepEqual(seen, [false], 'the mirror watcher ran while the flag was already clear');
});

test('the same commit applied outside a delivery does reach the mirror watcher inside the flag', () => {
	const source = createObject<Record<string, unknown>>();
	const mirror = createObject<Record<string, unknown>>(undefined, idOf(source));

	const queued: Commit[] = [];
	observer(source).watch((change) => queued.push({ deltas: [...change.deltas] }));

	let inside = false;
	const seen: boolean[] = [];
	observer(mirror).watch(() => seen.push(inside));

	source.title = 'shared';

	inside = true;
	for (const commit of queued) apply(mirror, commit);
	inside = false;

	assert.deepEqual(seen, [true], 'applying outside the delivery keeps the flag meaningful');
});
