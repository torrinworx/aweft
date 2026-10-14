// A light and dark mode the visitor picks once and keeps (design 315), over a page object of the
// test's own: the parts of `document`, `localStorage` and `matchMedia` the cell reads and writes.

import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { dark, light, savedMode } from '@aweftjs/ui';
import type { Definitions } from '@aweftjs/ui';

interface Meta { readonly attributes: Record<string, string>; setAttribute(name: string, value: string): void }

const metaOf = (): Meta => {
	const attributes: Record<string, string> = {};
	return { attributes, setAttribute: (name, value) => { attributes[name] = value; } };
};

/** A page with the given storage and system preference, put on `globalThis` for one test. */
const pageWith = (options: { saved?: Record<string, string>; prefersDark?: boolean; meta?: boolean; throws?: boolean } = {}) => {
	const saved = new Map(Object.entries(options.saved ?? {}));
	const style = { colorScheme: '', backgroundColor: '' };
	const head: Meta[] = options.meta === true ? [(() => { const meta = metaOf(); meta.setAttribute('name', 'theme-color'); return meta; })()] : [];
	const global = globalThis as Record<string, unknown>;
	global['document'] = {
		documentElement: { style },
		head: { appendChild: (node: Meta) => { head.push(node); } },
		querySelector: (selector: string) => (selector === 'meta[name="theme-color"]' ? head.find((meta) => meta.attributes['name'] === 'theme-color') ?? null : null),
		createElement: (tag: string) => { assert.equal(tag, 'meta'); return metaOf(); },
	};
	const storage = {
		getItem: (key: string) => { if (options.throws === true) throw new Error('the storage is blocked'); return saved.get(key) ?? null; },
		setItem: (key: string, value: string) => { if (options.throws === true) throw new Error('the storage is full'); saved.set(key, value); },
	};
	Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
	global['matchMedia'] = (query: string) => ({ matches: query === '(prefers-color-scheme: dark)' && options.prefersDark === true });
	return { saved, style, head };
};

afterEach(() => {
	const global = globalThis as Record<string, unknown>;
	delete global['document'];
	delete global['matchMedia'];
	Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true, writable: true });
});

const backgroundOf = (mode: Definitions): unknown => mode['*']?.['$background'];
const word = (mode: unknown): string => (mode === dark ? 'dark' : mode === light ? 'light' : 'neither');

test('it starts in light, the mode a server renders, whatever is saved, and paints the root from the first value', () => {
	const { style, head } = pageWith({ saved: { mode: 'dark' }, prefersDark: true });
	const mode = savedMode();
	assert.equal(mode.get(), light);
	assert.equal(style.colorScheme, 'light');
	assert.equal(style.backgroundColor, backgroundOf(light));
	assert.equal(head.length, 1, 'a head with no theme-color meta is given one');
	assert.deepEqual(head[0]!.attributes, { name: 'theme-color', content: backgroundOf(light) });
});

test('restore moves to the saved choice, and saves nothing', () => {
	const { saved, style, head } = pageWith({ saved: { mode: 'dark' }, meta: true });
	const mode = savedMode();
	mode.restore();
	assert.equal(mode.get(), dark);
	assert.equal(style.colorScheme, 'dark');
	assert.equal(style.backgroundColor, backgroundOf(dark));
	assert.equal(head.length, 1, 'the meta the head already had is the one written');
	assert.equal(head[0]!.attributes['content'], backgroundOf(dark));
	assert.deepEqual([...saved], [['mode', 'dark']]);
});

test('with nothing saved, restore takes the fallback, and system reads prefers-color-scheme', () => {
	const cases: [Parameters<typeof savedMode>[0], boolean, string][] = [
		[{}, true, 'light'],
		[{ fallback: 'light' }, true, 'light'],
		[{ fallback: 'dark' }, false, 'dark'],
		[{ fallback: 'system' }, true, 'dark'],
		[{ fallback: 'system' }, false, 'light'],
	];
	for (const [options, prefersDark, expected] of cases) {
		const { saved } = pageWith({ prefersDark });
		const mode = savedMode(options);
		mode.restore();
		assert.equal(word(mode.get()), expected, `${JSON.stringify(options)} with the system ${prefersDark ? 'dark' : 'light'}`);
		assert.equal(saved.size, 0, 'a fallback is not a choice, so nothing is saved');
	}
});

