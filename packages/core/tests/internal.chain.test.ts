// The one thing about a chain step the surface cannot show: when its Source is built.
//
// Design 154 says a scope builds the Source its value combinators read on the first call that
// asks for one, and never on construction. Nothing a caller can observe tells the two apart, so
// the guarantee is checked here, on the field itself. White-box, and named for it.

import test from 'node:test';
import assert from 'node:assert/strict';

import { SLOT } from '../src/derived.ts';
import { createObject } from '../src/index.ts';
import { observer } from '../src/observer.ts';

/** The Source a step holds, or null while it has not needed one. */
const sourceField = (step: unknown): unknown => (step as { [SLOT]: unknown })[SLOT];

const doc = (): Record<string, unknown> => createObject<Record<string, unknown>>({ label: 'x', other: 1 });

test('narrowing, reading, writing and watching a scope build no Source', () => {
	const base = doc();
	const untouched: Array<[string, () => unknown]> = [
		['fresh', () => observer(base)],
		['path', () => observer(base).path('label')],
		['ignore', () => observer(base).ignore('other')],
		['shallow', () => observer(base).shallow()],
		['skip', () => observer(base).skip()],
		['tree', () => observer(base).tree('label')],
	];
	for (const [name, make] of untouched) {
		assert.equal(sourceField(make()), null, `${name} built a Source nothing had asked for`);
	}

	const read = observer(base).path('label');
	read.get();
	read.set('y');
	const stop = read.watch(() => undefined);
	const stopEffect = read.effect(() => undefined);
	assert.equal(sourceField(read), null, 'reading, writing and watching go straight at the document');
	stop();
	stopEffect();
});

test('the first combinator that needs a Source builds one, and it is built once', () => {
	const scope = observer(doc()).path('label');
	assert.equal(sourceField(scope), null);

	const mapped = scope.map((value) => String(value));
	const built = sourceField(scope);
	assert.notEqual(built, null, 'map reads the scope as a source, so the scope has to be one');
	assert.equal(mapped.get(), 'x');

	scope.bool(1, 0);
	assert.equal(sourceField(scope), built, 'the second combinator reuses the first one\'s Source');
});

test('a Source built late reads and writes the same slot the scope does', () => {
	const base = doc();
	const scope = observer(base).path('label');
	const mapped = scope.map((value) => `${String(value)}!`);

	assert.equal(mapped.get(), 'x!');
	scope.set('y');
	assert.equal(mapped.get(), 'y!', 'the Source reads the slot, not a value it captured');
	assert.equal(scope.isImmutable(), false);
});
