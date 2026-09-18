// The theme check, against sources written here so the expected answers are fixed by this file.
//
// What the check does over the real tree is `npm run theme:check`; this states the rule, one
// planted mistake at a time, and the two shapes it must leave alone.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type ThemeSource, type ThemeViolation, checkTheme, themeTokens } from '../src/theme.ts';

const source = (text: string, path = 'page.tsx'): ThemeSource[] => [{ path, text }];

// One line per violation, written out here rather than borrowed from the script, so a change to
// the script's own format shows up there and not as a hundred lines of noise here. The format the
// script prints is asserted by the runs at the end of this file.
const line = (found: ThemeViolation): string =>
	`${found.path}:${String(found.line)}: ${found.where} sets ${found.property} to ${found.literal}; use ${found.fix}`;

const found = (text: string, path?: string): string[] =>
	checkTheme(source(text, path)).map(line);

test('a colour written in a theme entry fails, naming the role to use', () => {
	assert.deepEqual(
		found("Theme.define({ card: { background: '#ff0000' } });"),
		['page.tsx:1: card sets background to #ff0000; use $surface'],
	);
	assert.deepEqual(
		found("Theme.define({ card: { color: 'rgb(1, 2, 3)' } });"),
		['page.tsx:1: card sets color to rgb(; use $foreground'],
	);
	assert.deepEqual(
		found("Theme.define({ card: { borderColor: 'white' } });"),
		['page.tsx:1: card sets borderColor to white; use $border'],
	);
});

test('a size written in a theme entry fails, naming the size to use', () => {
	assert.deepEqual(
		found("Theme.define({ card: { padding: '12px' } });"),
		['page.tsx:1: card sets padding to 12px; use $space'],
	);
	assert.deepEqual(
		found("Theme.define({ card: { borderRadius: '0.5rem' } });"),
		['page.tsx:1: card sets borderRadius to 0.5rem; use $radius'],
	);
	// The bare number a size property turns into pixels is a size written where it stands too.
	assert.deepEqual(
		found('Theme.define({ card: { padding: 12 } });'),
		['page.tsx:1: card sets padding to 12; use $space'],
	);
});

test('a duration written in a theme entry fails', () => {
	assert.deepEqual(
		found("Theme.define({ card: { transitionDuration: '150ms' } });"),
		['page.tsx:1: card sets transitionDuration to 150ms; use $fast'],
	);
});

test('an outline turned off with no ring beside it fails', () => {
	assert.deepEqual(
		found("Theme.define({ card: { _cssProp_focus: { outline: 'none' } } });"),
		['page.tsx:1: card sets outline to none; use $ring'],
	);
	// The same entry putting a ring back is the shape that is allowed.
	assert.deepEqual(
		found("Theme.define({ card: { _cssProp_focus: { outline: 'none', boxShadow: '0 0 0 $ringWidth $ring' } } });"),
		[],
	);
});

test('a value given a name is a definition, and its literal is where a literal belongs', () => {
	assert.deepEqual(
		found("Theme.define({ '*': { $brand: '#ff0000', $pad: '12px', $slow: '400ms' }, card: { padding: '$pad' } });"),
		[],
	);
});

test('a theme handed to a Theme provider is a page\'s own and is left alone', () => {
	assert.deepEqual(found("const page = <Theme value={{ card: { background: '#ff0000' } }}><App /></Theme>;"), []);
	assert.deepEqual(found("h(Theme, { value: { card: { background: '#ff0000' } } }, app);", 'page.ts'), []);
	// The exemption has to be the whole value: an application is free to name an entry `style`,
	// and that entry is a theme entry rather than the `style` of an element.
	assert.deepEqual(found("const p = <Theme value={{ style: { padding: '12px' } }} />;"), []);
	assert.deepEqual(found("h(Theme, { value: { style: { padding: '12px' } } });", 'page.ts'), []);

	// And the same literal one line outside the provider still fails, so the exemption is the
	// value and not the file.
	assert.deepEqual(
		found("Theme.define({ card: { background: '#ff0000' } });\nconst p = <Theme value={{ card: { color: 'red' } }} />;"),
		['page.tsx:1: card sets background to #ff0000; use $surface'],
	);
});

