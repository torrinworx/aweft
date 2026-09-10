// The country and subdivision fields, in the light tree: what they render, what a screen reader
// would call them, what the search matches, and what order the rows come in.
//
// The data these read is the real one: `country-region-data` is a devDependency here, so the suite
// runs over 249 countries rather than a fixture that agrees with whatever the code does. What only
// a browser can answer, which is the dialog actually opening and the grid actually laying out, is in
// `browser.test.ts`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import { mutable } from '@aweftjs/core';
import { createDocument } from '@aweftjs/dom';
import type { ElementLike, LightElement, NodeLike } from '@aweftjs/dom';
import { Countries, Country, Icons, Region, flagOf, h, localeRegion, mount } from '@aweftjs/ui';
import { countryAliases, countryData } from '@aweftjs/ui/countries';
import type { CountryData } from '@aweftjs/ui/countries';

import { testIcons } from './fixtures/icons.ts';

const data = await countryData();

/** Every element in the tree, in document order. */
const elements = (node: NodeLike | null): LightElement[] => {
	const found: LightElement[] = [];
	for (let n = node; n !== null; n = n.nextSibling) {
		if (n.nodeType === 1) found.push(n as unknown as LightElement);
		found.push(...elements(n.firstChild));
	}
	return found;
};

const byRole = (root: NodeLike | null, role: string): LightElement[] =>
	elements(root).filter((element) => element.getAttribute('role') === role);

const byTag = (root: NodeLike | null, tag: string): LightElement[] =>
	elements(root).filter((element) => element.localName === tag);

const one = (root: NodeLike | null, role: string): LightElement => {
	const found = byRole(root, role);
	assert.equal(found.length, 1, `one ${role}, found ${String(found.length)}`);
	return found[0]!;
};

const fire = (element: LightElement, type: string, extra: Record<string, unknown> = {}): void => {
	(element as unknown as { dispatchEvent(event: unknown): boolean })
		.dispatchEvent({ type, target: element, ...extra });
};

// The pages here answer the icon names the dialog asks for, because `Icons` starts empty and a name
// nothing answers asserts (design 144).
const page = (item: unknown, value: CountryData | null = data): { body: ElementLike; stop: () => void } => {
	const document = createDocument();
	const stop = mount(document.body, h(Icons as never, { value: testIcons },
		h(Countries as never, { value }, item)));
	return { body: document.body, stop: () => { stop(); } };
};

/**
 * What one grid holds now, as the name on each row: the flag comes off the front and the code off
 * the back, so a row reads as the one word the test is about.
 */
const rows = (root: NodeLike | null): string[] =>
	byRole(root, 'option').map((row) => String(row.textContent ?? '')
		.replace(/^[^\p{Letter}]+/u, '').replace(/[A-Z]{2}$/, ''));

/** The dialog of the field with this id. */
const dialogOf = (body: ElementLike, id: string): LightElement => byId(body.firstChild, `${id}-dialog`);

/** The element with this id, which is what a field's own `id` prop puts on its button. */
const byId = (root: NodeLike | null, id: string): LightElement => {
	const found = elements(root).find((element) => element.getAttribute('id') === id);
	assert.ok(found !== undefined, `no element with id ${id}`);
	return found;
};

/** Open the dialog the way a person does, and hand back the search box the keys arrive at. */
const open = (body: ElementLike, id: string): LightElement => {
	fire(byId(body.firstChild, id), 'click');
	return byId(body.firstChild, `${id}-search`);
};

/** A key on the search box, which is where the focus is while the dialog is open. */
const press = (box: LightElement, key: string): void => {
	(box as unknown as { dispatchEvent(event: unknown): boolean }).dispatchEvent({
		type: 'keydown', key, target: box, preventDefault: () => undefined,
	});
};

/** Type into the search box, the way an input event does. */
const search = (body: ElementLike, text: string): void => {
	const box = byTag(body.firstChild, 'input')[0]!;
	(box as unknown as Record<string, unknown>)['value'] = text;
	fire(box, 'input', { target: box });
};

// --- the data ----------------------------------------------------------------------------------

