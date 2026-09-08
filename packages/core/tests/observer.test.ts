// Scopes: what a listener sees, and what it does not.

import test from 'node:test';
import assert from 'node:assert/strict';

import { idToText, randomBelow, randomFrom, slotKeyOf } from '@aweftjs/testing';
import type { Delta, Id } from '@aweftjs/codec';

import { alias, atomic, createArray, createObject, observer, textIdOf } from '../src/index.ts';
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

// --- the pruning invariant -----------------------------------------------------------------
//
// A closing commit builds a delta only where some listener can reach it (design 085), so the
// one thing that could go wrong is a listener's delivery changing because of who else is
// listening. This drives random edits past a random set of scopes twice, once alone and once
// with a deep listener beside them, and compares what each scope was handed.

interface Row extends Record<string, unknown> { label?: string; done?: boolean }

/**
 * The same script every time for a seed, so two runs differ only in who is listening.
 *
 * Ids and array positions are minted fresh in each run, so a delivery is written down by the
 * name each observable was given when it was made, which is the same in both runs, and never
 * by its bytes. An array slot is written as `#`: which position a row landed at is randomness,
 * and the reference in the delta says which row it is.
 */
const drive = (seed: number, deep: boolean): Map<string, string[]> => {
	const random = randomFrom(seed);

	const names = new Map<string, string>();
	const named = <T extends object>(name: string, made: T): T => {
		names.set(textIdOf(made), name);
		return made;
	};
	const name = (id: Id): string => names.get(idToText(id)) ?? '?';

	const show = (value: unknown): string => {
		if (value === undefined) return '';
		if (value !== null && typeof value === 'object' && 'edge' in (value as object)) {
			const ref = value as { edge: string; id: Id };
			return ` =${ref.edge}:${name(ref.id)}`;
		}
		return ` =${JSON.stringify(value)}`;
	};
	const write = (deltas: readonly Delta[]): string => deltas
		.map((d) => `${d.type} ${name(d.id)} ${d.ref.kind === 'object' ? slotKeyOf(d.ref) : '#'}${show(d.value)}`)
		.sort()
		.join(' | ');

	const doc = named('doc', createObject<Record<string, unknown>>());
	const rows = named('rows', createArray<Row>());
	const inner = named('inner', createObject<Record<string, unknown>>({ a: 1 }));
	const parked = named('parked', createArray<Row>());
	doc['rows'] = rows;
	doc['inner'] = inner;
	doc['parked'] = parked;

	const scopes: Array<[string, { watch(fn: (change: Change) => void): () => void }]> = [
		['root shallow', observer(doc).shallow()],
		['rows shallow', observer(doc).path('rows').shallow()],
		['rows own shallow', observer(rows).shallow()],
		['inner shallow', observer(doc).path('inner').shallow()],
		['rows.0 shallow', observer(doc).path('rows', 0).shallow()],
		['inner shallow ignore a', observer(doc).path('inner').shallow().ignore('a')],
		['parked shallow', observer(doc).path('parked').shallow()],
	];

	const logs = new Map<string, string[]>();
	for (const [label, scope] of scopes) {
		// A random subset, so the reach the root settles on varies from run to run.
		if (randomBelow(random, 3) === 0) continue;
		const lines: string[] = [];
		logs.set(label, lines);
		scope.watch((change) => lines.push(write(change.deltas)));
	}

	// The listener under test in run B. It is registered last, so everything above is
	// registered identically in both runs.
	if (deep) observer(doc).watch(() => undefined);

	let minted = 0;
	const fresh = (init: Row): Row => named(`row${minted++}`, createObject<Row>(init));

	for (let step = 0; step < 60; step++) {
		const move = randomBelow(random, 8);
		if (move === 0) {
			rows.push(fresh({ label: `r${step}`, done: false }));
		} else if (move === 1) {
			if (rows.length > 0) rows[randomBelow(random, rows.length)]!.label = `l${step}`;
		} else if (move === 2) {
			if (rows.length > 0) rows.splice(randomBelow(random, rows.length), 1);
		} else if (move === 3) {
			if (rows.length > 0) {
				const row = rows[randomBelow(random, rows.length)]!;
				if (row['nested'] === undefined) {
					row['nested'] = named(`nested${step}`, createObject({ deep: step }));
				}
			}
		} else if (move === 4) {
			inner['a'] = step;
		} else if (move === 5) {
			if (inner['b'] === undefined) inner['b'] = 'x';
			else delete inner['b'];
		} else if (move === 6) {
			atomic(() => {
				rows.push(fresh({ label: `a${step}` }));
				rows.push(fresh({ label: `b${step}` }));
			});
		} else if (rows.length > 0) {
			// Out of the document and back into it, which is the shape design 084 changed.
			const at = randomBelow(random, rows.length);
			const row = rows[at]!;
			rows.splice(at, 1);
			parked.push(row);
		}
	}

	return logs;
};

