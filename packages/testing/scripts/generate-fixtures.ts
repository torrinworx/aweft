// Writes spec/fixtures. Run with `npm run fixtures`.
//
// Every fixture states its ending document by hand rather than letting the applier decide
// what it should be. Generation fails if applying the commits does not reach it, so a
// fixture is a claim about the format that the reference implementation has to satisfy,
// not a transcript of whatever the reference implementation happened to do.

import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
	type Commit, type Delta, type Ref, type Value,
	bytesFromHex, bytesToHex, decodeCommit, encodeCommit, encodeValue, idToText,
} from '@aweftjs/codec';

import {
	type DocumentJson, type Fixture, type InvalidFixture, type ObservableJson, type ValueJson,
	checkFixture, checkInvalidFixture, commitToJson,
} from '../src/index.ts';

// --- building blocks ----------------------------------------------------------------------

/** Ids are counted rather than random, so a fixture reads the same on every machine. */
const id = (n: number): Uint8Array => bytesFromHex(n.toString(16).padStart(24, '0'));
const name = (n: number): string => idToText(id(n));

const obj = (slots: Record<string, ValueJson>): ObservableJson => ({ kind: 'object', slots });
const arr = (slots: Record<string, ValueJson>): ObservableJson => ({ kind: 'array', slots });
const map = (slots: Record<string, ValueJson>): ObservableJson => ({ kind: 'map', slots });

const doc = (root: number, observables: Record<number, ObservableJson>): DocumentJson => ({
	root: name(root),
	observables: Object.fromEntries(
		Object.entries(observables).map(([n, o]) => [name(Number(n)), o]),
	),
});

const points = (kind: 'object' | 'array' | 'map', n: number): ValueJson =>
	({ ref: name(n), kind, edge: 'attach' });
const aliases = (kind: 'object' | 'array' | 'map', n: number): ValueJson =>
	({ ref: name(n), kind, edge: 'alias' });
const raw = (hex: string): ValueJson => ({ bytes: hex });

const key = (k: string): Ref => ({ kind: 'object', key: k });
const at = (hex: string): Ref => ({ kind: 'array', key: bytesFromHex(hex) });
const of = (n: number): Ref => ({ kind: 'map', key: id(n) });

const add = (n: number, ref: Ref, value: Value): Delta => ({ type: 'add', id: id(n), ref, value });
const put = (n: number, ref: Ref, value: Value): Delta => ({ type: 'replace', id: id(n), ref, value });
const gone = (n: number, ref: Ref): Delta => ({ type: 'remove', id: id(n), ref });
const to = (kind: 'object' | 'array' | 'map', n: number): Value =>
	({ edge: 'attach', kind, id: id(n) });
const alias = (kind: 'object' | 'array' | 'map', n: number): Value =>
	({ edge: 'alias', kind, id: id(n) });

interface Case {
	readonly name: string;
	readonly description: string;
	readonly initial: DocumentJson;
	readonly commits: readonly Commit[];
	readonly final: DocumentJson;
}

// --- the valid fixtures -------------------------------------------------------------------