test('the data has every country, with its subdivisions and no names of its own', () => {
	assert.equal(data.codes.length, 249, 'every territory the standard lists');
	assert.ok(data.codes.every((code) => /^[A-Z]{2}$/.test(code)), 'each one a two-letter code');
	assert.equal(new Set(data.codes).size, data.codes.length, 'and each one once');

	// The counts a dropdown would have to answer for. These are why the subdivision field is the
	// same searched dialog as the country field (design 251).
	assert.equal(data.regions('GB').length, 217, 'the longest subdivision list there is');
	assert.equal(data.regions('US').length, 62);
	assert.equal(data.regions('CA').length, 13);
	const counts = data.codes.map((code) => data.regions(code).length).sort((a, b) => a - b);
	const median = counts[Math.floor(counts.length / 2)]!;
	assert.equal(median, 11, 'and the middle country has eleven');
	assert.equal(counts.filter((held) => held > 20).length, 59, 'and 59 countries are over twenty');

	assert.deepEqual(data.regions('CA').find((region) => region.code === 'ON'),
		{ name: 'Ontario', code: 'ON' });
	assert.deepEqual(data.regions('ZZ'), [], 'a code the data has nothing for is empty, not a throw');
});

test('the host names every code the data has, and its own names are not those names', () => {
	const display = new Intl.DisplayNames(['en'], { type: 'region' });
	const named = data.codes.filter((code) => (display.of(code) ?? code) !== code);
	assert.equal(named.length, data.codes.length, 'the host has a name for all 249');

	// Why the names come from the host and not from the data (design 251): the data's own names are
	// the formal ones, and a person types the common one.
	assert.equal(display.of('KR'), 'South Korea');
	assert.equal(display.of('RU'), 'Russia');
	assert.equal(display.of('CI'), 'Côte d’Ivoire');
	assert.equal(display.of('FR'), 'France');
	assert.equal(new Intl.DisplayNames(['fr'], { type: 'region' }).of('DE'), 'Allemagne',
		'and it has them in every language the host knows');
});

test('the alias table is small, lowercase, and only for codes the data has', () => {
	const size = new TextEncoder().encode(JSON.stringify(countryAliases)).length;
	assert.ok(size < 4096, `the aliases are ${String(size)} bytes`);
	console.log(`country aliases: ${String(size)} bytes over ${String(Object.keys(countryAliases).length)} codes`);

	const codes = new Set(data.codes);
	for (const [code, words] of Object.entries(countryAliases)) {
		assert.equal(code, code.toLowerCase(), `${code} is keyed lowercase`);
		assert.ok(codes.has(code.toUpperCase()), `${code} is a code the data has`);
		for (const word of words) assert.equal(word, word.toLowerCase(), `${word} is lowercase`);
	}
});

test('a load that fails refuses with the install command, and a load of your own is read', async () => {
	await assert.rejects(
		() => countryData(() => Promise.reject(new Error('no'))),
		(error: Error & { reason?: string; fix?: string }) => {
			assert.equal(error.reason, 'countries-not-installed');
			assert.match(error.message, /npm install country-region-data/);
			assert.match(String(error.fix), /hand your own CountryData/);
			return true;
		});

	await assert.rejects(
		() => countryData(() => Promise.resolve({ nothing: true })),
		(error: Error & { reason?: string }) => {
			assert.equal(error.reason, 'countries-unreadable');
			return true;
		});

	const own = await countryData(() => Promise.resolve({
		allCountries: [['Wonderland', 'wl', [['The Garden', 'GD']]]],
	}));
	assert.deepEqual(own.codes, ['WL'], 'a code arrives upper case whatever case it was written in');
	assert.deepEqual(own.regions('wl'), [{ name: 'The Garden', code: 'GD' }]);
});

