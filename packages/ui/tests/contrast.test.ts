// Every pair of roles, measured, in both modes; and the warning that fires when a theme's own
// named values are unreadable together.
//
// The ratio is computed here, from the WCAG 2 formula, and deliberately not from `color.ts`. A
// check may not take its expected value from the thing it checks: reading the package's own
// luminance would mean a mistake in it makes a failing scale pass.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { transform } from '@aweftjs/build';
import { type Definitions, Theme, context, dark, light } from '@aweftjs/ui';

// sRGB relative luminance, WCAG 2 section "relative luminance".
const channel = (value: number): number => {
	const part = value / 255;
	return part <= 0.03928 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4;
};

const channels = (hex: string): number[] => {
	const value = parseInt(hex.replace('#', ''), 16);
	return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
};

const luminanceOf = (colour: readonly number[]): number =>
	0.2126 * channel(colour[0]!) + 0.7152 * channel(colour[1]!) + 0.0722 * channel(colour[2]!);

const luminance = (hex: string): number => luminanceOf(channels(hex));

// WCAG 2 contrast ratio: (lighter + 0.05) / (darker + 0.05).
const between = (first: number, second: number): number =>
	(Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);

const ratio = (a: string, b: string): number => between(luminance(a), luminance(b));

// A translucent ink laid over an opaque background is that mixture, per channel. What a person
// reads is the mixture, so that is what a ratio has to be taken of.
const composited = (ink: string, paper: string, alpha: number): number[] =>
	channels(ink).map((value, i) => value * alpha + channels(paper)[i]! * (1 - alpha));

const sheet = context().theme;
const roleOf = (mode: Definitions, name: string): string => {
	const held = sheet.variable(mode, [], name);
	assert.ok(held !== null, `the theme defines $${name}`);
	return held;
};

// The pairs the contract names, and the ratio each has to reach: 4.5 for text, 3 for a line a
// person has to be able to see. Written here from the design, not read from the package.
const PAIRS: readonly (readonly [string, string, number])[] = [
	['foreground', 'background', 4.5],
	['foreground', 'muted', 4.5],
	['surfaceForeground', 'surface', 4.5],
	['mutedForeground', 'muted', 4.5],
	['mutedForeground', 'background', 4.5],
	['mutedForeground', 'surface', 4.5],
	['accentForeground', 'accent', 4.5],
	['accentSubtleForeground', 'accentSubtle', 4.5],
	['accentSubtleForeground', 'background', 4.5],
	['dangerForeground', 'danger', 4.5],
	['dangerSubtleForeground', 'dangerSubtle', 4.5],
	// The success tone, the same two pairs read the other way round (design 216).
	['successForeground', 'success', 4.5],
	['successSubtleForeground', 'successSubtle', 4.5],
	['accent', 'background', 3],
	['accent', 'surface', 3],
	['danger', 'background', 3],
	['danger', 'surface', 3],
	['success', 'background', 3],
	['success', 'surface', 3],
	['border', 'background', 3],
	['border', 'surface', 3],
	// A line on a quiet fill is the tightest pair the default theme ships. `disabled` used to make
	// it by repainting the control and no longer does (design 192), but a page that puts a bordered
	// block on a `$muted` panel still makes it, so the contract keeps it.
	['border', 'muted', 3],
	['input', 'background', 3],
	['input', 'surface', 3],
	// The focus ring is a line, and the halo it is drawn as is that line at half strength over
	// whatever is behind the control, so the role itself is measured at the line target.
	['ring', 'background', 3],
	['ring', 'surface', 3],
	// `$link` is text with no fill of its own, so it is measured against every background a page
	// can put it on (design 191).
	['link', 'background', 4.5],
	['link', 'surface', 4.5],
	['link', 'muted', 4.5],
];

const MODES: readonly (readonly [string, Definitions])[] = [['light', light], ['dark', dark]];

test('every role pair reaches its WCAG 2 AA target, in both modes', () => {
	for (const [mode, values] of MODES) {
		for (const [ink, paper, target] of PAIRS) {
			const measured = ratio(roleOf(values, ink), roleOf(values, paper));
			assert.ok(
				measured >= target,
				`${mode}: $${ink} on $${paper} is ${measured.toFixed(2)}:1, below ${String(target)}:1`,
			);
		}
	}
});

test('the focus ring is at least 3:1 against both backgrounds, in both modes', () => {
	for (const [mode, values] of MODES) {
		for (const paper of ['background', 'surface']) {
			const measured = ratio(roleOf(values, 'ring'), roleOf(values, paper));
			assert.ok(measured >= 3, `${mode}: $ring on $${paper} is ${measured.toFixed(2)}:1, below 3:1`);
		}
	}
});

test('the sanity check the ratio itself has to pass', () => {
	// Black on white is 21:1 by the formula. If this is wrong every number above is wrong.
	assert.equal(Math.round(ratio('#000000', '#ffffff') * 100) / 100, 21);
});

