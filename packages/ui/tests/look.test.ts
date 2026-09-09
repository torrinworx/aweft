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

import { checkTheme, themeTokens } from '@aweftjs/testing';
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

test('every control is one named height, and the pointer target is what is left over', () => {
	// The three heights of the size axis, and the one every control is at rest (design 192).
	assert.equal(valueOf('controlSm'), '32px');
	assert.equal(valueOf('control'), '36px');
	assert.equal(valueOf('controlLg'), '40px');

	for (const entry of ['button', 'input', 'select']) {
		assert.match(rulesFor([entry]), /min-height: 36px/, `${entry} is $control tall`);
	}
	// The row a checkbox, a radio or a toggle sits in beside its words, and the slider's hit area.
	assert.match(rulesFor(['field', 'inline']), /min-height: 36px/);
	assert.match(rulesFor(['slider']), /height: 36px/);

	// A text area is sized by what is in it, so it takes the fixed height back off.
	assert.match(rulesFor(['input', 'textarea']), /height: auto/);

	// `$target` is still the smallest a pointer target may be, and after design 195 drew the tick
	// box out of its own named value, nothing in the default theme is sized from it. It stays
	// defined, because it is the number an application reaches for and the one `check-theme.ts`
	// names as the fix for a bare `min-width`.
	assert.equal(valueOf('target'), '24px');
});

test('the size axis is one segment, and each entry resolves its own height', () => {
	// Design 194. Each row is the class list an application writes and the height it computes.
	const heights: readonly (readonly [readonly string[], string])[] = [
		[['button'], '36px'], [['button', 'sm'], '32px'], [['button', 'lg'], '40px'],
		[['input'], '36px'], [['input', 'sm'], '32px'], [['input', 'lg'], '40px'],
		[['select'], '36px'], [['select', 'sm'], '32px'], [['select', 'lg'], '40px'],
		[['slider'], '36px'], [['slider', 'sm'], '32px'], [['slider', 'lg'], '40px'],
	];
	for (const [classes, height] of heights) {
		assert.match(rulesFor(classes), new RegExp(`height: ${height}`),
			`${classes.join(' ')} is ${height} tall`);
	}

	// The box, the pill and the thumb are sized by name, so a size entry is the names and the
	// rules that read them do not move.
	assert.match(rulesFor(['checkbox']), /width: 16px; height: 16px/);
	assert.match(rulesFor(['checkbox', 'sm']), /width: 14px; height: 14px/);
	assert.match(rulesFor(['checkbox', 'lg']), /width: 20px; height: 20px/);
	// A radio reaches the small box through `extends`, because a modifier of one entry is not a
	// modifier of what it extends.
	assert.match(rulesFor(['radio', 'sm']), /width: 14px; height: 14px/);
	assert.match(rulesFor(['radio', 'lg']), /width: 20px; height: 20px/);
	assert.match(rulesFor(['toggle', 'sm']), /width: 32px; height: 20px/);
	assert.match(rulesFor(['toggle', 'lg']), /width: 48px; height: 28px/);
	assert.match(rulesFor(['slider', 'sm']), /::-webkit-slider-thumb \{[^}]*width: 14px/);

	// A small control takes the smaller text step and the tighter padding; a large one is the same
	// text in a taller box.
	assert.match(rulesFor(['button', 'sm']), new RegExp(`font-size: ${valueOf('textXs')}`));
	assert.match(rulesFor(['button', 'sm']), /padding: 4px 8px/);
	assert.match(rulesFor(['button', 'lg']), new RegExp(`font-size: ${valueOf('textSm')}`));
	assert.match(rulesFor(['input', 'lg']), /padding: 4px 16px/);

	// A sized select keeps the room its own arrow sits in. `select_sm` extends `input_sm`, whose
	// `padding` shorthand sits after `select`'s own `padding-right` in the chain, so the room has to
	// be said again in the size entry or the arrow lands on the words.
	for (const [size, shorthand] of [['sm', '4px 8px'], ['lg', '4px 16px']] as const) {
		const rules = rulesFor(['select', size]);
		assert.equal(
			rules.lastIndexOf(`padding-right: ${valueOf('space8')}`) > rules.lastIndexOf(`padding: ${shorthand}`),
			true,
			`select_${size} says the room for the arrow after the size's own padding`,
		);
	}
});