test('a word saved that is neither light nor dark is not a choice', () => {
	pageWith({ saved: { mode: 'sepia' }, prefersDark: true });
	const mode = savedMode({ fallback: 'system' });
	mode.restore();
	assert.equal(mode.get(), dark);
});

test('a set is the visitor\'s choice: it is saved under the key, and a watcher hears it', () => {
	const { saved, style } = pageWith();
	const mode = savedMode({ key: 'site.mode' });
	const heard: string[] = [];
	mode.watch((now) => heard.push(word(now)));
	mode.set(dark);
	assert.deepEqual([...saved], [['site.mode', 'dark']]);
	assert.equal(style.colorScheme, 'dark');
	mode.set(light);
	assert.deepEqual([...saved], [['site.mode', 'light']]);
	assert.deepEqual(heard, ['dark', 'light']);
});

test('themes of the application\'s own are the two it holds, and a third is refused', () => {
	const mine = { '*': { $background: '#fefefe' } };
	const night = { '*': { $background: '#010101' } };
	const { style, saved } = pageWith({ saved: { mode: 'dark' } });
	const mode = savedMode({ light: mine, dark: night });
	assert.equal(mode.get(), mine);
	mode.restore();
	assert.equal(mode.get(), night);
	assert.equal(style.backgroundColor, '#010101');
	assert.throws(() => { mode.set(dark as typeof night); }, /set it to the light or the dark one it was given/);
	assert.equal(mode.get(), night, 'the refused theme was not taken');
	assert.deepEqual([...saved], [['mode', 'dark']]);
});

test('a mode with no $background paints the scheme and leaves the colour and the meta alone', () => {
	const { style, head } = pageWith({ meta: true });
	head[0]!.setAttribute('content', '#123456');
	savedMode({ light: { '*': {} }, dark: { '*': {} } });
	assert.equal(style.colorScheme, 'light');
	assert.equal(style.backgroundColor, '');
	assert.equal(head[0]!.attributes['content'], '#123456');
});

test('a storage that throws reads nothing saved and saves nothing, and the mode still moves', () => {
	const { style } = pageWith({ throws: true });
	const mode = savedMode({ fallback: 'dark' });
	mode.restore();
	assert.equal(mode.get(), dark);
	mode.set(light);
	assert.equal(mode.get(), light);
	assert.equal(style.colorScheme, 'light');
});

test('with no document it is a plain cell: it paints, reads and saves nothing', () => {
	const saved = new Map<string, string>([['mode', 'dark']]);
	Object.defineProperty(globalThis, 'localStorage', {
		value: { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => { saved.set(key, value); } },
		configurable: true, writable: true,
	});
	(globalThis as Record<string, unknown>)['matchMedia'] = () => ({ matches: true });
	const mode = savedMode({ fallback: 'system' });
	mode.restore();
	assert.equal(mode.get(), light, 'nothing saved was read, and the system was not asked');
	mode.set(dark);
	assert.equal(mode.get(), dark);
	assert.deepEqual([...saved], [['mode', 'dark']], 'and nothing was written over it');
	saved.set('mode', 'light');
	mode.set(dark);
	assert.deepEqual([...saved], [['mode', 'light']]);
});

test('a second savedMode on one page is loud, because both would paint the root', () => {
	pageWith();
	savedMode();
	assert.throws(() => savedMode(), /made once per page/);
});

test('a fallback that is not one of the three words is loud', () => {
	pageWith();
	assert.throws(() => savedMode({ fallback: 'auto' as 'system' }), /'light', 'dark' or 'system'/);
});
