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

// The parts and the modifiers of one component, for the rule design 193 writes down.
const parts = {
	'*': {},
	card: { padding: '4px' },
	card_title: { fontWeight: 600 },
	card_title_muted: { opacity: 0.6 },
	card_tight: { padding: 0 },
	muted: { color: 'grey' },
};

test('a class token holding an underscore names that entry and not the one it starts with', () => {
	// `card_title` is a part: a different element from the component, which must not wear the
	// component's own layout. Naming it as one token reaches it and leaves `card` alone.
	assert.deepEqual(chainOf(parts, ['*', 'card_title']), ['*', 'card_title']);
	// And the component on its own still reaches only itself.
	assert.deepEqual(chainOf(parts, ['*', 'card']), ['*', 'card']);
});

test('a part token followed by a segment reaches the modifier of the part', () => {
	assert.deepEqual(chainOf(parts, ['*', 'card_title', 'muted']),
		['*', 'card_title', 'muted', 'card_title_muted']);
});

test('a plain segment list matches exactly as it did', () => {
	// A modifier is a state or a variant of the same element, and stays a segment of its own. This
	// is also the old spelling of a part, which still reaches both entries.
	assert.deepEqual(chainOf(parts, ['*', 'card', 'tight']), ['*', 'card', 'card_tight']);
	assert.deepEqual(chainOf(parts, ['*', 'card', 'title']), ['*', 'card', 'card_title']);
});

test('a part token and its component in one list reach both', () => {
	// A caller who wants the component's own rules on the part says both, in either order.
	assert.deepEqual(chainOf(parts, ['*', 'card_title', 'card']), ['*', 'card_title', 'card']);
	assert.deepEqual(chainOf(parts, ['*', 'card', 'card_title']), ['*', 'card', 'card_title']);
});

