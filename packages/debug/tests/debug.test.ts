import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	alias, apply, atomic, createArray, createMap, createObject, intercept, observer,
} from '@aweftjs/core';

import { commitOf, documentOf, explain, render, trace } from '../src/index.ts';

const captured = (document: object, write: () => void): { deltas: readonly unknown[] } => {
	let held: { deltas: readonly unknown[] } | undefined;
	const stop = observer(document).watch((change) => { held = { deltas: [...change.deltas] }; });
	write();
	stop();
	assert.ok(held !== undefined, 'the write produced a commit');
	return held;
};

describe('documentOf', () => {
	it('reads primitives as facts and observables as children', () => {
		const doc = createObject<{ title: string; n: number; child: object }>({ title: 'a', n: 1 });
		doc.child = createObject({ leaf: true });

		const text = render(documentOf(doc));
		assert.match(text, /title: 'a'/);
		assert.match(text, /n: 1/);
		assert.match(text, /child: object/);
		assert.match(text, /leaf: true/);
	});

	it('numbers array slots rather than printing position keys', () => {
		const doc = createObject({ items: createArray(['a', 'b', 'c']) });
		const text = render(documentOf(doc));
		assert.match(text, /\[0\]: 'a'/);
		assert.match(text, /\[2\]: 'c'/);
		assert.doesNotMatch(text, /[0-9a-f]{8}/, 'no raw position key reaches the reader');
	});

	it('keeps array order after an insert in the middle', () => {
		const items = createArray(['a', 'c']);
		const doc = createObject({ items });
		items.splice(1, 0, 'b');
		const text = render(documentOf(doc));
		assert.match(text, /\[0\]: 'a'[\s\S]*\[1\]: 'b'[\s\S]*\[2\]: 'c'/);
	});

	it('prints an alias as a back-reference, so a cycle terminates', () => {
		const shared = createObject({ leaf: 1 });
		const doc = createObject<{ one: object; two: object }>({ one: shared });
		// A second attach edge is refused; an alias is the second reference core allows, and it
		// is what makes a cycle reachable at all.
		doc.two = alias(shared);

		const text = render(documentOf(doc));
		assert.equal(text.match(/leaf: 1/g)?.length, 1, 'the contents print once');
		assert.match(text, /already, above in this tree/);
	});

	it('reads a map, whose slots are ids rather than names', () => {
		const by = createMap<object>();
		by.add(createObject({ v: 2 }));
		const doc = createObject({ by });
		const text = render(documentOf(doc));
		assert.match(text, /by: map/);
		assert.match(text, /v: 2/);
	});

	it('says an observable is detached rather than printing the tree it left', () => {
		const doc = createObject<{ name: string; tmp: object }>({ name: 'a' });
		const orphan = createObject({ mine: true });
		doc.tmp = orphan;
		delete (doc as { tmp?: object }).tmp;

		const text = render(documentOf(orphan));
		assert.match(text, /^detached /, 'it names what happened');
		assert.doesNotMatch(text, /name: 'a'/, 'and does not print the document it is no longer in');
	});

	it('refuses something that is not an observable', () => {
		assert.throws(() => documentOf({ plain: true }), { reason: 'not-observable' });
	});
});

describe('commitOf', () => {
	it('names the path when given the document', () => {
		const doc = createObject({ title: 'a' });
		const commit = captured(doc, () => { (doc as { title: string }).title = 'b'; });
		assert.match(render(commitOf(commit as never, doc)), /replace title {2}\(value: 'b'\)/);
	});

	it('names the observable by id when not', () => {
		const doc = createObject({ title: 'a' });
		const commit = captured(doc, () => { (doc as { title: string }).title = 'b'; });
		assert.match(render(commitOf(commit as never)), /in: /);
	});

	it('reads an observable value as a reference, never as [object Object]', () => {
		const doc = createObject({});
		const commit = captured(doc, () => { (doc as { c: unknown }).c = createObject({ x: 1 }); });
		const text = render(commitOf(commit as never, doc));
		assert.match(text, /-> object /);
		assert.doesNotMatch(text, /\[object Object\]/);
	});

	it('counts the deltas an atomic block produced', () => {
		const doc = createObject({ a: 1, b: 2 });
		const commit = captured(doc, () => atomic(() => {
			(doc as { a: number }).a = 3;
			(doc as { b: number }).b = 4;
		}));
		assert.match(render(commitOf(commit as never, doc)), /commit {2}\(deltas: 2\)/);
	});

	it('still reads when handed something that is not the document', () => {
		const doc = createObject({ title: 'a' });
		const commit = captured(doc, () => { (doc as { title: string }).title = 'b'; });
		assert.match(render(commitOf(commit as never, { not: 'a document' })), /replace/);
	});
});