test('a style written on an element is read, in either spelling', () => {
	assert.deepEqual(
		found("const a = <div style={{ padding: '12px' }} />;"),
		['page.tsx:1: style sets padding to 12px; use $space'],
	);
	assert.deepEqual(
		found("const a = h('div', { style: { color: '#ff0000' } });", 'page.ts'),
		['page.ts:1: style sets color to #ff0000; use $foreground'],
	);
});

test('a string that is not in a CSS position is not read', () => {
	assert.deepEqual(found("const id = '#ff0000';\nconst wait = '150ms';", 'page.ts'), []);
	assert.deepEqual(found("const gap = { padding: '12px' };", 'page.ts'), [], 'an object that is not a style');
});

test('zero, a keyword and a percentage are not design values', () => {
	assert.deepEqual(
		found("Theme.define({ card: { margin: 0, padding: '0px', background: 'transparent', color: 'currentColor', width: '100%' } });"),
		[],
	);
});

test('a bare lineHeight is a multiplier, not a size; one with a unit on it still is', () => {
	// The copy of `sizeProperties` here drops the name `ui` dropped (design 292).
	assert.deepEqual(found('Theme.define({ card: { lineHeight: 1.45 } });'), []);
	assert.deepEqual(
		found("Theme.define({ card: { lineHeight: '24px' } });"),
		['page.tsx:1: card sets lineHeight to 24px; use $textMdLine'],
	);
});

test('the nested blocks of an entry are read, and extends is not', () => {
	assert.deepEqual(
		found("Theme.define({ card: { extends: 'panel', '_media_(min-width: 40em)': { padding: '12px' } } });"),
		['page.tsx:1: card sets padding to 12px; use $space'],
	);
});

test('a value written inside a list is a value written where it stands', () => {
	// A list is the declaration written once per item (design 190), so every item sits in a CSS
	// position. Read as one value the whole list was skipped, and `padding: ['13px', '13px']`
	// passed a check that refuses `padding: '13px'`.
	assert.deepEqual(
		found("defineTheme({\n\tplain: { padding: '13px', color: '#ff0000' },\n"
			+ "\tlisted: { padding: ['13px', '13px'], color: ['#ff0000', 'red'] },\n"
			+ "\tnumbered: { padding: [13, 13] },\n});", 'page.ts'),
		[
			'page.ts:2: plain sets padding to 13px; use $space',
			'page.ts:2: plain sets color to #ff0000; use $foreground',
			'page.ts:3: listed sets padding to 13px; use $space',
			'page.ts:3: listed sets padding to 13px; use $space',
			'page.ts:3: listed sets color to #ff0000; use $foreground',
			'page.ts:3: listed sets color to red; use $foreground',
			'page.ts:4: numbered sets padding to 13; use $space',
			'page.ts:4: numbered sets padding to 13; use $space',
		],
	);
	// And the named values in a list are still definitions, so the fallback idiom itself passes.
	assert.deepEqual(found("defineTheme({ select: { appearance: ['none', 'base-select'] } });"), []);
});

test('a segment of an entry may not be the name of an entry that lays an element out', () => {
	// A class list is matched segment by segment, so `['button', 'icon']` reaches `button_icon`
	// and the bare `icon` entry as well: the button took `display: inline-block; width: 1em` and
	// stopped centring its label (measured in Chromium).
	assert.deepEqual(
		found("defineTheme({\n\ticon: { display: 'inline-block', width: '$iconSize' },\n"
			+ "\tbutton: { display: 'inline-flex' },\n\tbutton_icon: { width: '$control' },\n});", 'page.ts'),
		['page.ts:4: button_icon sets the segment icon to the name of the entry icon; '
			+ 'use a segment no entry names'],
	);
	// The segment the square button uses instead names nothing.
	assert.deepEqual(
		found("defineTheme({\n\ticon: { display: 'inline-block' },\n"
			+ "\tbutton_square: { width: '$control' },\n});", 'page.ts'),
		[],
	);
	// A state entry paints and lays nothing out, which is what a modifier is meant to compose
	// with: `disclosure_summary_disabled` rides on `disabled` on purpose.
	assert.deepEqual(
		found("defineTheme({\n\tdisabled: { opacity: 0.5, cursor: 'not-allowed' },\n"
			+ "\tdisclosure_summary_disabled: { pointerEvents: 'none' },\n});", 'page.ts'),
		[],
	);
	// One file at a time: two pages of one tree are two themes, and neither knows the other's
	// entry names (limit 4).
	assert.deepEqual(
		checkTheme([
			{ path: 'a.ts', text: "defineTheme({ group: { display: 'flex' } });" },
			{ path: 'b.ts', text: "defineTheme({ field_group: { display: 'flex' } });" },
		]),
		[],
	);
});