const cases: Case[] = [
	{
		name: 'object-slots',
		description: 'Adding one slot of every value kind to an object.',
		initial: doc(1, { 1: obj({}) }),
		commits: [{
			deltas: [
				add(1, key('title'), 'a page'),
				add(1, key('count'), 3),
				add(1, key('ready'), true),
				add(1, key('missing'), null),
				add(1, key('ratio'), 0.5),
				add(1, key('blob'), bytesFromHex('0102ff')),
			],
		}],
		final: doc(1, {
			1: obj({
				title: 'a page', count: 3, ready: true, missing: null, ratio: 0.5,
				blob: raw('0102ff'),
			}),
		}),
	},
	{
		name: 'replace-and-remove',
		description: 'The two ways a slot that already exists can change.',
		initial: doc(1, { 1: obj({ title: 'a page', draft: true }) }),
		commits: [{ deltas: [put(1, key('title'), 'a better page'), gone(1, key('draft'))] }],
		final: doc(1, { 1: obj({ title: 'a better page' }) }),
	},
	{
		name: 'array-positions',
		description: 'An array is filled by position, and positions order it.',
		initial: doc(1, { 1: obj({ blocks: points('array', 2) }), 2: arr({}) }),
		commits: [{
			deltas: [add(2, at('20'), 'first'), add(2, at('40'), 'second'), add(2, at('60'), 'third')],
		}],
		final: doc(1, {
			1: obj({ blocks: points('array', 2) }),
			2: arr({ 20: 'first', 40: 'second', 60: 'third' }),
		}),
	},
	{
		name: 'array-insert-between',
		description: 'A position exists between any two others, so an insert never renumbers.',
		initial: doc(1, {
			1: obj({ blocks: points('array', 2) }),
			2: arr({ 20: 'first', 40: 'second' }),
		}),
		commits: [{ deltas: [add(2, at('30'), 'between'), add(2, at('2001'), 'just after first')] }],
		final: doc(1, {
			1: obj({ blocks: points('array', 2) }),
			2: arr({ 20: 'first', 2001: 'just after first', 30: 'between', 40: 'second' }),
		}),
	},
	{
		name: 'map-identity',
		description: 'A map slot is named by an identity, and holds a reference to state.',
		initial: doc(1, { 1: obj({ presence: points('map', 2) }), 2: map({}) }),
		commits: [{
			deltas: [
				add(2, of(10), to('object', 11)),
				add(11, key('cursor'), 42),
				add(2, of(12), to('object', 13)),
				add(13, key('cursor'), 7),
			],
		}],
		final: doc(1, {
			1: obj({ presence: points('map', 2) }),
			2: map({ [name(10)]: points('object', 11), [name(12)]: points('object', 13) }),
			11: obj({ cursor: 42 }),
			13: obj({ cursor: 7 }),
		}),
	},
	{
		name: 'nested-subtree',
		description:
			'A whole subtree arrives in one commit: the parent slot names the child, and the ' +
			'child fills itself in. Nothing depends on which delta is applied first.',
		initial: doc(1, { 1: obj({}) }),
		commits: [{
			deltas: [
				add(1, key('blocks'), to('array', 2)),
				add(2, at('40'), to('object', 3)),
				add(3, key('text'), 'hello'),
				add(3, key('type'), 'paragraph'),
			],
		}],
		final: doc(1, {
			1: obj({ blocks: points('array', 2) }),
			2: arr({ 40: points('object', 3) }),
			3: obj({ text: 'hello', type: 'paragraph' }),
		}),
	},
	{
		name: 'empty-observable',
		description:
			'A reference states the kind of what it names, so an observable with no slots is ' +
			'still fully described and a receiver knows how to read the next delta about it.',
		initial: doc(1, { 1: obj({}) }),
		commits: [{ deltas: [add(1, key('tags'), to('map', 2))] }],
		final: doc(1, { 1: obj({ tags: points('map', 2) }), 2: map({}) }),
	},
	{
		name: 'shared-reference',
		description:
			'Two slots naming one observable. One attaches it, which is where it lives, and the ' +
			'other aliases it. State is a graph, and exactly one edge says where a thing is.',
		initial: doc(1, { 1: obj({}) }),
		commits: [{
			deltas: [
				add(1, key('author'), to('object', 2)),
				add(1, key('reviewer'), alias('object', 2)),
				add(2, key('handle'), 'someone'),
			],
		}],
		final: doc(1, {
			1: obj({ author: points('object', 2), reviewer: aliases('object', 2) }),
			2: obj({ handle: 'someone' }),
		}),
	},
	{
		name: 'move-observable',
		description:
			'Moving an observable is one commit that removes its attach edge and adds another. ' +
			'Both happen together, so it is never in two places and never in none.',
		initial: doc(1, {
			1: obj({ drafts: points('array', 2), published: points('array', 3) }),
			2: arr({ 40: points('object', 4) }),
			3: arr({}),
			4: obj({ title: 'a post' }),
		}),
		commits: [{ deltas: [gone(2, at('40')), add(3, at('40'), to('object', 4))] }],
		final: doc(1, {
			1: obj({ drafts: points('array', 2), published: points('array', 3) }),
			2: arr({}),
			3: arr({ 40: points('object', 4) }),
			4: obj({ title: 'a post' }),
		}),
	},
	{
		name: 'integrity-tag',
		description: 'A commit carrying the optional tag. The tag rides along and is not read here.',
		initial: doc(1, { 1: obj({ title: 'a page' }) }),
		commits: [{ deltas: [put(1, key('title'), 'a page, revised')], tag: bytesFromHex('9f2b41c7') }],
		final: doc(1, { 1: obj({ title: 'a page, revised' }) }),
	},
	{
		name: 'canonical-ordering',
		description:
			'Deltas handed over in a scrambled order across several observables. The bytes come ' +
			'out in one order, so two encoders agree without agreeing on anything else.',
		initial: doc(1, {
			1: obj({ two: points('object', 2), three: points('object', 3) }),
			2: obj({}),
			3: obj({}),
		}),
		commits: [{
			deltas: [
				add(3, key('z'), 3),
				add(1, key('b'), 1),
				add(2, key('m'), 2),
				add(1, key('a'), 0),
				add(3, key('y'), 4),
				add(2, key('n'), 5),
			],
		}],
		final: doc(1, {
			1: obj({ two: points('object', 2), three: points('object', 3), a: 0, b: 1 }),
			2: obj({ m: 2, n: 5 }),
			3: obj({ y: 4, z: 3 }),
		}),
	},
	{
		name: 'all-three-kinds',
		description: 'One commit touching an object, an array and a map.',
		initial: doc(1, {
			1: obj({ blocks: points('array', 2), presence: points('map', 3) }),
			2: arr({ 40: 'only' }),
			3: map({}),
		}),
		commits: [{
			deltas: [
				put(1, key('blocks'), to('array', 2)),
				add(2, at('60'), 'second'),
				add(3, of(9), 'editing'),
			],
		}],
		final: doc(1, {
			1: obj({ blocks: points('array', 2), presence: points('map', 3) }),
			2: arr({ 40: 'only', 60: 'second' }),
			3: map({ [name(9)]: 'editing' }),
		}),
	},
	{
		name: 'commit-sequence',
		description: 'Three commits in order, each depending on the one before it.',
		initial: doc(1, { 1: obj({}) }),
		commits: [
			{ deltas: [add(1, key('title'), 'draft')] },
			{ deltas: [put(1, key('title'), 'second thoughts'), add(1, key('draft'), true)] },
			{ deltas: [gone(1, key('draft')), put(1, key('title'), 'published')] },
		],
		final: doc(1, { 1: obj({ title: 'published' }) }),
	},
	{
		name: 'text-and-bytes',
		description: 'Text that is not ASCII, and byte strings, including empty ones.',
		initial: doc(1, { 1: obj({}) }),
		commits: [{
			deltas: [
				add(1, key('empty'), ''),
				add(1, key('accents'), 'ünïcödé'),
				add(1, key('thread'), '🧵 a spool'),
				add(1, key('combining'), 'é is not é'),
				add(1, key('emptyBytes'), new Uint8Array(0)),
				add(1, key('someBytes'), bytesFromHex('00ff7f80')),
				add(1, key('🔑'), 'a key that is not ASCII either'),
			],
		}],
		final: doc(1, {
			1: obj({
				empty: '', accents: 'ünïcödé', thread: '🧵 a spool', combining: 'é is not é',
				emptyBytes: raw(''), someBytes: raw('00ff7f80'),
				'🔑': 'a key that is not ASCII either',
			}),
		}),
	},
	{
		name: 'number-edges',
		description:
			'The boundaries of the number rule: whole numbers in the exact range are integers, ' +
			'and everything else is a float.',
		initial: doc(1, { 1: obj({}) }),
		commits: [{
			deltas: [
				add(1, key('zero'), 0),
				add(1, key('small'), 23),
				add(1, key('oneByte'), 24),
				add(1, key('twoBytes'), 256),
				add(1, key('largestExact'), 2 ** 53),
				add(1, key('smallestExact'), -(2 ** 53)),
				add(1, key('largestSafe'), Number.MAX_SAFE_INTEGER),
				add(1, key('negative'), -1),
				add(1, key('half'), 0.5),
				add(1, key('tiny'), 1e-7),
				add(1, key('huge'), 1e300),
				add(1, key('beyondExact'), 2 ** 55),
			],
		}],
		final: doc(1, {
			1: obj({
				zero: 0, small: 23, oneByte: 24, twoBytes: 256,
				largestExact: 2 ** 53, smallestExact: -(2 ** 53),
				largestSafe: Number.MAX_SAFE_INTEGER,
				negative: -1, half: 0.5, tiny: 1e-7, huge: 1e300, beyondExact: 2 ** 55,
			}),
		}),
	},
];

