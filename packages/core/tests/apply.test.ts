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

import {
	apply, atomic, createArray, createMap, createObject, idOf, observer, snapshot,
} from '../src/index.ts';
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

// The same argument as the slot-key test below, one field over. A value the encoder refuses
// is worse than a bad key, because a local write is checked and an applied commit was not:
// the document then holds something its own bytes cannot say, every byte client is refused
// for good, and on a served document the encoder's throw arrives in an outbox microtask,
// where it takes the process rather than the link.
test('a value the format cannot carry is refused where it is applied', () => {
	for (const [what, value, reason] of [
		['a lone high surrogate', 'hello \ud83d', 'lone-surrogate'],
		['a lone low surrogate', '\udc00 alone', 'lone-surrogate'],
		['Infinity', Infinity, 'invalid-number'],
		['NaN', NaN, 'invalid-number'],
	] as const) {
		const doc = createObject() as Record<string, unknown>;
		assert.throws(
			() => apply(doc, {
				deltas: [{ type: 'add', id: idOf(doc), ref: { kind: 'object', key: 'x' }, value }],
			}),
			(error: Error & { reason?: string }) => {
				assert.equal(error.reason, reason, what);
				return true;
			},
			what,
		);
		assert.equal('x' in doc, false, `${what} left nothing behind`);
	}
});

test('a local write refuses the same values, at the write', () => {
	const doc = createObject() as Record<string, unknown>;

	assert.throws(() => { doc.title = 'hello \ud83d'; }, /lone-surrogate/);
	assert.throws(() => { doc.count = Infinity; }, /invalid-number/);

	doc.title = 'fine';
	assert.deepEqual(
		{ ...doc }, { title: 'fine' }, 'and the document carries neither refused value',
	);
});

// The decoder refuses a slot key the format forbids, so a commit that arrived as bytes has
// been through that check. One handed straight over in the same process has not, and a key
// the format forbids applied here makes a document nothing can ever encode: every later
// reader is refused, and the refusal comes from the encoder rather than from whoever wrote
// the bad key. `spec/format.md` 6.6 lists these as apply-stage refusals, so the applier is
// where they belong.
test('a slot key the format forbids is refused where it is applied, not where it is read', () => {
	const doc = createArray<number>();
	const id = idOf(doc);

	for (const [what, key] of [
		['ending in a zero byte', Uint8Array.of(0x80, 0x00)],
		['empty', new Uint8Array(0)],
		['a single zero', Uint8Array.of(0x00)],
	] as const) {
		assert.throws(
			() => apply(doc, { deltas: [{ type: 'add', id, ref: { kind: 'array', key }, value: 1 }] }),
			(error: Error & { reason?: string }) => {
				assert.equal(error.reason, 'invalid-position', what);
				return true;
			},
			what,
		);
	}
	assert.equal(doc.length, 0, 'and nothing was applied');

	const map = createMap();
	assert.throws(
		() => apply(map, {
			deltas: [{
				type: 'add', id: idOf(map), ref: { kind: 'map', key: Uint8Array.of(1, 2, 3) }, value: 1,
			}],
		}),
		/invalid-id/,
		'a map slot is named by an id, and a short one is not',
	);
});