test('the root entry reaches none of this: not the subpath, not the peer, not the aliases', async () => {
	// Design 140's rule, read off a real bundle rather than off the import lines: an application
	// that imports `@aweftjs/ui` and never asks for a country field must not carry the data, and a
	// bundler must never have to resolve the optional peer to build it.
	const { build } = await import('vite');
	const { aweft } = await import('@aweftjs/build');
	const out = await build({
		root: fileURLToPath(new URL('../../../', import.meta.url)),
		logLevel: 'error',
		plugins: [aweft()],
		build: {
			write: false,
			lib: {
				entry: fileURLToPath(new URL('../src/index.ts', import.meta.url)),
				formats: ['es'],
				fileName: 'ui',
			},
		},
	});
	const chunks = (Array.isArray(out) ? out[0] : out) as { output: { fileName: string; code?: string; modules?: Record<string, unknown> }[] };
	const modules = chunks.output.flatMap((chunk) => Object.keys(chunk.modules ?? {}));
	const code = chunks.output.map((chunk) => chunk.code ?? '').join('');

	assert.equal(modules.some((name) => name.endsWith('src/countries.ts')), false,
		'the data subpath is not in the root entry\'s graph');
	assert.equal(modules.some((name) => name.includes('country-region-data')), false,
		'and neither is the peer, so a bundler never resolves it for an application that wants none');
	assert.equal(code.includes('holland'), false, 'the aliases are not in the bundle either');
	assert.equal(chunks.output.length, 1,
		`and there is no lazy chunk holding them: ${chunks.output.map((chunk) => chunk.fileName).join(', ')}`);
});

// --- flags and the guess -----------------------------------------------------------------------

test('a flag is the two letters as regional indicators, and nothing else is a flag', () => {
	assert.equal(flagOf('CA'), '\u{1F1E8}\u{1F1E6}');
	assert.equal(flagOf('ca'), flagOf('CA'), 'either case');
	assert.equal(flagOf('C'), '', 'one letter is not a country');
	assert.equal(flagOf('CAN'), '');
	assert.equal(flagOf('C1'), '');
	assert.equal(flagOf(''), '');
	// Every code the data has draws two symbols, so no row in the grid is a pair of empty boxes.
	assert.ok(data.codes.every((code) => [...flagOf(code)].length === 2));
});

test('flags false draws no flag, on the button or in the grid', () => {
	const country = mutable<unknown>('CA');
	const { body, stop } = page(h(Country as never, {
		id: 'country', label: 'Country', value: country, flags: false, suggest: false, locale: 'en',
	}));
	open(body, 'country');
	const shown = String(byId(body.firstChild, 'country').textContent);
	assert.match(shown, /Canada/);
	assert.doesNotMatch(shown, /\p{Regional_Indicator}/u, 'and no flag beside it');
	assert.doesNotMatch(String(dialogOf(body, 'country').textContent), /\p{Regional_Indicator}/u,
		'nor in any of the 249 rows');
	stop();
});

test('the guess reads the language settings and never the location', () => {
	const held = (globalThis as { navigator?: unknown }).navigator;
	const set = (languages: readonly string[] | undefined, language?: string): void => {
		Object.defineProperty(globalThis, 'navigator', {
			value: languages === undefined ? { language } : { languages, language },
			configurable: true,
		});
	};

	try {
		set(['en-CA', 'fr-CA']);
		assert.equal(localeRegion(), 'CA', 'the region in the tag');
		set(['fr']);
		assert.equal(localeRegion(), 'FR', 'a language with no region is maximized by the host');
		set(['pt']);
		assert.equal(localeRegion(), 'BR', 'which is the host\'s likely-region data, not a table here');
		set(['not a tag', 'de-AT']);
		assert.equal(localeRegion(), 'AT', 'a tag the host cannot parse is one guess, not the end');
		set(undefined, 'en-GB');
		assert.equal(localeRegion(), 'GB', 'a host with one language and no list');
		set([]);
		assert.equal(localeRegion(), null, 'nothing to go on is null, not a default');
	} finally {
		if (held === undefined) Reflect.deleteProperty(globalThis, 'navigator');
		else Object.defineProperty(globalThis, 'navigator', { value: held, configurable: true });
	}
});

// --- the country field -------------------------------------------------------------------------

