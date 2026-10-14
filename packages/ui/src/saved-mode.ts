// A light and dark mode the visitor picks once and keeps (design 315).
//
// Every page entry wrote this by hand: a key in storage, a fallback, and the parts of the page no
// theme entry reaches, the root and the colour a phone paints its bar in.

import { type Cell, mutable } from '@aweftjs/core';

import { assert } from './assert.ts';
import { dark as darkMode, light as lightMode } from './modes.ts';
import type { Definitions } from './sheet.ts';

/** What `savedMode` may be told. Every field has a default. */
export interface SavedModeOptions<M extends Definitions> {
	/** The light theme. Defaults to the one this package ships. */
	readonly light?: M;
	/** The dark theme. Defaults to the one this package ships. */
	readonly dark?: M;
	/** The `localStorage` key the choice is saved under. Defaults to `'mode'`. */
	readonly key?: string;
	/** What a visitor who never chose gets on `restore()`: `'system'` reads `prefers-color-scheme`. Defaults to `'light'`. */
	readonly fallback?: 'light' | 'dark' | 'system';
}

/** The cell `savedMode` returns: one of its two themes, and the call that moves it to the visitor's. */
export interface SavedMode<M extends Definitions> extends Cell<M> {
	/**
	 * Move to the visitor's mode: the one they chose last, or the fallback. Saves nothing.
	 *
	 * Params: none.
	 *
	 * Returns: nothing.
	 *
	 * Example:
	 *   hydrate(document.body, <Site mode={mode} />);
	 *   mode.restore();
	 */
	restore(): void;
}

/** The parts of a page this reads and writes, as a browser has them. */
interface PageLike {
	readonly document?: {
		readonly documentElement: { readonly style: { colorScheme: string; backgroundColor: string } };
		readonly head: { appendChild(node: unknown): unknown };
		querySelector(selector: string): { setAttribute(name: string, value: string): void } | null;
		createElement(tag: string): { setAttribute(name: string, value: string): void };
	};
	readonly localStorage?: { getItem(key: string): string | null; setItem(key: string, value: string): void };
	matchMedia?(query: string): { readonly matches: boolean };
}

const page = globalThis as PageLike;

/** The documents a `savedMode` paints, filled inside an assert, so a release build keeps none. */
const painting = new WeakSet<object>();

/**
 * A cell holding a light or a dark theme, which a page hands its root `Theme`, saved when the
 * visitor picks one.
 *
 * Params:
 *   options.light, options.dark: the two themes, this package's `light` and `dark` unless given
 *   options.key: the `localStorage` key, `'mode'` unless given
 *   options.fallback: what `restore()` gives a visitor who never chose, `'light'`, `'dark'` or
 *                     `'system'`, and `'light'` unless given
 *
 * Returns: the cell, holding `light`, the mode a server renders. `restore()` moves it to the
 * visitor's mode and saves nothing. A set is the visitor's choice and is saved as `light` or
 * `dark`. On every value, from the first, it paints what no theme entry reaches: the root
 * element's `color-scheme`, its `background-color` from the mode's `$background`, and the
 * `content` of `<meta name="theme-color">`, which it adds to the head when there is none. Where
 * there is no `document`, as in a render on a server, it paints, reads and saves nothing. A
 * storage that throws saves nothing and reads nothing saved.
 *
 * Throws: the assert for a `fallback` that is not one of the three words, for a second one made
 * on a page that has one, and, on `set`, for a value that is neither of its two themes.
 *
 * Example:
 *   const mode = savedMode({ light, dark, fallback: 'system' });
 *   hydrate(document.body, <Theme value={mode}><Site /></Theme>);
 *   mode.restore();
 *   const toggle = () => mode.set(mode.get() === dark ? light : dark);
 */
export const savedMode = <M extends Definitions = Definitions>(options: SavedModeOptions<M> = {}): SavedMode<M> => {
	const light = options.light ?? lightMode as M;
	const dark = options.dark ?? darkMode as M;
	const key = options.key ?? 'mode';
	const fallback = options.fallback ?? 'light';
	assert(fallback === 'light' || fallback === 'dark' || fallback === 'system',
		`savedMode's fallback is 'light', 'dark' or 'system', and this one is ${JSON.stringify(fallback)}`);

	const held = mutable<M>(light);
	const document = page.document;
	// Each one sets the root's colours on every change for as long as the page is open. A second
	// one would overwrite the first one's colours each time it changed.
	assert(document === undefined || (!painting.has(document) && Boolean(painting.add(document))),
		'savedMode is made once per page, and this page has one; hand that one to whatever needs the mode');

	const saved = (): string | null => {
		if (document === undefined) return null;
		try {
			return page.localStorage?.getItem(key) ?? null;
		} catch {
			return null;
		}
	};

	const save = (word: string): void => {
		if (document === undefined) return;
		try {
			page.localStorage?.setItem(key, word);
		} catch {
			// A private window keeps nothing, and the page goes on in the mode it was set to.
		}
	};

	const paint = (mode: M): void => {
		if (document === undefined) return;
		const background = mode['*']?.['$background'];
		const colour = typeof background === 'string' ? background : '';
		document.documentElement.style.colorScheme = mode === dark ? 'dark' : 'light';
		document.documentElement.style.backgroundColor = colour;
		if (colour === '') return;
		let meta = document.querySelector('meta[name="theme-color"]');
		if (meta === null) {
			meta = document.createElement('meta');
			meta.setAttribute('name', 'theme-color');
			document.head.appendChild(meta);
		}
		meta.setAttribute('content', colour);
	};

	held.effect(paint);

	const chosen = held.setter((next) => {
		assert(next === light || next === dark,
			'savedMode holds one of its two themes; set it to the light or the dark one it was given');
		held.set(next);
		save(next === dark ? 'dark' : 'light');
	});

	return Object.assign(chosen, {
		restore: (): void => {
			const word = saved();
			if (word === 'dark' || word === 'light') {
				held.set(word === 'dark' ? dark : light);
				return;
			}
			const system = fallback === 'system' && document !== undefined && page.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
			held.set(fallback === 'dark' || system ? dark : light);
		},
	}) as SavedMode<M>;
};
