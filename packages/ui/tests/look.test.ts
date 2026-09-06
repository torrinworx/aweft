// The rest of the contract, as a page reaches it: the sizes, the type scale, the one state rule,
// the one ring, the one motion rule, the two modes on one page, and the snapshot that says what
// names there are.
//
// Every expected value here is written from the design in designs 115 to 119, not taken from a run.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { themeTokens } from '@aweftjs/testing';
import { type Definitions, Theme, context, dark, h, light, render } from '@aweftjs/ui';

const sheet = context().theme;
const valueOf = (name: string): string => {
	const held = sheet.variable(sheet.base(), [], name);
	assert.ok(held !== null, `the theme defines $${name}`);
	return held;
};

// The rules a theme list compiles to, for a fresh render so nothing else is in the sheet.
const rulesFor = (classes: readonly string[]): string => {
	const ui = context();
	ui.theme.classes(ui.theme.base(), classes);
	return ui.theme.markup();
};

test('the smallest pointer target is 24 pixels, and a control is at least that tall', () => {
	assert.equal(valueOf('target'), '24px');
	assert.match(rulesFor(['button']), /min-height: 24px/);
	assert.match(rulesFor(['input']), /min-height: 24px/);
});

test('the spacing step is four pixels and everything else made of space is a multiple of it', () => {
	assert.equal(valueOf('space'), '4px');
	for (const [name, times] of [['space2', 2], ['space3', 3], ['space4', 4], ['space6', 6], ['space8', 8], ['space12', 12]] as const) {
		assert.equal(valueOf(name), `${String(times * 4)}px`, `$${name} is ${String(times)} steps`);
	}
});

test('every type size is in rem and has a line height beside it', () => {
	for (const size of ['textXs', 'textSm', 'textMd', 'textLg', 'textXl', 'text2xl']) {
		assert.match(valueOf(size), /^\d+(\.\d+)?rem$/, `$${size} is in rem`);
		assert.match(valueOf(`${size}Line`), /^\d+(\.\d+)?rem$/, `$${size}Line is in rem`);
	}
	// A size a person has not asked to be bigger is one rem, which is what `rem` is for.
	assert.equal(valueOf('textMd'), '1rem');
});

test('hover and press are one rule each, and press is the stronger of the two', () => {
	const strength = (classes: readonly string[]): number => {
		const found = /currentColor (\d+)%/.exec(rulesFor(classes));
		assert.ok(found !== null, `${classes.join(' ')} lays a tint of the foreground on`);
		return Number(found[1]);
	};

	const hover = strength(['hovered']);
	const press = strength(['pressed']);
	assert.ok(hover > 0, 'a hover that mixes nothing in is not a hover');
	assert.ok(press > hover, 'press reads as more than hover');

	// The tint is laid over whatever background the element already has, so one rule covers every
	// component and neither mode needs a second one.
	assert.match(rulesFor(['button', 'hovered']), /background: [^;]+; /);
	assert.match(rulesFor(['button', 'hovered']), /background-image: linear-gradient\(color-mix/);
});

test('the ring is set once at the root, so an element that asked for no ring has one', () => {
	// `card` says nothing about focus, and gets the ring anyway.
	const rules = rulesFor(['card']);
	assert.match(rules, new RegExp(`:focus-visible \\{ outline: 2px solid ${valueOf('ring')}`));
	assert.match(rules, /outline-offset: 2px/);
});

test('no entry in this package turns an outline off', () => {
	const source = fileURLToPath(new URL('../src/defaults.ts', import.meta.url));
	assert.doesNotMatch(readFileSync(source, 'utf8'), /outline:\s*'?none/);
});

test('motion is declared only inside the query that asks whether the person wants any', () => {
	const rules = rulesFor(['button']);
	assert.match(rules, /@media \(prefers-reduced-motion: no-preference\) \{[^}]*transition-duration: 120ms/);
	// Nothing outside the query sets a transition, so there is no rule for a reduce override to
	// have to beat.
	const outside = rules.split('@media')[0]!;
	assert.doesNotMatch(outside, /transition/);
	assert.doesNotMatch(rules, /prefers-reduced-motion: reduce/);
});

test('light and dark nested on one page each resolve their own roles', async () => {
	const ui = context();
	const markup = await render(
		h('div', {},
			h(Theme, { value: light }, h('div', { theme: 'card' })),
			h(Theme, { value: dark }, h('div', { theme: 'card' }))),
		{ context: ui },
	);

	const classes = [...markup.matchAll(/class="(aw\d+)"/g)].map((found) => found[1]!);
	assert.equal(classes.length, 2, 'one class per mode');
	assert.notEqual(classes[0], classes[1], 'the two modes are two themes and get two classes');

	const backgroundOf = (name: string): string => {
		const found = new RegExp(`\\.${name} \\{ background: ([^;]+);`).exec(ui.theme.markup());
		assert.ok(found !== null, `${name} has a background`);
		return found[1]!;
	};
	assert.equal(backgroundOf(classes[0]!), sheet.variable(light, [], 'surface'));
	assert.equal(backgroundOf(classes[1]!), sheet.variable(dark, [], 'surface'));
});

test('a mode is a partial theme: it moves the roles and leaves everything else alone', () => {
	const modes: readonly (readonly [string, Definitions])[] = [['light', light], ['dark', dark]];
	for (const [name, values] of modes) {
		assert.deepEqual(Object.keys(values), ['*'], `${name} touches only the root entry`);
		// The sizes and the type scale are shared, so they are not in either mode.
		assert.equal(sheet.variable(values, [], 'space'), null, `${name} does not restate the sizes`);
	}
	assert.notEqual(sheet.variable(light, [], 'background'), sheet.variable(dark, [], 'background'));
});

test('tokens.txt lists every name the package defines', () => {
	const src = fileURLToPath(new URL('../src', import.meta.url));
	const files = readdirSync(src)
		.filter((name) => name.endsWith('.ts') || name.endsWith('.tsx'))
		.map((name) => ({ path: name, text: readFileSync(join(src, name), 'utf8') }));

	const committed = readFileSync(new URL('../tokens.txt', import.meta.url), 'utf8')
		.split('\n').filter((line) => line !== '');

	assert.deepEqual(themeTokens(files), committed, 'run npm run theme when the contract widens');
	// The roles and the scale steps are what the snapshot is for; the check would be empty without
	// them whatever else it listed.
	for (const name of ['background', 'foreground', 'ring', 'neutral1', 'neutral12', 'accent9', 'danger9']) {
		assert.ok(committed.includes(name), `${name} is in the snapshot`);
	}
});