test('a country field is a button that opens a dialog, over a hidden select a form posts', () => {
	const country = mutable<unknown>(null);
	const { body, stop } = page(h(Country as never, {
		label: 'Country', value: country, name: 'country', placeholder: 'Pick one',
	}));

	const button = byTag(body.firstChild, 'button')[0]!;
	assert.equal(button.getAttribute('aria-haspopup'), 'dialog', 'it opens a dialog, not a listbox');
	assert.equal(button.getAttribute('aria-expanded'), 'false');
	assert.equal(button.getAttribute('type'), 'button', 'so it never submits the form it is in');
	assert.match(String(button.textContent), /Pick one/, 'the placeholder while nothing is chosen');

	const native = byTag(body.firstChild, 'select')[0]!;
	assert.equal(native.getAttribute('name'), 'country', 'the form posts this one');
	assert.equal(native.getAttribute('autocomplete'), 'country', 'and autofill fills it');
	assert.equal(native.getAttribute('aria-hidden'), 'true', 'while a screen reader reads the button');
	assert.equal(byTag(native, 'option').length, 250, '249 countries and the blank one');

	const dialog = byTag(body.firstChild, 'dialog')[0]!;
	assert.equal(dialog.getAttribute('open'), null, 'closed until it is opened');
	assert.equal(one(dialog, 'listbox').getAttribute('aria-labelledby'),
		dialog.getAttribute('aria-labelledby'), 'the grid is named by the dialog\'s own heading');
	stop();
});

test('the cell holds the code, and writing it writes the button and the hidden element', () => {
	const country = mutable<unknown>(null);
	const { body, stop } = page(h(Country as never, { label: 'Country', value: country, name: 'country' }));
	const button = byTag(body.firstChild, 'button')[0]!;
	const native = byTag(body.firstChild, 'select')[0]!;

	country.set('CA');
	assert.match(String(button.textContent), /Canada/, 'the name in the page\'s language');
	assert.match(String(button.textContent), /\u{1F1E8}\u{1F1E6}/u, 'with its flag');
	const chosen = byTag(native, 'option').filter((option) => option.getAttribute('selected') !== null);
	assert.deepEqual(chosen.map((option) => option.getAttribute('value')), ['CA'],
		'and one option is selected, which is the one a form posts');

	country.set('ZZ');
	assert.equal(chosen[0]!.getAttribute('selected'), null,
		'a code no row has reads as nothing chosen rather than as itself');
	stop();
});

test('a change on the hidden element writes the cell, which is the autofill path', () => {
	const country = mutable<unknown>(null);
	const { body, stop } = page(h(Country as never, { label: 'Country', value: country, name: 'country' }));
	const native = byTag(body.firstChild, 'select')[0]!;

	fire(native, 'change', { target: { value: 'JP' } });
	assert.equal(country.get(), 'JP', 'autofill wrote the element and the element wrote the cell');
	fire(native, 'change', { target: { value: '' } });
	assert.equal(country.get(), null, 'and the blank option is nothing chosen');
	stop();
});

test('the dialog is closed before onChange runs, so a handler that throws leaves nothing open', () => {
	const country = mutable<unknown>(null);
	const seen: unknown[] = [];
	const { body, stop } = page(h(Country as never, {
		id: 'country',
		label: 'Country',
		value: country,
		locale: 'en',
		suggest: false,
		onChange: (next: unknown) => {
			seen.push(next);
			throw new Error('the page threw');
		},
	}));

	const box = open(body, 'country');
	search(body, 'japan');
	press(box, 'ArrowDown');
	assert.throws(() => { press(box, 'Enter'); }, /the page threw/);

	assert.deepEqual(seen, ['JP'], 'the handler was called with the code');
	assert.equal(country.get(), 'JP', 'the cell was written before it ran');
	assert.equal(byTag(body.firstChild, 'dialog')[0]!.getAttribute('open'), null,
		'and the dialog was closed before it ran, so a throw leaves no modal over the page');
	stop();
});

test('a handler that opens something of its own is not shut again by the close after it', () => {
	const showing = mutable(false);
	const country = mutable<unknown>(null);
	const { body, stop } = page(h(Country as never, {
		id: 'country',
		label: 'Country',
		value: country,
		open: showing,
		locale: 'en',
		suggest: false,
		onChange: () => { showing.set(true); },
	}));

	const box = open(body, 'country');
	search(body, 'japan');
	press(box, 'ArrowDown');
	press(box, 'Enter');
	assert.equal(country.get(), 'JP');
	assert.equal(showing.get(), true, 'the handler opened it and it stayed open');
	stop();
});