describe('trace', () => {
	it('keeps what landed and stops when told', () => {
		const doc = createObject({ n: 0 });
		const t = trace(doc);

		(doc as { n: number }).n = 1;
		(doc as { n: number }).n = 2;
		assert.equal(t.count(), 2);
		assert.match(t.text(), /replace n {2}\(value: 2\)/);

		t.stop();
		(doc as { n: number }).n = 3;
		assert.equal(t.count(), 2, 'a stopped trace hears nothing more');
		t.stop();
	});

	it('drops the oldest past its limit', () => {
		const doc = createObject({ n: 0 });
		const t = trace(doc, 2);
		for (let i = 1; i <= 5; i++) (doc as { n: number }).n = i;
		assert.equal(t.count(), 2);
		assert.match(t.text(), /value: 5/);
		assert.doesNotMatch(t.text(), /value: 1\b/);
		t.stop();
	});

	it('says the same thing about a commit after the tree above it moves', () => {
		const root = createObject<{ list: { k: number } }>({ list: createObject({ k: 1 }) });
		const t = trace(root);
		root.list.k = 2;
		const before = t.text();

		root.list = createObject({ k: 9 });
		assert.equal(t.text().split('\n\n')[0], before,
			'a path is a fact about the document when the commit landed, not when it is read');
		t.stop();
	});

	it('copies each commit, so a later read is not the last commit repeated', () => {
		const doc = createObject({ n: 0 });
		const t = trace(doc);
		(doc as { n: number }).n = 1;
		(doc as { n: number }).n = 2;
		const text = t.text();
		assert.match(text, /value: 1/);
		assert.match(text, /value: 2/);
		t.stop();
	});
});

describe('explain', () => {
	it('takes a document', () => {
		assert.match(explain(createObject({ a: 1 })), /object .*\(a: 1\)/);
	});

	it('takes a commit', () => {
		const doc = createObject({ a: 1 });
		const commit = captured(doc, () => { (doc as { a: number }).a = 2; });
		assert.match(explain(commit, doc), /^commit/);
	});

	it('takes a refusal and leads with its reason, then its fix', () => {
		let text = '';
		try {
			apply(createObject({}), { deltas: [] });
		} catch (e) {
			text = explain(e);
		}
		assert.match(text, /^refusal empty-commit/);
		assert.match(text, /fix: /);
	});

	it('lays out a RefusedError from a guarded document, one line per refusal', () => {
		const doc = createObject({ n: 1 });
		intercept(doc, () => [
			{ code: 'no-writes', message: 'this document is read only', path: ['n'] },
			{ code: 'second', message: 'and another reason' },
		]);

		let text = '';
		try {
			(doc as { n: number }).n = 2;
		} catch (e) {
			text = explain(e);
		}
		assert.match(text, /^refused {2}\(refusals: 2\)/, 'it says how many rules refused');
		assert.match(text, /refusal no-writes {2}\(at: 'n', message: 'this document is read only'\)/);
		assert.match(text, /refusal second {2}\(message: 'and another reason'\)/, 'a refusal with no path omits it');
	});

	it('never throws, and says so when it cannot place a value', () => {
		for (const value of [undefined, null, 42, 'text', new Map(), Symbol('s'), () => 0]) {
			assert.doesNotThrow(() => explain(value));
		}
		assert.match(explain(new Map([['a', 1]])), /not described/);
	});

	it('does not treat a plain Error as a refusal', () => {
		assert.match(explain(new Error('plain')), /not described/);
	});
});

describe('render', () => {
	it('cuts long text and prints bytes as hex', () => {
		const long = 'x'.repeat(200);
		const text = render({ kind: 'k', facts: [['long', long], ['bytes', Uint8Array.of(1, 255)]] });
		assert.match(text, /\.\.\./);
		assert.ok(text.length < 200);
		assert.match(text, /0x01ff/);
	});

	it('says how many bytes when it cut them', () => {
		assert.match(render({ kind: 'k', facts: [['b', new Uint8Array(64)]] }), /\(64 bytes\)/);
	});

	it('reads a value that fights back, rather than throwing out of a debug call', () => {
		// A proxy that throws on any read is the shape a half-built object has, and reading one
		// is exactly when somebody reaches for this package.
		const hostile = new Proxy({}, { get: () => { throw new Error('boom'); } });
		let text = '';
		assert.doesNotThrow(() => { text = render({ kind: 'k', facts: [['v', hostile]] }); });
		assert.match(text, /<unreadable>/);
	});

	it('indents children under their parent', () => {
		const text = render({ kind: 'a', facts: [], children: [{ kind: 'b', facts: [] }] });
		assert.equal(text, 'a\n  b');
	});
});