test('a token matches one segment of an entry, never the same one twice', () => {
	// The walk over an entry's segments runs from the far end for this reason: walked the other
	// way, the state a token has just reached is fed by the same token, so a class list of one
	// `dot` matches both segments of `dot_dot` and reaches an entry the element never named.
	const twice = { '*': {}, dot: { color: 'red' }, dot_dot: { color: 'blue' } };
	assert.deepEqual(chainOf(twice, ['*', 'dot']), ['*', 'dot']);
	// Two of them do reach it, because that is what the list actually says.
	assert.deepEqual(chainOf(twice, ['*', 'dot', 'dot']), ['*', 'dot', 'dot_dot']);
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

test('a starting-style directive wraps the entry body in @starting-style', () => {
	// The style an element is transitioned from on the frame it is first rendered. There is nothing
	// to write after the name, so a rest is read and ignored.
	const out = compileChain({ a: { _starting_: { opacity: 0 } } }, ['a'], 'x');
	assert.deepEqual(out.rules, ['@starting-style { .x { opacity: 0; } }']);
	const rested = compileChain({ a: { '_starting_anything': { opacity: 0 } } }, ['a'], 'x');
	assert.deepEqual(rested.rules, ['@starting-style { .x { opacity: 0; } }']);
});

test('a container directive wraps the entry body in the query', () => {
	const out = compileChain({ a: { '_container_(min-width: 28rem)': { padding: 8 } } }, ['a'], 'x');
	assert.deepEqual(out.rules, ['@container (min-width: 28rem) { .x { padding: 8px; } }']);
});

test('a list value is the property said once per item, in order', () => {
	// The CSS fallback idiom: a host that cannot read the later value drops that declaration and
	// keeps the one before it. An entry is an object, so this is the only way it can say a property
	// twice (design 190).
	const out = compileChain({ a: { appearance: ['none', 'base-select'], padding: [4, '$pad'], $pad: '2rem' } }, ['a'], 'x');
	assert.deepEqual(out.rules, ['.x { appearance: none; appearance: base-select; padding: 4px; padding: 2rem; }'],
		'each item goes through the size rule and the value language on its own');
});

test('a list inside a pseudo block emits both', () => {
	const out = compileChain({ a: { _cssProp_before: { appearance: ['none', 'base-select'] } } }, ['a'], 'x');
	assert.deepEqual(out.rules, ['.x::before { appearance: none; appearance: base-select; }']);
});

test('a query block holds a pseudo block and a starting style', () => {
	// One level of nesting, which is what a fading backdrop needs: the transition on
	// `.x::backdrop` has to stay inside the reduced-motion query (design 190, amended).
	const out = compileChain({
		a: {
			'_media_(prefers-reduced-motion: no-preference)': {
				transition: 'opacity 120ms',
				'_cssProp_::backdrop': { transition: 'opacity 120ms' },
				_starting_: { opacity: 0 },
			},
		},
	}, ['a'], 'x');
	assert.deepEqual(out.rules, [
		'@media (prefers-reduced-motion: no-preference) { .x { transition: opacity 120ms; } }',
		'@media (prefers-reduced-motion: no-preference) { .x::backdrop { transition: opacity 120ms; } }',
		'@media (prefers-reduced-motion: no-preference) { @starting-style { .x { opacity: 0; } } }',
	]);
});

test('a pseudo block holds a starting style', () => {
	const out = compileChain({
		a: { '_cssProp_::backdrop': { opacity: 1, _starting_: { opacity: 0 } } },
	}, ['a'], 'x');
	assert.deepEqual(out.rules, [
		'.x::backdrop { opacity: 1; }',
		'@starting-style { .x::backdrop { opacity: 0; } }',
	]);
});

test('a misspelled directive is refused, and the refusal lists the directives', () => {
	// It used to emit nothing at all: `_medai_(min-width: 10px)` compiled to no rule and said
	// nothing, so the entry looked right in the source and the query simply never applied.
	assert.throws(
		() => compileChain({ a: { '_medai_(min-width: 10px)': { padding: 8 } } }, ['a'], 'x'),
		/unknown directive `medai`.*elem, children, cssProp, media, container, starting, keyframes, fontFace, import/,
	);
	// Inside a directive block as well, which is where a typo is hardest to see.
	assert.throws(
		() => compileChain({ a: { '_media_(min-width: 10px)': { _cssPop_before: { padding: 8 } } } }, ['a'], 'x'),
		/unknown directive `cssPop`/,
	);
	// And the nine it names all compile.
	assert.doesNotThrow(() => compileChain({
		a: {
			_elem_div: { padding: 1 },
			_children_span: { padding: 1 },
			_cssProp_hover: { padding: 1 },
			'_media_(min-width: 1px)': { padding: 1 },
			'_container_(min-width: 1px)': { padding: 1 },
			_starting_: { opacity: 0 },
			_keyframes_spin: '0% { opacity: 0 }',
			_fontFace_body: { fontFamily: 'Inter' },
			_import_: 'a.css',
		},
	}, ['a'], 'x'));
});

test('a third level of directive compiles to nothing', () => {
	// The limit design 190 writes down now: two levels of wrapping, and the walk stops. Every
	// enclosing rule goes with it, because each of their bodies came out empty.
	const out = compileChain({
		a: {
			'_media_(min-width: 40em)': {
				'_cssProp_::backdrop': { _starting_: { opacity: 0 } },
			},
		},
	}, ['a'], 'x');
	assert.deepEqual(out.rules, []);
});

test('a font face inside a directive block is not a frame and emits nothing', () => {
	// `_keyframes_`, `_fontFace_` and `_import_` leave the entry body rather than wrapping this
	// rule, so nesting has nothing to say about them and they are read at the entry's own level.
	const out = compileChain({
		a: { '_media_(min-width: 40em)': { _fontFace_body: { fontFamily: 'Inter' } } },
	}, ['a'], 'x');
	assert.deepEqual(out.rules, []);
	assert.deepEqual(out.atRules, []);
});

test('two themes differing only in whether a value is a list get different classes', () => {
	const own = createSheet();
	const listed = own.classes({ said: { appearance: ['none', 'base-select'] } }, ['said']);
	const joined = own.classes({ said: { appearance: 'none,base-select' } }, ['said']);
	assert.notEqual(listed, joined, 'the content key tells a list from the string it stringifies to');
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