test('the row the keyboard is on never names a row that is gone', () => {
	const country = mutable<unknown>('GB');
	const { body, stop } = page(h(Region as never, { id: 'region', label: 'Region', country }));
	const box = open(body, 'region');

	press(box, 'ArrowDown');
	press(box, 'ArrowDown');
	assert.equal(box.getAttribute('aria-activedescendant'), 'region-list-ABD',
		'the keyboard is on the second subdivision of the United Kingdom');

	// The list changes under it: 217 rows become 13, and the id it was on is positional.
	country.set('CA');
	assert.equal(box.getAttribute('aria-activedescendant'), null,
		'the box points at nothing rather than at a row that is not on the page');
	assert.equal(rows(dialogOf(body, 'region')).length, 13);

	// The listbox behaviour settles the cell before it acts on a key: the id it holds names no row in
	// this list, so it lands on the first one and the key then steps from there.
	press(box, 'ArrowDown');
	assert.equal(box.getAttribute('aria-activedescendant'), 'region-list-BC',
		'and the next key arrives in the new list, a step past the row it settled on');
	stop();
});

test('a press on the dialog\'s own furniture does not dismiss the list inside it', () => {
	// The dismissal reads the trigger and the list, and a press on the heading is outside both. The
	// dialog is handed over as inside, so only a press outside the whole dialog closes it (design
	// 250). The page has to be installed before the mount, because that is when the dismissal looks
	// for something to listen on.
	const had = (globalThis as { document?: unknown }).document;
	const owner = createDocument();
	// The light tree has no listeners on the document itself, so the test supplies that half: the
	// dismissal listens there, and this is where its events come from.
	const listeners = new Map<string, Set<(event: unknown) => void>>();
	Object.assign(owner, {
		addEventListener: (type: string, listener: (event: unknown) => void) => {
			listeners.set(type, (listeners.get(type) ?? new Set()).add(listener));
		},
		removeEventListener: (type: string, listener: (event: unknown) => void) => {
			listeners.get(type)?.delete(listener);
		},
	});
	Object.defineProperty(globalThis, 'document', { value: owner, configurable: true });
	const showing = mutable(false);
	let stop = (): void => undefined;
	try {
		stop = mount(owner.body, h(Icons as never, { value: testIcons },
			h(Countries as never, { value: data },
				h(Country as never, { id: 'country', label: 'Country', open: showing })))) as never;

		const body = owner.body as unknown as ElementLike;
		const box = open(body, 'country');
		assert.equal(showing.get(), true);

		const dialog = dialogOf(body, 'country');
		const send = (target: unknown): void => {
			for (const listener of listeners.get('mousedown') ?? []) listener({ type: 'mousedown', target });
		};

		send(byTag(dialog, 'h2')[0]!);
		assert.equal(showing.get(), true, 'the heading is inside the dialog, so it stays open');
		send(box);
		assert.equal(showing.get(), true, 'and so is the search box');
		send(byRole(dialog, 'option')[0]!);
		assert.equal(showing.get(), true, 'and so is a row');

		send(body);
		assert.equal(showing.get(), false, 'while a press outside the dialog altogether closes it');
	} finally {
		stop();
		if (had === undefined) Reflect.deleteProperty(globalThis, 'document');
		else Object.defineProperty(globalThis, 'document', { value: had, configurable: true });
	}
});

test('the backdrop and the close button both shut the dialog, and Escape is not swallowed', () => {
	const showing = mutable(false);
	const { body, stop } = page(h(Country as never, { id: 'country', label: 'Country', open: showing }));
	const dialog = byTag(body.firstChild, 'dialog')[0]!;

	open(body, 'country');
	// A press on the dialog itself is a press on the backdrop: anything inside it targets a child.
	fire(dialog, 'mousedown', { target: dialog });
	assert.equal(showing.get(), false, 'the backdrop closes it');

	fire(byId(body.firstChild, 'country'), 'click');
	assert.equal(showing.get(), true);
	fire(dialog, 'mousedown', { target: byId(body.firstChild, 'country-search') });
	assert.equal(showing.get(), true, 'while a press inside it does not');

	// The element's own `cancel`, which is what a browser fires for Escape.
	let prevented = false;
	fire(dialog, 'cancel', { target: dialog, preventDefault: () => { prevented = true; } });
	assert.equal(showing.get(), false, 'and the cancel event closes it through the cell');
	assert.equal(prevented, true, 'having stopped the element closing itself behind the cell\'s back');
	stop();
});

