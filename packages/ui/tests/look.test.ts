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
	for (const size of ['textXs', 'textSm', 'textMd', 'textLg', 'textXl', 'text2xl', 'text3xl', 'text4xl']) {
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

// --- the entries the controls and the layout names compile to (designs 128, 130, 132) ----------

test('row and column lay out in a line, and center means across the page on both', () => {
	assert.match(rulesFor(['row']), /flex-direction: row/);
	assert.match(rulesFor(['column']), /flex-direction: column/);
	// A row lays out along the page, so across it is `justify-content`; a column lays out down it,
	// so across it is `align-items`. One word, one meaning, two rules.
	assert.match(rulesFor(['row', 'center']), /justify-content: center/);
	assert.match(rulesFor(['column', 'center']), /align-items: center/);
	assert.match(rulesFor(['row', 'start']), /justify-content: flex-start/);
	assert.match(rulesFor(['column', 'end']), /align-items: flex-end/);
});

test('the layout modifiers the applications use all exist', () => {
	for (const modifier of ['fill', 'center', 'start', 'end', 'spread', 'wrap', 'tight']) {
		for (const base of ['row', 'column']) {
			const own = rulesFor([base, modifier]);
			assert.notEqual(own, rulesFor([base]), `${base}_${modifier} says something ${base} does not`);
		}
	}
});

test('the space between things in a row is a named step, and tight takes it away', () => {
	assert.match(rulesFor(['row']), /gap: 8px/);
	assert.match(rulesFor(['row', 'tight']), /gap: 0/);
});

test('a divider is one line the width of the block it is in', () => {
	const rules = rulesFor(['divider']);
	assert.match(rules, new RegExp(`height: ${valueOf('borderWidth')}`));
	assert.match(rules, new RegExp(`background: ${valueOf('border')}`));
});

test('a select asks for the appearance whose open list can be themed', () => {
	const rules = rulesFor(['select']);
	// Chromium 135 and later draws the list from the theme; every other host ignores this and
	// draws its own, which is the cost design 130 names.
	assert.match(rules, /appearance: base-select/);
	assert.match(rules, /::picker\(select\)/, 'and the list itself is styled by name');
});

test('the switch, the slider and the tick box are drawn out of named values only', () => {
	for (const entry of ['toggle', 'slider', 'checkbox', 'radio', 'dot', 'icon', 'field_label']) {
		const rules = rulesFor(entry.split('_'));
		assert.notEqual(rules, '', `the default theme has a ${entry} entry`);
	}
	// The two vendor pseudo-elements a range input is drawn on, spelled with their own colons.
	assert.match(rulesFor(['slider']), /::-webkit-slider-thumb/);
	assert.match(rulesFor(['slider']), /::-moz-range-thumb/);
	// The thumb sits on the middle of the track, worked out in the stylesheet rather than by hand.
	assert.match(rulesFor(['slider']), /margin-top: calc\(\(6px - 16px\) \/ 2\)/);
});

test('the file input is hidden and still focusable, which is what offscreen means', () => {
	// The README says the input is visually hidden rather than `display: none`, so the keyboard can
	// still reach it. `display: none` takes an element out of the focus order, so the claim is only
	// true while the rule stays a clipped one-pixel box.
	const rules = rulesFor(['filedrop', 'input']);
	assert.notEqual(rules, '', 'the default theme has a filedrop_input entry');
	assert.doesNotMatch(rules, /display: *none/, 'display: none would take it off the keyboard');
	assert.match(rules, /clip-path: inset\(50%\)/);
	assert.match(rules, /width: 1px/);
	assert.match(rules, /height: 1px/);
});

test('the dots move only inside the query that asks whether the person wants motion', () => {
	const rules = rulesFor(['dot']);
	assert.match(rules, /@keyframes pulse-/, 'the keyframes are named after the entry that owns them');
	const outside = rules.replace(/@media[^{]*\{[\s\S]*?\}\s*\}/g, '');
	assert.doesNotMatch(outside, /animation:/, 'nothing animates outside the query');
	assert.match(rules, /@media \(prefers-reduced-motion: no-preference\) \{[^}]*animation:/);
});

test('a card drops its padding when it is tight, and nothing else', () => {
	const plain = rulesFor(['card']);
	const tight = rulesFor(['card', 'tight']);
	assert.match(plain, /padding: 16px/);
	assert.match(tight, /padding: 0/);
	assert.match(tight, new RegExp(`background: ${valueOf('surface')}`), 'it is still a card');
});

// --- the text family (designs 180, 182) ---------------------------------------------------------

test('a newline in a run of text is a line break, and no paragraph has a width cap', () => {
	assert.match(rulesFor(['text']), /white-space: pre-wrap/);
	for (const size of ['p1', 'p2']) {
		assert.doesNotMatch(rulesFor(['text', size]), /max-width/,
			'a measure is the application\'s, on its own entry');
	}
});

test('each size entry is that step of the scale and its line height', () => {
	// The words are the scale's own, written from design 182, so `text_3xl` and `text_4xl` are
	// reachable as sizes rather than only through `h1` and `h2`.
	const steps = [
		['xs', 'textXs'], ['sm', 'textSm'], ['lg', 'textLg'], ['xl', 'textXl'],
		['2xl', 'text2xl'], ['3xl', 'text3xl'], ['4xl', 'text4xl'],
	] as const;
	for (const [word, size] of steps) {
		const rules = rulesFor(['text', word]);
		assert.ok(rules.includes(`font-size: ${valueOf(size)};`), `text_${word} is $${size}`);
		assert.ok(rules.includes(`line-height: ${valueOf(`${size}Line`)};`), `and its line height`);
	}
});

test('each heading is one step of the scale, at one weight, with balanced lines', () => {
	// h1 at the top of the scale down to h6 at body size, written from design 182.
	const steps = [
		['h1', 'text4xl'], ['h2', 'text3xl'], ['h3', 'text2xl'],
		['h4', 'textXl'], ['h5', 'textLg'], ['h6', 'textMd'],
	] as const;
	for (const [heading, size] of steps) {
		const rules = rulesFor(['text', heading]);
		assert.ok(rules.includes(`font-size: ${valueOf(size)};`), `text_${heading} is $${size}`);
		assert.ok(rules.includes(`line-height: ${valueOf(`${size}Line`)};`), `and its line height`);
		assert.match(rules, /font-weight: 600/, `text_${heading} is one weight with the rest`);
		assert.match(rules, /text-wrap: balance/, 'a heading is short enough for the browser to even it out');
	}
	// A paragraph is the other hint: no lone last word, and no balancing a block too long for it.
	assert.match(rulesFor(['text', 'p1']), /text-wrap: pretty/);
	assert.match(rulesFor(['text', 'p2']), /text-wrap: pretty/);
	assert.doesNotMatch(rulesFor(['text', 'p1']), /text-wrap: balance/);
});

test('a modifier written after a heading is the one that lands', () => {
	const rules = rulesFor(['text', 'h2', 'bold']);
	// One block per entry in the chain, in the order the chain applies them.
	const blocks = [...rules.matchAll(/\.aw\d+ \{ ([^}]*)\}/g)].map((found) => found[1]!.trim());
	const heading = blocks.findIndex((block) => block.includes(`font-size: ${valueOf('text3xl')};`));
	const bold = blocks.findIndex((block) => block === 'font-weight: 600;');
	assert.ok(heading >= 0, 'text_h2 compiled a block of its own');
	assert.ok(bold >= 0, 'and so did text_bold');
	assert.ok(bold > heading, 'text_bold sits later in the class list, so it is written later');

	// The same order with two values that differ, which is what makes "wins" something to see.
	const weights = [...rulesFor(['text', 'h2', 'regular']).matchAll(/font-weight: (\d+);/g)]
		.map((found) => found[1]);
	assert.deepEqual(weights, ['600', '400'], 'text_regular after text_h2 takes the weight back down');
});

test('the modifiers say one thing each and nothing about size', () => {
	assert.match(rulesFor(['text', 'italic']), /font-style: italic/);
	assert.match(rulesFor(['text', 'center']), /text-align: center/);
	assert.match(rulesFor(['text', 'inline']), /display: inline/);
	for (const modifier of ['bold', 'regular', 'italic', 'center', 'inline']) {
		// The chain is `*`, `text`, then the modifier, so the modifier's own block is the last one.
		const blocks = [...rulesFor(['text', modifier]).matchAll(/\.aw\d+ \{ ([^}]*)\}/g)]
			.map((found) => found[1]!.trim());
		const own = blocks[blocks.length - 1]!;
		assert.doesNotMatch(own, /font-size/, `text_${modifier} sets no size of its own`);
		assert.equal(own.split(';').filter((part) => part.trim() !== '').length, 1,
			`text_${modifier} says one thing`);
	}
});