test('the drawn tick follows the size axis, so the mark fits every box', () => {
	// The mark is an empty box with two borders turned 45 degrees, so what has to fit inside the
	// box is (width + stroke + height + stroke) / root two. Fixed at 4, 8 and 2 the mark was
	// 11.31px in a 12px inner box at `sm` and in an 18px one at `lg` (measured before the fix).
	const marks: readonly (readonly [readonly string[], number, number, number, number])[] = [
		[['checkbox', 'sm'], 14, 3, 6, 2],
		[['checkbox'], 16, 4, 8, 2],
		[['checkbox', 'lg'], 20, 5, 10, 3],
	];
	for (const [classes, box, width, height, stroke] of marks) {
		const rules = rulesFor(classes);
		const name = classes.join(' ');
		assert.match(rules, new RegExp(`width: ${String(width)}px; height: ${String(height)}px`),
			`${name} draws its own mark`);
		assert.match(rules, new RegExp(`border-right: ${String(stroke)}px solid`), `${name} has its own stroke`);
		assert.match(rules, new RegExp(`margin-top: -${String(stroke)}px`), `${name} nudges by its own stroke`);
		// The bar the indeterminate state draws is the same two names read the other way round.
		assert.match(rules, new RegExp(`width: ${String(height)}px; height: ${String(stroke)}px`),
			`${name} draws its own bar`);
		// It has to fit inside the box, borders off.
		const turned = (width + stroke + height + stroke) / Math.SQRT2;
		assert.ok(turned < box - 2, `${name}: the turned mark is ${turned.toFixed(2)}px in a ${String(box - 2)}px box`);
	}
});

test('an icon button is a square, and the size keeps it one', () => {
	// `size="icon-sm"` is two segments, `square` then `sm`, so it reaches `button_square` and
	// `button_square_sm` (design 194, amended).
	assert.match(rulesFor(['button', 'square']), /width: 36px/);
	assert.match(rulesFor(['button', 'square']), /padding: 0px/);
	assert.match(rulesFor(['button', 'square', 'sm']), /width: 32px/);
	assert.match(rulesFor(['button', 'square', 'lg']), /width: 40px/);
	// `button_sm` matches later in the list than `button_square`, so its padding shorthand is the
	// last word unless the icon size says the zero again. This is what says it does.
	const small = rulesFor(['button', 'square', 'sm']);
	assert.equal(small.lastIndexOf('padding: 0px') > small.lastIndexOf('padding: 4px 8px'), true,
		'the square keeps its zero padding at every size');
});

test('the square button keeps its own box, because no entry is named by its segment', () => {
	// The segment used to be `icon`, which is also an entry: the class list `['button', 'icon']`
	// compiled the `icon` entry's `display: inline-block; width: 1em; height: 1em` onto the button
	// and the label stopped being centred. Measured in Chromium before the fix, the svg inside the
	// 36px square sat 12.25px from the top and 9.75px from the bottom.
	const square = rulesFor(['button', 'square']);
	assert.match(square, /display: inline-flex/, 'the square still centres what is in it');
	assert.doesNotMatch(square, /display: inline-block/, 'and nothing lays it out as an icon');
	assert.doesNotMatch(square, /width: 1em/, 'and nothing sizes it as one');
	// The rule that closes the class of bug, over the theme this package ships.
	const defaults = readFileSync(fileURLToPath(new URL('../src/defaults.ts', import.meta.url)), 'utf8');
	assert.deepEqual(
		checkTheme([{ path: 'defaults.ts', text: defaults }]),
		[],
		'no segment of an entry in the default theme is the name of another entry',
	);
});