test('a country field with no provider above it says what to wrap the page in', () => {
	assert.throws(() => page(h(Country as never, { label: 'Country' }), null), (error: Error) => {
		assert.match(error.message, /Countries value=/);
		assert.match(error.message, /countryData\(\)/);
		return true;
	});
});

test('the rows are the guess, then the priority list, then the names in order', () => {
	// The guess is written after the mount, so this page renders without one and the priority list
	// is what leads. `suggest` is off here for the same reason the field takes it: a test that
	// depended on the machine's own language settings would pass in one place and fail in another.
	const { body, stop } = page(h(Country as never, {
		id: 'country', label: 'Country', priority: ['CA', 'US'], suggest: false, flags: false, locale: 'en',
	}));
	assert.deepEqual(rows(body.firstChild), [], 'the grid is empty until it is opened');
	open(body, 'country');
	const held = rows(body.firstChild);
	assert.deepEqual(held.slice(0, 2), ['Canada', 'United States'],
		'the priority list in the order it was given');
	const rest = held.slice(2);
	const sorted = [...rest].sort((a, b) => a.localeCompare(b, 'en'));
	assert.deepEqual(rest, sorted, 'and the rest by name');
	assert.equal(held.length, 249);
	stop();
});

test('the guess leads the list, marked, and the priority list comes after it', () => {
	const held = (globalThis as { navigator?: unknown }).navigator;
	Object.defineProperty(globalThis, 'navigator', { value: { languages: ['en-CA'] }, configurable: true });
	try {
		const { body, stop } = page(h(Country as never, {
			id: 'country', label: 'Country', priority: ['US', 'GB'], locale: 'en', flags: false,
		}));
		open(body, 'country');
		assert.deepEqual(rows(body.firstChild).slice(0, 3), ['Canada', 'United States', 'United Kingdom'],
			'the language settings first, then the priority list in its own order');

		// Marked as a suggestion and not as a choice: nothing is chosen yet.
		const first = byRole(body.firstChild, 'option')[0]!;
		assert.equal(first.getAttribute('aria-selected'), 'false');
		assert.notEqual(first.getAttribute('class'), byRole(body.firstChild, 'option')[1]!.getAttribute('class'),
			'and it wears a class list the other rows do not');
		stop();
	} finally {
		if (held === undefined) Reflect.deleteProperty(globalThis, 'navigator');
		else Object.defineProperty(globalThis, 'navigator', { value: held, configurable: true });
	}
});

test('the search matches the name, the code and an alias, and ignores accents', () => {
	const { body, stop } = page(h(Country as never, {
		id: 'country', label: 'Country', locale: 'en', suggest: false,
	}));
	open(body, 'country');

	const found = (text: string): string[] => {
		search(body, text);
		return rows(body.firstChild);
	};

	assert.deepEqual(found('canada'), ['Canada'], 'the name');
	assert.ok(found('jp').includes('Japan'), 'the code, which is upper case in the data');
	assert.ok(found('JP').includes('Japan'), 'and the case of what is typed is not part of the search');
	assert.ok(found('uk').includes('United Kingdom'), 'an alias for a code that is not the letters typed');
	assert.ok(found('usa').includes('United States'));
	assert.ok(found('holland').includes('Netherlands'));
	// The accents come off both ends of the comparison, and this is the pair that says so: nothing
	// aliases São Tomé, so a match here is the name with its marks taken off and nothing else.
	assert.ok(found('sao tome').some((text) => text.startsWith('São Tomé')), 'an unaccented search');
	assert.ok(found('príncipe').some((text) => text.startsWith('São Tomé')), 'and an accented one');
	assert.ok(found('cote').includes('Côte d’Ivoire'), 'the accents are not in the way');
	// Anywhere in the word, not only the start of it: half the names here are two words and the
	// second one is what a person remembers.
	assert.ok(found('zealand').includes('New Zealand'), 'a word in the middle of the name');
	assert.ok(found('emirates').includes('United Arab Emirates'), 'and one in the middle of an alias');
	assert.deepEqual(found('zzzz'), [], 'and a search matching nothing has no rows');

	search(body, 'zzzz');
	assert.match(String(byTag(body.firstChild, 'dialog')[0]!.textContent), /Nothing matches that/,
		'the grid says so where the rows would have been');
	stop();
});

