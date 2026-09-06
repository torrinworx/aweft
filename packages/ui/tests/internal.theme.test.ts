// The theme engine from inside: the matcher, the compiler, the value language and the colour
// reader. What a page sees of all this is `theme.test.ts`; this file reaches past the surface,
// so it is named `internal.*` and does not count toward the public-export gate.
//
// Every expected value here is written from the design rather than taken from a run: the class
// chain for a theme list is worked out by hand from the matching rule, and the CSS is what the
// directive says it compiles to.

import test from 'node:test';
import assert from 'node:assert/strict';

import { Theme, context } from '@aweftjs/ui';

import { baseTheme, chainOf, compileChain, createSheet, mergeTheme } from '../src/sheet.ts';
import { type Lookup, parseValue, resolve } from '../src/values.ts';
import { themeFunctions } from '../src/functions.ts';
import { readColour, writeColour } from '../src/color.ts';

const defs = {
	'*': { $ink: '#101010', $pad: '4' },
	button: { padding: '$pad$px', color: '$ink' },
	button_hovered: { color: 'red' },
	hovered: { outline: '1px solid $hover' },
	panel_hovered: { $hover: 'blue' },
	panel: { background: 'white' },
};

test('an entry matches when its segments are a subsequence of the class list', () => {
	// `button_hovered` reaches an element themed button, primary, hovered even with a segment in
	// between, because gaps are allowed and order is not.
	assert.deepEqual(
		chainOf(defs, ['*', 'button', 'primary', 'hovered']),
		['*', 'button', 'hovered', 'button_hovered'],
	);
	// Order is enforced: hovered before button matches `hovered` and not `button_hovered`.
	assert.deepEqual(chainOf(defs, ['*', 'hovered', 'button']), ['*', 'hovered', 'button']);
	// Nothing that is not there matches.
	assert.deepEqual(chainOf(defs, ['*']), ['*']);
});

test('precedence is where the last segment matched, then the longer entry', () => {
	// `button` ends at index 1 and `hovered` at index 2, so `hovered` is later and wins; and
	// `button_hovered` also ends at 2 but is longer, so it wins over `hovered`.
	assert.deepEqual(chainOf(defs, ['*', 'button', 'hovered']), ['*', 'button', 'hovered', 'button_hovered']);
});

test('a variable is supplied by the most specific entry that defines it', () => {
	// `hovered` writes `$hover` once; `panel_hovered` supplies it. The generic entry reads the
	// specific one's value, which is the whole point of the feature.
	const chain = chainOf(defs, ['*', 'panel', 'hovered']);
	const out = compileChain(defs, chain, 'x');
	assert.equal(out.variables.get('hover'), 'blue');
	assert.ok(out.rules.includes('.x { outline: 1px solid blue; }'));
});

test('a size property gets px and everything else does not', () => {
	const out = compileChain({ a: { padding: 8, flexGrow: 1, zIndexNot: 2 } }, ['a'], 'x');
	assert.deepEqual(out.rules, ['.x { padding: 8px; flex-grow: 1; z-index-not: 2; }']);
});

const withFunctions = (variables: Record<string, string>): Lookup => ({
	variable: (name) => variables[name] ?? null,
	call: (name) => themeFunctions[`$${name}`] ?? null,
});

test('the value language reads names, calls, escapes and a name ended by a dollar', () => {
	const lookup = withFunctions({ size: '4', tone: '#ffffff' });
	assert.equal(resolve(parseValue('$size$px'), lookup), '4px');
	assert.equal(resolve(parseValue('$$5'), lookup), '$5');
	assert.equal(resolve(parseValue('$add(1, 2)'), lookup), '3');
	assert.equal(resolve(parseValue('$contrast_text($tone)'), lookup), 'rgb(0, 0, 0)');
	assert.equal(resolve(parseValue('$missing'), lookup), '');
	// An unknown function is left as it was written, so a CSS function survives.
	assert.equal(resolve(parseValue('$clamp(1rem, 2vw, 3rem)'), lookup), 'clamp(1rem, 2vw, 3rem)');
});

test('the colour reader takes every notation, and passes anything else through', () => {
	assert.equal(writeColour(readColour('#0af')!), 'rgb(0, 170, 255)');
	assert.equal(writeColour(readColour('#00aaff80')!), 'rgba(0, 170, 255, 0.502)');
	assert.equal(writeColour(readColour('rgb(1, 2, 3)')!), 'rgb(1, 2, 3)');
	assert.equal(writeColour(readColour('rgb(1 2 3 / 50%)')!), 'rgba(1, 2, 3, 0.5)');
	assert.equal(writeColour(readColour('hsl(0, 100%, 50%)')!), 'rgb(255, 0, 0)');
	assert.equal(writeColour(readColour('red')!), 'rgb(255, 0, 0)');
	assert.equal(readColour('currentColor'), null);
	// A function over something that is not a colour hands the value back untouched.
	assert.equal(resolve(parseValue('$alpha(currentColor, 0.5)'), withFunctions({})), 'currentColor');
});

test('extends applies what it extends first, and a leading star replaces the inherited list', () => {
	const chain = chainOf({ base: { color: 'red' }, card: { extends: 'base', padding: 4 } }, ['*', 'card']);
	assert.deepEqual(chain, ['base', 'card']);
});