// --- the rejection fixtures ---------------------------------------------------------------

// Hex built by hand, so a fixture can hold bytes a correct encoder would never produce.
const head = (major: number, n: number): string => ((major << 5) | n).toString(16).padStart(2, '0');
const hex = (v: Parameters<typeof encodeValue>[0]): string => bytesToHex(encodeValue(v));

const ID1 = hex(id(1));
const ID2 = hex(id(2));

const refKey = (k: string): string => head(4, 2) + hex(0) + hex(k);
const refPos = (posHex: string): string => head(4, 2) + hex(1) + hex(bytesFromHex(posHex));

const delta = (type: string, target: string, ref: string, value?: string): string =>
	head(4, value === undefined ? 3 : 4) + type + target + ref + (value ?? '');

const frame = (deltas: string[], tag?: string): string =>
	head(4, tag === undefined ? 1 : 2) + head(4, deltas.length) + deltas.join('') + (tag ?? '');

const good = frame([delta(hex(0), ID1, refKey('a'), hex(1))]);

const rejections: InvalidFixture[] = [
	{
		name: 'non-canonical-integer',
		description: 'The delta type is written in a wider head than the value needs.',
		stage: 'decode', reason: 'non-canonical-integer',
		bytes: frame([delta('1800', ID1, refKey('a'), hex(1))]),
	},
	{
		name: 'indefinite-length',
		description: 'The list of deltas does not state how long it is.',
		stage: 'decode', reason: 'indefinite-length',
		bytes: head(4, 1) + '9f' + delta(hex(0), ID1, refKey('a'), hex(1)) + 'ff',
	},
	{
		name: 'inline-map',
		description: 'A value that is a nested structure. Structure is made of observables.',
		stage: 'decode', reason: 'unsupported-major',
		bytes: frame([delta(hex(0), ID1, refKey('a'), 'a0')]),
	},
	{
		name: 'tagged-value',
		description: 'A tagged value. There are no tags to agree on.',
		stage: 'decode', reason: 'unsupported-major',
		bytes: frame([delta(hex(0), ID1, refKey('a'), 'c000')]),
	},
	{
		name: 'undefined-value',
		description: 'There is no undefined. A slot that holds nothing is a slot that was removed.',
		stage: 'decode', reason: 'unsupported-simple',
		bytes: frame([delta(hex(0), ID1, refKey('a'), 'f7')]),
	},
	{
		name: 'half-float',
		description: 'A narrower float than the one form the format has.',
		stage: 'decode', reason: 'unsupported-simple',
		bytes: frame([delta(hex(0), ID1, refKey('a'), 'f93c00')]),
	},
	{
		name: 'not-a-number',
		description: 'NaN has many spellings and no value, so it has no encoding.',
		stage: 'decode', reason: 'non-finite-float',
		bytes: frame([delta(hex(0), ID1, refKey('a'), 'fb7ff8000000000000')]),
	},
	{
		name: 'whole-number-as-float',
		description: 'Three, written as a float. Two encoders would disagree about one value.',
		stage: 'decode', reason: 'non-canonical-float',
		bytes: frame([delta(hex(0), ID1, refKey('a'), 'fb4008000000000000')]),
	},
	{
		name: 'invalid-utf8',
		description: 'A slot name that is not text.',
		stage: 'decode', reason: 'invalid-utf8',
		bytes: frame([delta(hex(0), ID1, head(3, 2) + 'c328', hex(1))]),
	},
	{
		name: 'trailing-bytes',
		description: 'A whole commit, and then something else.',
		stage: 'decode', reason: 'trailing-bytes',
		bytes: `${good}00`,
	},
	{
		name: 'truncated',
		description: 'A commit that stops in the middle.',
		stage: 'decode', reason: 'truncated',
		bytes: good.slice(0, -2),
	},
	{
		name: 'integer-out-of-range',
		description: 'An integer past the exact range, offered as an integer. 2^53 itself is '
			+ 'exact and is legal; this is one past it, and adding the halves of the argument '
			+ 'before checking them rounds it back into range.',
		stage: 'decode', reason: 'integer-out-of-range',
		bytes: frame([delta(hex(0), ID1, refKey('a'), '1b0020000000000001')]),
	},
	{
		name: 'deltas-out-of-order',
		description:
			'The right deltas in the wrong order. Refused rather than sorted, because two byte ' +
			'strings meaning one commit is exactly what the ordering rule exists to prevent.',
		stage: 'decode', reason: 'deltas-out-of-order',
		bytes: frame([
			delta(hex(0), ID2, refKey('a'), hex(1)),
			delta(hex(0), ID1, refKey('a'), hex(1)),
		]),
	},
	{
		name: 'duplicate-slot',
		description: 'Two deltas about one slot. Which one wins would be a merge rule.',
		stage: 'decode', reason: 'duplicate-slot',
		bytes: frame([
			delta(hex(0), ID1, refKey('a'), hex(1)),
			delta(hex(1), ID1, refKey('a'), hex(2)),
		]),
	},
	{
		name: 'unknown-delta-type',
		description: 'A fourth kind of change.',
		stage: 'decode', reason: 'unknown-delta-type',
		bytes: frame([delta(hex(3), ID1, refKey('a'), hex(1))]),
	},
	{
		name: 'unknown-ref-kind',
		description: 'A fourth kind of observable.',
		stage: 'decode', reason: 'unknown-ref-kind',
		bytes: frame([delta(hex(0), ID1, head(4, 2) + hex(3) + hex('a'), hex(1))]),
	},
	{
		name: 'short-id',
		description: 'An id of the wrong width.',
		stage: 'decode', reason: 'invalid-id',
		bytes: frame([delta(hex(0), hex(bytesFromHex('0102030405060708')), refKey('a'), hex(1))]),
	},
	{
		name: 'position-ending-in-zero',
		description:
			'A position that ends in a zero byte. Nothing could ever be inserted before it, so ' +
			'the array would have a place it can never grow into.',
		stage: 'decode', reason: 'invalid-position',
		bytes: frame([delta(hex(0), ID1, refPos('4000'), hex(1))]),
	},
	{
		name: 'empty-position',
		description: 'A position with no bytes. Nothing sorts before it either.',
		stage: 'decode', reason: 'invalid-position',
		bytes: frame([delta(hex(0), ID1, head(4, 2) + hex(1) + head(2, 0), hex(1))]),
	},
	{
		name: 'missing-value',
		description: 'An add with nothing to add.',
		stage: 'decode', reason: 'missing-value',
		bytes: frame([delta(hex(0), ID1, refKey('a'))]),
	},
	{
		name: 'remove-with-value',
		description: 'A remove carrying what used to be there. Prior values do not ride along.',
		stage: 'decode', reason: 'unexpected-value',
		bytes: frame([delta(hex(2), ID1, refKey('a'), hex(1))]),
	},
	{
		name: 'malformed-reference',
		description: 'A reference missing a part. It states an edge, a kind and an id.',
		stage: 'decode', reason: 'invalid-reference',
		bytes: frame([delta(hex(0), ID1, refKey('a'), head(4, 2) + hex(0) + ID2)]),
	},
	{
		name: 'unknown-edge-kind',
		description: 'A third kind of edge. A reference either attaches or aliases.',
		stage: 'decode', reason: 'unknown-edge-kind',
		bytes: frame([delta(hex(0), ID1, refKey('a'), head(4, 3) + hex(9) + hex(0) + ID2)]),
	},
	{
		name: 'empty-commit',
		description: 'A commit saying nothing. Coalescing that cancels out emits nothing at all.',
		stage: 'decode', reason: 'empty-commit',
		bytes: head(4, 1) + head(4, 0),
	},
	{
		name: 'short-tag',
		description: 'An integrity tag too short to detect anything.',
		stage: 'decode', reason: 'invalid-tag',
		bytes: frame([delta(hex(0), ID1, refKey('a'), hex(1))], hex(bytesFromHex('0102'))),
	},
	{
		name: 'not-a-commit',
		description: 'Bytes that decode cleanly and are not a commit.',
		stage: 'decode', reason: 'invalid-commit',
		bytes: hex('a commit, honest'),
	},
	{
		name: 'nesting-too-deep',
		description: 'Arrays nested past anything the format can mean, refused before allocating.',
		stage: 'decode', reason: 'nesting-too-deep',
		bytes: head(4, 1).repeat(10) + '00',
	},
	{
		name: 'kind-conflict',
		description:
			'Two deltas in one commit disagreeing about what kind of observable they address. ' +
			'Caught before anything is applied, so the document is left as it was.',
		stage: 'apply', reason: 'kind-conflict',
		initial: doc(1, { 1: obj({}) }),
		bytes: bytesToHex(encodeCommit({
			deltas: [add(2, key('a'), 1), add(2, at('40'), 2)],
		})),
	},
	{
		name: 'add-over-existing',
		description: 'An add to a slot that is already there. That is a replace, and it says so.',
		stage: 'apply', reason: 'slot-exists',
		initial: doc(1, { 1: obj({ title: 'a page' }) }),
		bytes: bytesToHex(encodeCommit({ deltas: [add(1, key('title'), 'another page')] })),
	},
	{
		name: 'replace-missing',
		description: 'A replace of a slot that is not there. That is an add.',
		stage: 'apply', reason: 'slot-missing',
		initial: doc(1, { 1: obj({}) }),
		bytes: bytesToHex(encodeCommit({ deltas: [put(1, key('title'), 'a page')] })),
	},
	{
		name: 'remove-missing',
		description: 'A remove of a slot that is not there.',
		stage: 'apply', reason: 'slot-missing',
		initial: doc(1, { 1: obj({ title: 'a page' }) }),
		bytes: bytesToHex(encodeCommit({ deltas: [gone(1, key('subtitle'))] })),
	},
	{
		name: 'two-attach-edges-in-one-commit',
		description:
			'One commit attaching an observable in two places. Deltas in a commit are unordered, ' +
			'so there is no defensible way to pick which one wins.',
		stage: 'apply', reason: 'multiple-attach',
		initial: doc(1, { 1: obj({}) }),
		bytes: bytesToHex(encodeCommit({
			deltas: [add(1, key('a'), to('object', 4)), add(1, key('b'), to('object', 4))],
		})),
	},
	{
		name: 'second-attach-to-attached',
		description:
			'Attaching an observable that already lives somewhere. The second reference had to ' +
			'be an alias, or the first attach had to be removed in the same commit.',
		stage: 'apply', reason: 'multiple-attach',
		initial: doc(1, { 1: obj({ a: points('object', 2) }), 2: obj({ x: 1 }) }),
		bytes: bytesToHex(encodeCommit({ deltas: [add(1, key('b'), to('object', 2))] })),
	},
	{
		name: 'unattached-target',
		description:
			'A delta into an observable with no attach path from the root. It has no place in ' +
			'the document, so nothing can say who may write it.',
		stage: 'apply', reason: 'unreachable',
		initial: doc(1, { 1: obj({}) }),
		bytes: bytesToHex(encodeCommit({ deltas: [add(9, key('title'), 'from nowhere')] })),
	},
	{
		name: 'alias-does-not-attach',
		description:
			'An alias names an observable without giving it a home, so a delta into it is still ' +
			'refused. This is what makes an alias grant nothing.',
		stage: 'apply', reason: 'unreachable',
		initial: doc(1, { 1: obj({}) }),
		bytes: bytesToHex(encodeCommit({
			deltas: [add(1, key('seeAlso'), alias('object', 5)), add(5, key('title'), 'nowhere')],
		})),
	},
];