test('the keys move the active row and Enter picks it, while the characters go to the box', () => {
	const country = mutable<unknown>(null);
	const { body, stop } = page(h(Country as never, {
		id: 'country', label: 'Country', value: country, locale: 'en', suggest: false,
	}));

	const box = open(body, 'country');
	const dialog = byTag(body.firstChild, 'dialog')[0]!;
	assert.equal(dialog.getAttribute('open'), '', 'the dialog is open');
	assert.equal(box.getAttribute('aria-activedescendant'), null,
		'and with nothing chosen the keyboard is on no row');
	assert.equal(byId(body.firstChild, 'country').getAttribute('aria-expanded'), 'true');

	// A printable character is the search box's and not a jump within the list (design 250). Pressed
	// before any search, so all 249 rows are there to jump around, and on a field with no flags,
	// because a row whose text starts with a flag is a row no type-ahead would match anyway.
	const plainField = page(h(Country as never, {
		id: 'plain', label: 'Country', locale: 'en', suggest: false, flags: false,
	}));
	const plainBox = open(plainField.body, 'plain');
	press(plainBox, 'c');
	assert.equal(plainBox.getAttribute('aria-activedescendant'), null,
		'no row went active: with the type-ahead on, c lands the keyboard on Canada');
	plainField.stop();

	search(body, 'canada');
	const row = one(body.firstChild, 'option');
	assert.equal(row.getAttribute('aria-selected'), 'false');
	assert.equal(row.getAttribute('id'), 'country-list-CA',
		'a row is named for the value it holds, so a search that narrows the list around it keeps it');

	press(box, 'ArrowDown');
	assert.equal(box.getAttribute('aria-activedescendant'), row.getAttribute('id'));

	press(box, 'Enter');
	assert.equal(country.get(), 'CA', 'the cell holds the code');
	assert.equal(row.getAttribute('aria-selected'), 'true');
	assert.equal(dialog.getAttribute('open'), null, 'and picking one closes the dialog');
	stop();
});

test('opening on a chosen country puts the keyboard on that row', () => {
	const country = mutable<unknown>('JP');
	const { body, stop } = page(h(Country as never, {
		id: 'country', label: 'Country', value: country, locale: 'en', suggest: false,
	}));
	const box = open(body, 'country');
	const on = box.getAttribute('aria-activedescendant');
	assert.equal(on, 'country-list-JP', 'the keyboard is on the row the value names');
	const row = byRole(body.firstChild, 'option').find((held) => held.getAttribute('id') === on)!;
	assert.match(String(row.textContent), /Japan/, 'and it is the row that is chosen');
	assert.equal(row.getAttribute('aria-selected'), 'true');
	stop();
});

test('Escape closes the dialog and the cell is what says so', () => {
	const showing = mutable(false);
	const { body, stop } = page(h(Country as never, {
		id: 'country', label: 'Country', open: showing, suggest: false,
	}));
	const box = open(body, 'country');
	assert.equal(showing.get(), true, 'the click wrote the cell');

	// Tab is the focus moving between the search box and the grid inside a modal, not a way out of
	// it, so it is the one key here that does not close anything (design 250).
	press(box, 'Tab');
	assert.equal(showing.get(), true, 'Tab leaves it open');

	press(box, 'Escape');
	assert.equal(showing.get(), false);
	assert.equal(byTag(body.firstChild, 'dialog')[0]!.getAttribute('open'), null);

	showing.set(true);
	assert.equal(byTag(body.firstChild, 'dialog')[0]!.getAttribute('open'), '',
		'and the cell opens it as well as closing it');
	stop();
});

test('an open takes a cell, not a value', () => {
	assert.throws(() => page(h(Country as never, { label: 'Country', open: true })), (error: Error) => {
		assert.match(error.message, /open takes a cell/);
		return true;
	});
});