test('a text area is the shape rule, and a size does not give it a fixed height', () => {
	// `textarea` sits after the size segment in the class list a `TextArea` writes, which is what
	// keeps `input_sm`'s fixed height off it (design 194).
	const small = rulesFor(['input', 'sm', 'textarea']);
	assert.match(small, /height: auto/);
	assert.equal(small.lastIndexOf('height: auto') > small.lastIndexOf('height: 32px'), true,
		'the shape rule is the last word on the height');
	assert.match(small, new RegExp(`font-size: ${valueOf('textXs')}`), 'and the small text still applies');
});

test('a control declares its own box model, so its height is its height', () => {
	// A `<button>` is border-box in every host and an `<a href>` wearing the same entry is not, so
	// the entry says which, and the declared height is the height either way.
	for (const entry of ['button', 'input']) {
		assert.match(rulesFor([entry]), /box-sizing: border-box/, `${entry} says what its height means`);
	}
});

test('an input carries the hairline edge and a quiet button carries it too', () => {
	// An edge, not elevation: one pixel down, two of blur, in the element's own
	// foreground at 6%. `currentColor` rather than `$foreground`, because a $name holds text and
	// that text is not read again (design 111), so a role written inside one never resolves.
	assert.equal(valueOf('shadowSm'), '0 1px 2px color-mix(in srgb, currentColor 6%, transparent)');
	assert.match(rulesFor(['input']), /box-shadow: 0 1px 2px color-mix\(in srgb, currentColor 6%, transparent\)/);
	assert.match(rulesFor(['button', 'quiet']), /box-shadow: 0 1px 2px color-mix/);
	assert.doesNotMatch(rulesFor(['button']), /box-shadow: 0 1px/, 'a filled button has no edge to draw');
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
	// `card` says nothing about focus, and gets the ring anyway. It is a halo drawn as a box
	// shadow, with the border moving to `$ring` beside it (design 192).
	const rules = rulesFor(['card']);
	const ring = valueOf('ring');
	assert.match(rules, /:focus-visible \{ outline: none;/);
	assert.match(rules, new RegExp(`:focus-visible \\{ outline: none; border-color: ${ring};`));
	// The `$ring` inside the `color-mix()` resolved, which is what says a role reaches into a CSS
	// function rather than only standing on its own.
	assert.match(rules, new RegExp(`box-shadow: 0 0 0 3px color-mix\\(in srgb, ${ring} 50%, transparent\\);`));
	assert.doesNotMatch(rules, /outline-offset/, '$ringOffset is gone: a halo starts at the border box');
});

test('the one entry that turns an outline off draws the ring another way', () => {
	// Design 119's check refuses an `outline: none` in an entry that names `$ring` nowhere. This
	// says the same thing about this package's own source: there is exactly one, it is the focus
	// rule, and the block it sits in names the role twice.
	const source = readFileSync(fileURLToPath(new URL('../src/defaults.ts', import.meta.url)), 'utf8');
	const off = source.match(/outline: 'none'/g) ?? [];
	assert.equal(off.length, 1, 'one entry, and the next assertion says which');
	assert.match(source, /outline: 'none',\n\t*borderColor: '\$ring',/);
});

test('a disabled control dims rather than repaints', () => {
	// Repainting it in `$muted` turned a disabled danger button into a disabled default button,
	// which loses what the control is (design 192).
	const rules = rulesFor(['button', 'danger', 'disabled']);
	assert.match(rules, /opacity: 0\.5/);
	assert.match(rules, /cursor: not-allowed/);
	assert.match(rules, /background-image: none/, 'and the state tint goes off');
	assert.match(rules, new RegExp(`background: ${valueOf('danger')}`), 'the danger fill is still there');
});

test('an overlay arrives from nothing, and only where motion is welcome', () => {
	for (const entry of ['dialog', 'popup', 'tooltip']) {
		const rules = rulesFor([entry]);
		assert.match(rules, /@starting-style \{ [^}]*opacity: 0; transform: scale\(0\.96\);/,
			`${entry} has a style to start from`);
		assert.match(rules, /@media \(prefers-reduced-motion: no-preference\) \{[^}]*transition: opacity 120ms/,
			`${entry} moves only where motion is welcome`);
		const outside = rules.replace(/@media[^{]*\{[\s\S]*?\}\s*\}/g, '');
		assert.doesNotMatch(outside, /transition:/, `nothing outside the query gives ${entry} a transition`);
	}

	// A dialog that is no longer open is still on the screen while it goes, which is what the two
	// discrete properties in its list are for.
	const dialog = rulesFor(['dialog']);
	assert.match(dialog, /display 120ms allow-discrete, overlay 120ms allow-discrete/);
	assert.match(dialog, /:not\(\[open\]\) \{ opacity: 0; transform: scale\(0\.96\);/);

	// And the scrim goes with it. The transition is on `.awN::backdrop` inside the reduced-motion
	// query, which is a pseudo block inside a query block: the nesting design 190's amendment
	// buys, and the reason the backdrop used to appear and go without fading.
	assert.match(dialog,
		/@media \(prefers-reduced-motion: no-preference\) \{ \.aw\d+::backdrop \{ transition: opacity 120ms/);
	assert.match(dialog, /@starting-style \{ \.aw\d+::backdrop \{ opacity: 0; \} \}/);
	assert.match(dialog, /:not\(\[open\]\)::backdrop \{ opacity: 0; \}/);
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

test('the default theme is monochrome: the solid roles are steps of the neutral scale', () => {
	// Design 191, written from the design: the role, and the step it takes, in both modes. The
	// step's own value is read from the mode so this says which step, not which colour.
	const step = (values: Definitions, name: string): string => {
		const held = sheet.variable(values, [], name);
		assert.ok(held !== null, `the theme defines $${name}`);
		return held;
	};
	for (const values of [light, dark]) {
		assert.equal(step(values, 'accent'), step(values, 'neutral12'));
		assert.equal(step(values, 'accentForeground'), step(values, 'neutral1'));
		assert.equal(step(values, 'accentSubtle'), step(values, 'neutral3'));
		assert.equal(step(values, 'accentSubtleForeground'), step(values, 'neutral12'));
		assert.equal(step(values, 'ring'), step(values, 'neutral8'));
		// The one role that keeps the accent scale, for text that goes somewhere.
		assert.equal(step(values, 'link'), step(values, 'accent11'));
		// The scales themselves did not move: step 9 of the accent scale is still the blue it was.
		assert.notEqual(step(values, 'accent9'), step(values, 'accent'));
	}
	// A link is a text colour, so it has no fill to pair with and nothing names $linkForeground.
	assert.equal(sheet.variable(light, [], 'linkForeground'), null);
	// The button that sits inside a line of text is the one entry that uses it.
	assert.match(rulesFor(['button', 'inline']), new RegExp(`color: ${step(light, 'link')}`));
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

test('a part named as one class token wears its own rules and none of its component\'s', () => {
	// Design 193. A class token holding `_` names exactly that entry, so a label themed
	// `field_label` no longer also matches the bare `field` and no longer takes its full-width
	// column, and a file drop's row no longer wears the drop zone's dashed border.
	for (const part of ['field_label', 'field_hint', 'field_error']) {
		const rules = rulesFor([part]);
		assert.doesNotMatch(rules, /flex-direction: column/, `${part} is not a column`);
		assert.doesNotMatch(rules, /width: 100%/, `${part} does not take the whole row`);
	}
	assert.match(rulesFor(['field']), /flex-direction: column/, 'and the field itself still is one');

	const row = rulesFor(['filedrop_entry']);
	assert.doesNotMatch(row, /border: 1px dashed/, 'a row is not the zone it is listed in');
	assert.doesNotMatch(row, /padding: 16px/);
	assert.match(row, /display: flex; align-items: center; gap: 8px/, 'and it is still the row');

	const head = rulesFor(['dialog_head']);
	assert.doesNotMatch(head, /max-width/, 'a dialog\'s head is not a second dialog');
	assert.doesNotMatch(head, /padding: 16px/);
	assert.match(head, /justify-content: space-between/);

	// A modifier of a part is still a segment after it, and still reaches the modifier only.
	assert.match(rulesFor(['filedrop_entry', 'error']), new RegExp(`color: ${valueOf('dangerSubtleForeground')}`));
	assert.match(rulesFor(['colorpicker_track', 'hue']), /linear-gradient/);
});

test('a form\'s layout is three entries and two modifiers', () => {
	// Design 196. `field_group`, `field_set` and `field_legend` are parts, so each is one class
	// token; `field_inline` and `field_responsive` are modifiers of `field`, so each is a segment.
	const group = rulesFor(['field_group']);
	assert.match(group, /display: flex; flex-direction: column/);
	assert.match(group, new RegExp(`gap: ${valueOf('space6')}`), '$space6 between fields');
	assert.match(group, /container-type: inline-size/,
		'which is the container a responsive field measures');

	const set = rulesFor(['field_set']);
	assert.match(set, new RegExp(`gap: ${valueOf('space6')}`), 'the same column a group is');
	// A fieldset arrives from the host with all four of these and none of them belongs in a stack.
	assert.match(set, /border: none/);
	assert.match(set, /padding: 0px/);
	assert.match(set, /margin: 0px/);
	assert.match(set, /min-width: 0px/);

	const legend = rulesFor(['field_legend']);
	assert.match(legend, new RegExp(`font-size: ${valueOf('textSm')}`));
	assert.match(legend, /font-weight: 500/);
	assert.match(legend, new RegExp(`margin-bottom: ${valueOf('space2')}`));

	// The inline row is declared; the responsive one is the same row taken at a width.
	const inline = rulesFor(['field', 'inline']);
	assert.match(inline, /flex-direction: row/);
	assert.match(inline, new RegExp(`min-height: ${valueOf('control')}`));
	assert.doesNotMatch(inline, /@container/);

	const responsive = rulesFor(['field', 'responsive']);
	assert.match(responsive, /@container \(min-width: 28rem\) \{[^}]*flex-direction: row/);
	const outside = responsive.replace(/@container[^{]*\{[\s\S]*?\}\s*\}/g, '');
	assert.doesNotMatch(outside, /flex-direction: row/,
		'nothing outside the query turns a responsive field');
});

test('a label under a marked field takes the colour its message already has', () => {
	// The rule is written from the label rather than from the field, because a part's class is
	// generated per chain and `field`'s rules cannot name this one's (design 196). `_elem_` puts
	// the attribute in front of the label's own class, which is a descendant selector.
	const label = rulesFor(['field_label']);
	assert.match(label, new RegExp(`\\[data-invalid\\] \\.aw\\d+ \\{ color: ${valueOf('dangerSubtleForeground')}; \\}`));
	// The same role the message under it uses, so the two are one colour.
	assert.match(rulesFor(['field_error']), new RegExp(`color: ${valueOf('dangerSubtleForeground')}`));
	// And the label is its own colour with nothing marked.
	assert.match(label, new RegExp(`color: ${valueOf('foreground')}`));
});

test('a select says the appearance twice and draws its own arrow', () => {
	const rules = rulesFor(['select']);
	// It lays out children of its own, so it cannot be the block an input is (design 192).
	assert.match(rules, /display: inline-flex/);
	assert.match(rules, /align-items: center/);
	// `none` first, so every host stops drawing its arrow; `base-select` second, which Chromium 135
	// and later takes and which is what lets the open list be themed (design 195). A host that does
	// not know the second keyword drops that declaration and keeps the first.
	assert.match(rules, /appearance: none; appearance: base-select/);
	assert.match(rules, /::picker-icon \{ display: none; \}/, 'the host\'s own icon is hidden');
	assert.match(rules, /::picker\(select\)/, 'and the list itself is styled by name');
	// The two parts the component puts around the element. The arrow is the tick's trick again:
	// an empty $chevron box with two of its sides drawn, turned a quarter turn (design 195,
	// amended), so nothing here asks the `Icons` stack for a name.
	assert.match(rulesFor(['select_wrap']), /position: relative/);
	const arrow = rulesFor(['select_chevron']);
	assert.equal(valueOf('chevron'), '8px');
	assert.match(arrow, /position: absolute/);
	assert.match(arrow, /width: 8px; height: 8px/);
	assert.match(arrow, new RegExp(`border-right: 1px solid ${valueOf('mutedForeground')}`));
	assert.match(arrow, new RegExp(`border-bottom: 1px solid ${valueOf('mutedForeground')}`));
	assert.match(arrow, /transform: translateY\(-50%\) rotate\(45deg\)/);
	assert.match(arrow, /pointer-events: none/, 'a click on the arrow reaches the select under it');
	assert.doesNotMatch(arrow, /display: inline-flex/, 'and it is not the select itself');
});

test('a tick box and a radio are drawn here, out of named values only', () => {
	// Design 195: the host is told to draw nothing, and the box, the tick and the bar are rules.
	const box = rulesFor(['checkbox']);
	assert.match(box, /appearance: none/, 'the host draws no box of its own');
	assert.doesNotMatch(box, /accent-color/, 'and it is no longer asked to tint one');
	assert.match(box, /display: inline-grid; place-content: center/, 'the mark is centred by the box');
	assert.match(box, new RegExp(`:checked \\{ background: ${valueOf('accent')}`));
	// The tick: two sides of an empty box, turned a quarter turn.
	assert.match(box, /:checked::before \{ content: ''; width: 4px; height: 8px/);
	assert.match(box, new RegExp(`border-right: 2px solid ${valueOf('accentForeground')}`));
	assert.match(box, /transform: rotate\(45deg\)/);
	// Neither ticked nor clear is one bar across the middle.
	assert.match(box, /:indeterminate::before \{ content: ''; width: 8px; height: 2px/);

	const dot = rulesFor(['radio']);
	assert.match(dot, /border-radius: 50%/);
	// The tick's two borders and its turn are taken back by name, because `extends` merges.
	assert.match(dot, /:checked::before \{ width: 8px; height: 8px; margin-top: 0px; border: none/);
	assert.match(dot, /transform: none/);

	// The focus ring reaches both through the root rule (design 118), so a box the host no longer
	// draws still shows focus and neither entry says a word about it.
	for (const entry of ['checkbox', 'radio']) {
		const rules = rulesFor([entry]);
		assert.match(rules, new RegExp(`:focus-visible \\{ outline: none; border-color: ${valueOf('ring')};`));
		assert.equal(rules.match(/:focus-visible/g)?.length, 1, `${entry} declares no ring of its own`);
	}
});

test('the switch, the slider and the tick box are drawn out of named values only', () => {
	for (const entry of ['toggle', 'slider', 'checkbox', 'radio', 'dot', 'icon', 'field_label']) {
		// More than the `*` entry alone, which every class list reaches.
		assert.ok(rulesFor([entry]).length > rulesFor([]).length, `the default theme has a ${entry} entry`);
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
	const rules = rulesFor(['filedrop_picker']);
	assert.ok(rules.length > rulesFor([]).length, 'the default theme has a filedrop_picker entry');
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