// --- write them out ------------------------------------------------------------------------

// AWEFT_FIXTURES points generation somewhere else, which is how the gate regenerates into a
// scratch directory and compares against what is committed.
const target = process.env['AWEFT_FIXTURES'];
const root = target === undefined
	? new URL('../../../spec/fixtures/', import.meta.url)
	: pathToFileURL(`${target}/`);
const invalidDir = new URL('invalid/', root);

const clear = (dir: URL): void => {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.isFile() && entry.name.endsWith('.json')) rmSync(new URL(entry.name, dir));
	}
};

mkdirSync(fileURLToPath(invalidDir), { recursive: true });
clear(root);
clear(invalidDir);

const write = (dir: URL, index: number, fixtureName: string, body: unknown): void => {
	const file = `${String(index).padStart(3, '0')}-${fixtureName}.json`;
	writeFileSync(new URL(file, dir), `${JSON.stringify(body, null, '\t')}\n`);
};

cases.forEach((c, i) => {
	const fixture: Fixture = {
		name: c.name,
		description: c.description,
		initial: c.initial,
		// What a fixture says the bytes mean is read back off the bytes, never restated from
		// what was handed to the encoder. The deltas above are written in whatever order reads
		// well; the bytes are in canonical order, and the fixture has to agree with the bytes.
		commits: c.commits.map((commit) => {
			const bytes = encodeCommit(commit);
			return commitToJson(decodeCommit(bytes), bytes);
		}),
		final: c.final,
	};

	try {
		checkFixture(fixture);
	} catch (e) {
		// Without the name, a failure here says which rule broke but not which fixture broke it.
		throw new Error(`fixture ${c.name}: ${(e as Error).message}`, { cause: e });
	}
	write(root, i + 1, c.name, fixture);
});

rejections.forEach((f, i) => {
	checkInvalidFixture(f);
	write(invalidDir, i + 1, f.name, f);
});

console.log(`wrote ${cases.length} fixtures and ${rejections.length} rejections`);