test('a CountryData of your own decides the list, the subdivisions and the aliases', () => {
	// What the README promises an application can do without the peer at all: five codes, its own
	// subdivisions, and its own words for them.
	const own: CountryData = {
		codes: ['CA', 'US', 'NZ'],
		regions: (code) => (code === 'NZ' ? [{ code: 'WGN', name: 'Wellington' }] : []),
		aliases: { nz: ['aotearoa', 'kiwi'] },
	};
	const { body, stop } = page(h(Country as never, {
		id: 'country', label: 'Country', locale: 'en', suggest: false,
	}), own);

	open(body, 'country');
	assert.deepEqual(rows(body.firstChild), ['Canada', 'New Zealand', 'United States'],
		'three countries, by name');

	search(body, 'aotearoa');
	assert.deepEqual(rows(body.firstChild), ['New Zealand'], 'and its own alias finds one');
	search(body, 'holland');
	assert.deepEqual(rows(body.firstChild), [],
		'while this package\'s own aliases are gone, because the map replaced them');
	stop();
});

// --- the subdivision field ---------------------------------------------------------------------

test('a subdivision field follows the country and is disabled while there is none', () => {
	const country = mutable<unknown>(null);
	const region = mutable<unknown>(null);
	const { body, stop } = page(h('div', {},
		h(Country as never, { id: 'country', label: 'Country', value: country, suggest: false }),
		h(Region as never, { id: 'region', label: 'Province', value: region, country, name: 'region' })));

	const field = byId(body.firstChild, 'region');
	assert.equal(field.getAttribute('disabled'), '', 'nothing to choose from until a country is');

	country.set('CA');
	assert.equal(field.getAttribute('disabled'), null, 'and then it opens');
	open(body, 'region');
	const held = rows(dialogOf(body, 'region'));
	assert.equal(held.length, 13, 'the provinces and territories');
	assert.ok(held.includes('Ontario'));

	// Every country in this data has at least one subdivision, so the empty case is a code it does
	// not have at all: a page holding a code from somewhere else, or one that has been retired.
	country.set('ZZ');
	assert.equal(field.getAttribute('disabled'), '', 'a code with no subdivisions is nothing to open');
	stop();
});

test('a subdivision cell holds the short code, and the country changing does not clear it', () => {
	const country = mutable<unknown>('CA');
	const region = mutable<unknown>(null);
	const { body, stop } = page(h(Region as never, {
		id: 'region', label: 'Province', value: region, country, name: 'region', placeholder: 'Pick one',
	}));

	const box = open(body, 'region');
	search(body, 'ontario');
	press(box, 'ArrowDown');
	press(box, 'Enter');
	assert.equal(region.get(), 'ON');

	country.set('US');
	assert.equal(region.get(), 'ON', 'the page owns that write, not this component');
	assert.match(String(byId(body.firstChild, 'region').textContent), /Pick one/,
		'while the button reads as the placeholder, because no row in the new list is that code');
	assert.equal(rows(dialogOf(body, 'region')).length, 0,
		'while the rows are the new country\'s, and no state of it matches what is still in the box');
	search(body, '');
	assert.equal(rows(dialogOf(body, 'region')).length, 62, 'and all of them once it is cleared');
	stop();
});

test('the subdivision search matches the name and the short code', () => {
	const { body, stop } = page(h(Region as never, { id: 'region', label: 'State', country: 'US' }));
	open(body, 'region');
	search(body, 'ny');
	assert.ok(rows(body.firstChild).some((text) => text.includes('New York')));
	search(body, 'texas');
	assert.deepEqual(rows(body.firstChild), ['Texas']);
	stop();
});

test('the longest subdivision list there is searches down to one row', () => {
	const { body, stop } = page(h(Region as never, { id: 'region', label: 'Region', country: 'GB' }));
	open(body, 'region');
	assert.equal(rows(body.firstChild).length, 217, 'every one of them, in the grid');
	search(body, 'aberdeen');
	assert.ok(rows(body.firstChild).length < 5,
		`and a search cuts it to ${String(rows(body.firstChild).length)}`);
	stop();
});

test('a subdivision field with no provider above it says what to wrap the page in', () => {
	assert.throws(() => page(h(Region as never, { label: 'Province', country: 'CA' }), null),
		(error: Error) => {
			assert.match(error.message, /Countries value=/);
			return true;
		});
});