test('a listener hears the same thing whether or not a deep listener exists', () => {
	for (const seed of [20260905, 7, 991, 44113, 20260101]) {
		const alone = drive(seed, false);
		const beside = drive(seed, true);

		assert.deepEqual([...beside.keys()], [...alone.keys()], `seed ${seed}: different scope sets`);
		for (const [label, lines] of alone) {
			assert.deepEqual(beside.get(label), lines, `seed ${seed}, scope "${label}"`);
		}
		assert.ok([...alone.values()].some((lines) => lines.length > 0), `seed ${seed}: nothing was delivered`);
	}
});

test('a listener that leaves does not narrow what the others hear', () => {
	const doc = createObject<Record<string, unknown>>();
	const rows = createArray<Record<string, unknown>>();
	doc['rows'] = rows;

	const stop = observer(doc).shallow().watch(() => undefined);
	const seen: Delta[][] = [];
	observer(doc).watch((change) => seen.push([...change.deltas]));
	stop();

	rows.push(createObject({ label: 'a' }));
	assert.equal(seen.length, 1, 'the deep scope still hears the commit');
	assert.equal(seen[0]!.length, 2, 'the attach edge and the slot under it');
});

// A chain step is one small object with its combinators on a shared prototype (design 154).
// A test that reads the heap is flaky, so what is pinned here is the structure the size follows
// from: a step carries state and no methods, and every combinator answers a new step.

test('a chain step keeps its state to itself and its methods on the prototype', () => {
	const doc = createObject<Record<string, unknown>>({ label: 'x' });
	const scope = observer(doc).path('label');
	const derived = scope.map((value) => String(value));

	for (const step of [observer(doc), scope, derived]) {
		assert.deepEqual(Object.keys(step), [], 'nothing a spread would copy or a caller would read off');
		assert.equal(JSON.stringify(step), '{}', 'and serializing one answers the empty object');
		assert.equal(Object.hasOwn(step, 'map'), false,
			'a combinator on a step is on its prototype, not a closure the step holds');
		assert.equal(typeof (step as { map: unknown }).map, 'function', 'and it is still reachable');
	}
});

test('a step is the same size however many are built', () => {
	const doc = createObject<Record<string, unknown>>({ label: 'x' });
	const proto = Object.getPrototypeOf(observer(doc).path('label')) as object;
	for (let i = 0; i < 10000; i++) {
		const step = observer(doc).path('label');
		assert.deepEqual(Object.getOwnPropertyNames(step), [],
			'every step of the same shape holds the same state, and it is private');
		assert.equal(Object.getPrototypeOf(step), proto, 'and shares one set of combinators');
	}
});

test('every narrowing and every combinator answers a new step, leaving this one alone', () => {
	const doc = createObject<Record<string, unknown>>({ label: 'x', other: 1 });
	const scope = observer(doc).path('label');

	const derivedFrom: unknown[] = [
		scope.path('deeper'), scope.ignore('other'), scope.shallow(), scope.skip(), scope.tree('label'),
		scope.map((value) => value), scope.bool(1, 0), scope.def('fallback'), scope.defined(),
		scope.unwrap(), scope.throttle(1), scope.wait(1),
	];
	for (const made of derivedFrom) assert.notEqual(made, scope, 'a combinator never returns this step');
	assert.equal(new Set(derivedFrom).size, derivedFrom.length, 'and never the same step twice');
	assert.equal(scope.get(), 'x', 'the step it was built from is untouched');
});