test('a pseudo-class gets one colon and a pseudo-element gets two', () => {
	const out = compileChain({
		a: {
			_cssProp_focus: { outline: 'none' },
			_cssProp_before: { content: '""' },
			'_cssProp_:where(.x)': { color: 'red' },
		},
	}, ['a'], 'x');
	assert.deepEqual(out.rules, [
		'.x:focus { outline: none; }',
		'.x::before { content: ""; }',
		'.x:where(.x) { color: red; }',
	]);
});

test('a media directive wraps the entry body in the query', () => {
	const out = compileChain({ a: { '_media_(min-width: 40em)': { padding: 8 } } }, ['a'], 'x');
	assert.deepEqual(out.rules, ['@media (min-width: 40em) { .x { padding: 8px; } }']);
});

test('elem and children put the class on the right side of the selector', () => {
	const out = compileChain({ a: { _elem_button: { color: 'red' }, _children_span: { color: 'blue' } } }, ['a'], 'x');
	assert.deepEqual(out.rules, ['button .x { color: red; }', '.x > span { color: blue; }']);
});

test('a font face, a keyframe set and an import leave the entry body', () => {
	const font = { a: { _fontFace_body: { fontFamily: 'Inter', src: 'url(a.woff2)' } } };
	const out = compileChain(font, ['a'], 'x');
	// Nothing about the font is in the rule for the class, so recompiling the class cannot
	// re-emit the font and make a browser refetch it.
	assert.deepEqual(out.rules, []);
	assert.equal(out.atRules.length, 1);
	assert.match(out.atRules[0]!.css, /^@font-face \{ font-family: Inter; src: url\(a\.woff2\); \}$/);
});

test('two class chains reaching one font emit it once', () => {
	const sheet = createSheet();
	const theme = {
		'*': { _fontFace_body: { fontFamily: 'Inter', src: 'url(a.woff2)' } },
		a: { color: 'red' },
		b: { color: 'blue' },
	};
	sheet.classes(theme, ['a']);
	sheet.classes(theme, ['b']);
	const css = sheet.markup();
	assert.equal(css.split('@font-face').length - 1, 1, 'the font is emitted once, not once per chain');
});

test('a keyframe set is named after its definition and its name is a variable', () => {
	const theme = { spin: { _keyframes_turn: '0% { rotate: 0deg } 100% { rotate: 360deg }', animation: '$turn 1s' } };
	const out = compileChain(theme, ['spin'], 'x');
	const name = out.variables.get('turn')!;
	assert.match(name, /^turn-[0-9a-z]+$/);
	assert.deepEqual(out.rules, [`.x { animation: ${name} 1s; }`]);
	assert.equal(out.atRules[0]!.css, `@keyframes ${name} { 0% { rotate: 0deg } 100% { rotate: 360deg } }`);
});

test('an import is emitted, above the layer, naming the layer', () => {
	const sheet = createSheet();
	sheet.classes({ a: { _import_fonts: { url: 'https://example.test/f.css' }, color: 'red' } }, ['a']);
	const css = sheet.markup();
	assert.ok(css.startsWith('@import url("https://example.test/f.css") layer(aweft);'),
		'an import may not sit inside a layer block, so it goes above it');
});

test('every rule is inside the layer, and nothing is important', () => {
	const sheet = createSheet();
	sheet.classes({ a: { color: 'red' } }, ['a']);
	const css = sheet.markup();
	assert.match(css, /@layer aweft \{\n {2}\.aw0 \{ color: red; \}\n\}/);
	assert.doesNotMatch(css, /!important/);
});

test('a theme can replace a built-in function', () => {
	Theme.define({ flipped: { color: '$contrast_text(#ffffff)' } });
	const plain = createSheet();
	assert.match(
		plain.markup.call(plain) === '' ? (plain.classes(baseTheme(), ['flipped']), plain.markup()) : plain.markup(),
		/color: rgb\(0, 0, 0\)/,
	);

	const swapped = createSheet();
	const overridden = mergeTheme(baseTheme(), { '*': { $contrast_text: () => 'magenta' } });
	swapped.classes(overridden, ['flipped']);
	assert.match(swapped.markup(), /color: magenta/, 'a built-in is theme data and can be replaced');
});

test('the most specific entry in the chain wins for a variable and for a function', () => {
	// Two entries in one chain define the same `$name`. The one that matched later is the more
	// specific, and it is the one that supplies the value, which is what lets a generic entry write
	// `background: $hover` once and every component answer it.
	const theme = {
		'*': { $tone: 'red', $twice: (args: string[]) => String(Number(args[0]) * 2) },
		card: { $tone: 'blue', $twice: (args: string[]) => String(Number(args[0]) * 3), color: '$tone', width: '$twice(2)px' },
	};
	const out = compileChain(theme, chainOf(theme, ['*', 'card']), 'x');
	assert.equal(out.variables.get('tone'), 'blue', 'the specific entry supplies the variable');
	assert.deepEqual(out.rules, ['.x { color: blue; width: 6px; }'], 'and its function, not the generic one');
});

test('two themes that say the same thing get the same class, and two that do not do not', () => {
	Theme.define({ said: { color: 'red' } });
	const own = createSheet();
	const a = { said: { color: 'red' }, '*': { $ink: 'black' } };
	const b = { '*': { $ink: 'black' }, said: { color: 'red' } };
	// The same entries, written in another order, in another object.
	assert.equal(own.classes(a, ['said']), own.classes(b, ['said']));
	assert.notEqual(own.classes(a, ['said']), own.classes({ said: { color: 'blue' } }, ['said']));
});