const warningsWhile = (run: () => void): string[] => {
	const said: string[] = [];
	const real = console.warn;
	console.warn = (...args: unknown[]): void => { said.push(args.map(String).join(' ')); };
	try {
		run();
	} finally {
		console.warn = real;
	}
	return said;
};

test('a theme whose named pair is unreadable warns with the ratio, the target and the role', () => {
	Theme.define({ dimPair: { background: '$muted', color: '$border' } });
	const expected = ratio(roleOf(light, 'border'), roleOf(light, 'muted'));
	assert.ok(expected < 4.5, 'the planted pair really is below the target');

	const said = warningsWhile(() => { sheet.classes(sheet.base(), ['dimPair']); });

	assert.equal(said.length, 1, 'one warning for one unreadable chain');
	assert.match(said[0]!, /theme chain "dimPair"/);
	assert.match(said[0]!, new RegExp(`at ${expected.toFixed(2)}:1`.replace('.', '\\.')));
	assert.match(said[0]!, /below the 4\.5:1 WCAG 2 AA target/);
	assert.match(said[0]!, /Use \$mutedForeground, the foreground paired with \$muted\./);
});

test('a pair written as two literals is the page\'s own business and is not measured', () => {
	Theme.define({ literalPair: { background: '#767676', color: '#7a7a7a' } });
	assert.deepEqual(compiled('literalPair'), []);
});

test('a pair that reaches the target says nothing', () => {
	Theme.define({ goodPair: { background: '$surface', color: '$surfaceForeground' } });
	assert.deepEqual(compiled('goodPair'), []);
});

test('an entry with no background is not a pair and is not measured', () => {
	Theme.define({ inkOnly: { color: '$border' } });
	assert.deepEqual(compiled('inkOnly'), []);
});

// A sheet reads the theme once and keeps that snapshot, so an entry defined inside a test is
// invisible to a sheet that has already been read. Each of these gets a sheet of its own.
const compiled = (name: string): string[] => {
	const own = context().theme;
	return warningsWhile(() => { own.classes(own.base(), [name]); });
};

test('a colour with alpha is measured over the background behind it', () => {
	Theme.define({ ghostPair: { background: '$background', color: '$alpha($foreground, 0.15)' } });

	// Worked out here from the formula: the ink mixed into the paper at 15%, then the ratio of
	// that mixture against the paper. Nothing in the package is asked what the answer is.
	const paper = roleOf(light, 'background');
	const mixed = composited(roleOf(light, 'foreground'), paper, 0.15);
	const expected = between(luminanceOf(mixed), luminance(paper));
	assert.ok(expected < 2, `15% of the foreground is ${expected.toFixed(2)}:1, nowhere near readable`);

	const said = compiled('ghostPair');
	assert.equal(said.length, 1, 'a pair nobody can read warns');
	assert.match(said[0]!, new RegExp(`at ${expected.toFixed(2)}:1`.replace('.', '\\.')));
});

test('a colour with almost no alpha left is still readable and says nothing', () => {
	Theme.define({ nearlySolidPair: { background: '$background', color: '$alpha($foreground, 0.9)' } });
	assert.deepEqual(compiled('nearlySolidPair'), []);
});

test('the advice names the foreground this theme pairs with that background', () => {
	Theme.define({ quietOnPage: { background: '$background', color: '$muted' } });
	const said = compiled('quietOnPage');

	assert.equal(said.length, 1);
	assert.match(said[0]!, /Use \$foreground, the foreground paired with \$background\./);
});

test('a background that is a scale step is offered only roles that exist and reach the target', () => {
	Theme.define({ stepPair: { background: '$neutral3', color: '$neutral6' } });
	const said = compiled('stepPair');
	assert.equal(said.length, 1);

	const paper = roleOf(light, 'neutral3');
	const advice = said[0]!.slice(said[0]!.indexOf('target for text.') + 'target for text.'.length);
	const offered = [...advice.matchAll(/\$(\w+)/g)].map((match) => match[1]!);
	assert.ok(offered.length > 0, 'a step background still gets somewhere to go');

	for (const name of offered) {
		const held = sheet.variable(light, [], name);
		assert.ok(held !== null, `$${name} is a value this theme defines`);
		const measured = ratio(held, paper);
		assert.ok(measured >= 4.5, `$${name} is ${measured.toFixed(2)}:1 on $neutral3, below 4.5:1`);
	}
});

test('the warning is not in a release build', () => {
	const source = readFileSync(new URL('../src/sheet.ts', import.meta.url), 'utf8');
	assert.match(source, /warnOnContrast\(/, 'the engine calls it in development');

	const built = transform(source, { filename: 'sheet.ts', release: true }).code;
	assert.doesNotMatch(built, /warnOnContrast\(/, 'and a release build has no call left to make');
});