test('the fix names the role the property calls for', () => {
	const suggestions = (text: string): string[] =>
		checkTheme(source(text)).map((violation) => violation.fix);

	assert.deepEqual(
		suggestions("Theme.define({ a: { outlineWidth: '3px', minWidth: '4px', fontSize: '2rem', lineHeight: '3rem', minHeight: '40px', borderWidth: '2px', outline: 'red' } });"),
		['$ringWidth', '$target', '$textMd', '$textMdLine', '$control', '$borderWidth', '$ring'],
	);
});

test('every name a source defines, once, sorted', () => {
	const text = "Theme.define({ '*': { $neutral2: 'a', $accent1: 'b', $neutral1: 'c' } });\n"
		+ "const more = { $neutral1: 'c', $ring: 'd' };\n";
	assert.deepEqual(themeTokens(source(text, 'page.ts')), ['accent1', 'neutral1', 'neutral2', 'ring']);
});

test('a name added to the source is a name added to the snapshot', () => {
	const before = themeTokens(source("const t = { $ring: 'a' };", 'page.ts'));
	const after = themeTokens(source("const t = { $ring: 'a', $ringWidth: 'b' };", 'page.ts'));
	assert.deepEqual(before, ['ring']);
	assert.deepEqual(after, ['ring', 'ringWidth']);
	assert.notDeepEqual(before, after, 'which is what makes the committed file a diff in review');
});

// The gate script itself, run the way an application would run it: `node <script> <path>`. The
// three answers it has to get right are a violation, a path with nothing in it, and a clean pass.
const script = new URL('../scripts/check-theme.ts', import.meta.url).pathname;

const dirHolding = (name: string, text: string): string => {
	const dir = mkdtempSync(join(tmpdir(), 'aweft-theme-'));
	writeFileSync(join(dir, name), text);
	return dir;
};

const runOn = (path: string): { code: number | null; out: string; err: string } => {
	const done = spawnSync(process.execPath, [script, path], { encoding: 'utf8' });
	return { code: done.status, out: done.stdout, err: done.stderr };
};

test('the script reads an absolute path, and reports what it finds there', () => {
	const dir = dirHolding('page.tsx', "Theme.define({ card: { background: '#ff0000' } });\n");
	try {
		const run = runOn(dir);
		assert.equal(run.code, 1, run.err);
		assert.match(run.err, /page\.tsx:1: card sets background to #ff0000; use \$surface/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('the script fails on a path that holds nothing, naming the path', () => {
	// Scanning nothing used to print that every value was named and exit 0, so a typo in the
	// path read as a pass.
	const run = runOn('/nonexistent/aweft-theme-check');
	assert.notEqual(run.code, 0, 'a path with no source in it is not a pass');
	assert.match(run.err, /\/nonexistent\/aweft-theme-check/);
	assert.doesNotMatch(run.out, /every value named/);
});

test('the script passes source that names every value, and says how much it read', () => {
	const dir = dirHolding('page.tsx', "Theme.define({ card: { $pad: '12px', padding: '$pad' } });\n");
	try {
		const run = runOn(dir);
		assert.equal(run.code, 0, run.err);
		assert.match(run.out, /1 files, every value named/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
