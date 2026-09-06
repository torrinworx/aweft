// The contrast warning from inside: the ratio and the message. What a page sees of it is
// `contrast.test.ts`; this file reaches past the surface, so it is named `internal.*` and does not
// count toward the public-export gate.

import test from 'node:test';
import assert from 'node:assert/strict';

import { contrastComplaint, contrastRatio } from '../src/contrast.ts';
import { type Lookup } from '../src/values.ts';

// Two greys 3.01:1 apart, under names the pair table knows, plus the foreground that is the
// answer for this background.
const held: Record<string, string> = {
	background: '#edeff3',
	border: '#848a96',
	foreground: '#1c2027',
};

const lookupFor = (values: Record<string, string>): Lookup => ({
	variable: (name) => values[name] ?? null,
	call: (name) => (name === 'pick' ? (args) => values[args[0] ?? ''] ?? '' : null),
});

const lookup = lookupFor(held);

// sRGB relative luminance and the WCAG 2 ratio, written out here so the numbers below come from
// the formula rather than from the code being checked.
const channel = (value: number): number => {
	const part = value / 255;
	return part <= 0.03928 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4;
};

const luminance = (colour: readonly number[]): number =>
	0.2126 * channel(colour[0]!) + 0.7152 * channel(colour[1]!) + 0.0722 * channel(colour[2]!);

const between = (a: readonly number[], b: readonly number[]): number =>
	(Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);

const round = (value: number | null): number => Math.round((value ?? 0) * 1000) / 1000;

test('the ratio is the WCAG 2 one, and is null for anything that is not a colour', () => {
	assert.equal(Math.round((contrastRatio('#000000', '#ffffff') ?? 0) * 100) / 100, 21);
	assert.equal(Math.round((contrastRatio('#ffffff', '#ffffff') ?? 0) * 100) / 100, 1);
	assert.equal(contrastRatio('currentColor', '#ffffff'), null);
	assert.equal(contrastRatio('#ffffff', 'inherit'), null);
});

test('an unreadable pair of named values names the ratio, the target and the paired role', () => {
	const complaint = contrastComplaint([{ background: '$background', color: '$border' }], lookup, 'card');
	assert.ok(complaint !== null);
	assert.match(complaint, /theme chain "card"/);
	assert.match(complaint, /at 3\.01:1/);
	assert.match(complaint, /below the 4\.5:1 WCAG 2 AA target for text/);
	assert.match(complaint, /Use \$foreground, the foreground paired with \$background\./);
});

test('a background outside the pair table is offered the foregrounds that measure up', () => {
	// `$pick(...)` is a call, so there is no role name to pair with. What there is is a colour,
	// and the foreground roles the theme defines can be measured against it.
	const complaint = contrastComplaint([{ background: '$pick(background)', color: '$border' }], lookup, 'card');
	assert.ok(complaint !== null);
	assert.match(complaint, /Use \$foreground, which reaches 4\.5:1 against that background\./);
});

test('a background nothing reaches is told so rather than told a name', () => {
	const dim = lookupFor({ background: '#edeff3', border: '#848a96', foreground: '#8d939e' });
	const complaint = contrastComplaint([{ background: '$pick(background)', color: '$border' }], dim, 'card');
	assert.ok(complaint !== null);
	assert.match(complaint, /No foreground role this theme defines reaches 4\.5:1 against that background\./);
	assert.doesNotMatch(complaint, /Use \$/, 'a role that does not measure up is not named');
});

test('the last declaration in the chain is the one measured', () => {
	// The first entry is readable and the second is not; what the element gets is the second.
	const complaint = contrastComplaint(
		[{ background: '$background', color: '$foreground' }, { color: '$border' }],
		lookup,
		'card_quiet',
	);
	assert.ok(complaint !== null);
	assert.match(complaint, /at 3\.01:1/);
});

test('nothing is measured without both halves of a pair', () => {
	assert.equal(contrastComplaint([{ color: '$border' }], lookup, 'a'), null);
	assert.equal(contrastComplaint([{ background: '$background' }], lookup, 'a'), null);
	assert.equal(contrastComplaint([], lookup, 'a'), null);
});

test('nothing is measured when either half was written as a literal', () => {
	assert.equal(contrastComplaint([{ background: '#edeff3', color: '$border' }], lookup, 'a'), null);
	assert.equal(contrastComplaint([{ background: '$background', color: '#848a96' }], lookup, 'a'), null);
});

test('nothing is measured when either half is not a colour', () => {
	assert.equal(contrastComplaint([{ background: '$missing', color: '$border' }], lookup, 'a'), null);
});

test('a readable pair says nothing', () => {
	assert.equal(contrastComplaint([{ background: '$background', color: '$foreground' }], lookup, 'a'), null);
});

test('backgroundColor is read as well as background, and a null value is skipped', () => {
	const complaint = contrastComplaint(
		[{ backgroundColor: '$background', color: '$border', background: null }],
		lookup,
		'a',
	);
	assert.ok(complaint !== null);
	assert.match(complaint, /Use \$foreground/);
});

test('a colour with alpha is measured over the background behind it', () => {
	// The composite by hand: each channel of #1c2027 at 15% plus #edeff3 at 85%, then the ratio
	// of that mixture against #edeff3.
	const paper = [0xed, 0xef, 0xf3];
	const mixed = [0x1c, 0x20, 0x27].map((value, i) => value * 0.15 + paper[i]! * 0.85);
	const expected = between(mixed, paper);
	assert.ok(expected < 2, `a fifteenth of the ink is ${expected.toFixed(2)}:1, which nobody can read`);

	assert.equal(round(contrastRatio('rgba(28, 32, 39, 0.15)', '#edeff3')), round(expected));
	// The same ink opaque is the readable pair the old measurement thought it had.
	assert.ok((contrastRatio('#1c2027', '#edeff3') ?? 0) > 10);
});

test('a background that is itself translucent is not measured', () => {
	// What is behind a translucent background is the page, which nothing here can see, so there
	// is no honest number to give.
	assert.equal(contrastRatio('#1c2027', 'rgba(237, 239, 243, 0.5)'), null);
	assert.equal(contrastComplaint(
		[{ background: '$sheer', color: '$border' }],
		lookupFor({ sheer: 'rgba(237, 239, 243, 0.5)', border: '#848a96' }),
		'card',
	), null);
});
