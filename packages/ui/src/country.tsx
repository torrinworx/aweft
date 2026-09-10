// Two fields of an address: the country, and the subdivision of that country (design 251).
//
// Both are `Chooser`: a button that opens a modal dialog with a search box over a grid (design 250).
// A country list is 249 rows and a subdivision list runs from none to 217, and neither of those is
// a dropdown a person can find their way down.
//
// The data is not here and it is not imported here either. The names come from the host's own
// `Intl.DisplayNames`, in whatever language the page is in; the codes and the subdivisions come
// through the `Countries` provider, which an application fills from `@aweftjs/ui/countries` or from
// a list of its own. The only country data in this file is nothing: even the flags are arithmetic on
// the two letters of the code.

import { type Mounter, mount } from '@aweftjs/dom';
import { all, mutable } from '@aweftjs/core';

// A type import and nothing else: `verbatimModuleSyntax` keeps `import { type X } from` as a real
// import of the module, and that would put the data subpath, and the peer its dynamic import names,
// in the root entry's graph, which is the one thing design 140 says a subpath is for avoiding.
import type { CountryData } from './countries.ts';
import { type ChooserItem, Chooser, plain } from './chooser.tsx';
import { assert } from './assert.ts';
import { createContext } from './contexts.ts';
import { h } from './h.ts';
import { isSource } from './source.ts';

/** The distance from `A` to the first regional indicator symbol. */
const INDICATOR = 0x1f1e6 - 0x41;

/** A two-letter code and nothing else: what a flag and a name can be made from. */
const CODE = /^[A-Za-z]{2}$/;

/**
 * The codes, subdivisions and aliases the country fields below read.
 *
 * Nothing is here by default, because this package ships no country data (design 251). Fill it from
 * `@aweftjs/ui/countries`, which reads the optional `country-region-data` peer, or hand over a
 * `CountryData` of your own: five codes and their regions is a whole value.
 *
 * Example:
 *   const data = await countryData();
 *   <Countries value={data}><Country value={country} /></Countries>
 */
export const Countries = createContext<CountryData | null>(null);

/**
 * The flag emoji for a country code: the two letters as regional indicator symbols.
 *
 * Params:
 *   code: a two-letter country code, in either case
 *
 * Returns: the two symbols, which a host with flag glyphs draws as a flag and one without draws as
 * the two letters. Anything that is not two letters comes back empty, so a made-up code draws
 * nothing rather than two boxes.
 *
 * Example:
 *   flagOf('ca');  // '🇨🇦'
 */
export const flagOf = (code: string): string => {
	if (!CODE.test(code)) return '';
	return [...code.toUpperCase()].map((letter) => String.fromCodePoint(letter.codePointAt(0)! + INDICATOR)).join('');
};

// One per language, because building a `DisplayNames` per country per keystroke is 249 of them for
// a list that does not change. A host with no `Intl.DisplayNames` at all answers with the code.
const naming = new Map<string, ((code: string) => string)>();

const namesIn = (locale: unknown): ((code: string) => string) => {
	const key = typeof locale === 'string' ? locale : '';
	const held = naming.get(key);
	if (held !== undefined) return held;
	const kind = (globalThis as { Intl?: { DisplayNames?: unknown } }).Intl?.DisplayNames;
	let name: (code: string) => string;
	if (typeof kind !== 'function') {
		name = (code) => code;
	} else {
		const display = new Intl.DisplayNames(key === '' ? undefined : [key], { type: 'region' });
		// A code the host has no name for answers with the code, which is what `fallback: 'code'`
		// does by default, and a host that throws for one is not a reason to have no list.
		name = (code) => {
			try {
				return display.of(code) ?? code;
			} catch {
				return code;
			}
		};
	}
	naming.set(key, name);
	return name;
};

/**
 * The country the host looks like it is in, from the language settings and nothing else.
 *
 * Params: none
 *
 * Returns: a two-letter code, or null where there is no host to ask. `en-CA` is `CA`; a language
 * with no region in it is maximized, so `fr` is `FR` and `pt` is `BR`, which is the host's own
 * likely-region data rather than a table of guesses in this file.
 *
 * This is the language setting, not the location: no permission is asked, nothing is fetched, and
 * an American in Toronto whose browser says `en-US` looks American. It is a suggestion for that
 * reason, and it never becomes the value.
 */
export const localeRegion = (): string | null => {
	const nav = (globalThis as { navigator?: { languages?: readonly string[]; language?: string } }).navigator;
	if (nav === undefined) return null;
	const tags = nav.languages !== undefined && nav.languages.length > 0
		? nav.languages
		: [nav.language ?? ''];
	const kind = (globalThis as { Intl?: { Locale?: unknown } }).Intl?.Locale;
	if (typeof kind !== 'function') return null;
	for (const tag of tags) {
		if (tag === '') continue;
		try {
			const held = new Intl.Locale(tag);
			const region = held.region ?? held.maximize().region;
			if (region !== undefined && CODE.test(region)) return region.toUpperCase();
		} catch {
			// A tag the host cannot parse is one guess that failed, not the end of the list.
		}
	}
	return null;
};

/** What `Country` takes. Everything not named here goes to `Chooser` and on to the button. */
export interface CountryProps {
	/** The chosen country's two-letter code, a cell. Absent, the component keeps its own. */
	readonly value?: unknown;
	/** The language the names are in. Absent, the host's own. */
	readonly locale?: unknown;
	/** Codes listed before the rest, in this order: the countries this form mostly sees. */
	readonly priority?: readonly string[];
	/** Whether to draw the flags. On by default. */
	readonly flags?: unknown;
	/** Whether to suggest the country the language settings point at. On by default. */
	readonly suggest?: unknown;
	readonly [prop: string]: unknown;
}

/**
 * The country field: a button that opens a searchable list of every country the provider has.
 *
 * Params:
 *   props: `value`, `locale`, `priority`, `flags`, `suggest`, and everything `Chooser` takes:
 *          `label`, `description`, `error`, `placeholder`, `title`, `search`, `none`, `open`,
 *          `disabled`, `type`, `size`, `name`, `autocomplete`, `onChange`, `element`, `theme`
 *
 * Returns: the chooser, over one row per code the provider holds. The cell holds the two-letter
 * code, and a form posts that.
 *
 * The rows are ordered: the suggested country first, then `priority` in the order it was given,
 * then everything else by its name in the page's own language. Nothing is chosen to begin with, and
 * the suggestion never becomes the value: a person from one country filling a form for another is
 * ordinary, and a guess that fills the field is a mistake nobody notices.
 *
 * A search matches the name, the code and this package's aliases, without accents: `uk` finds the
 * United Kingdom, `cote` finds Côte d'Ivoire.
 *
 * Throws: the assert for a page with no `Countries` provider above it.
 *
 * Example:
 *   <Countries value={data}>
 *     <Country label="Country" value={country} name="country" autocomplete="country" />
 *   </Countries>
 */
export const Country = (
	props: CountryProps,
	_cleanup: (...fns: (() => void)[]) => void,
	mounted: (...fns: (() => void)[]) => void,
): Mounter => {
	// The guess is a client's, and a static render has no host to ask. Written after the mount
	// rather than while the list is first built, so what a server rendered and what a browser
	// adopted are the same rows, and the suggestion arrives as an ordinary write to a cell.
	const guessed = mutable<string | null>(null);
	mounted(() => {
		if (props.suggest === false) return;
		guessed.set(localeRegion());
	});

	return (elem, item, before, context) => {
		const { value, locale, priority, flags, suggest, ...rest } = props;
		const data = Countries.read(context) as CountryData | null;
		assert(data !== null,
			'Country needs the country list: wrap the page in <Countries value={data}>, with data '
			+ 'from countryData() in @aweftjs/ui/countries or a CountryData of your own');
		if (data === null) return () => undefined;

		const order = (priority ?? []).map((code) => code.toUpperCase());
		const aliases = data.aliases ?? {};

		const items = guessed.map((hint): ChooserItem[] => {
			const name = namesIn(locale);
			const rows = data.codes.map((code): ChooserItem => {
				const held = name(code);
				return {
					value: code,
					label: held,
					note: code,
					leading: flags === false ? undefined : flagOf(code),
					suggested: code === hint,
					terms: [plain(held), plain(code), ...(aliases[code.toLowerCase()] ?? []).map(plain)],
				};
			});

			// The suggestion, then the priority list in the order it was given, then the rest by name
			// in this page's language. `localeCompare` is what sorts them, because the alphabet a name
			// belongs to is the language's business and not this file's.
			const rank = (row: ChooserItem): number => {
				if (row.value === hint) return -1;
				const at = order.indexOf(row.value);
				return at < 0 ? order.length : at;
			};
			return rows.sort((one, two) => {
				const by = rank(one) - rank(two);
				if (by !== 0) return by;
				return one.label.localeCompare(two.label, typeof locale === 'string' ? locale : undefined);
			});
		});

		return mount(elem, h(Chooser, { ...rest, value, items, autocomplete: rest['autocomplete'] ?? 'country' }),
			before, context);
	};
};

/** What `Region` takes. Everything not named here goes to `Chooser` and on to the button. */
export interface RegionProps {
	/** The chosen subdivision's short code, a cell. Absent, the component keeps its own. */
	readonly value?: unknown;
	/** The country whose subdivisions these are: a two-letter code, or a cell holding one. */
	readonly country?: unknown;
	readonly [prop: string]: unknown;
}

/**
 * The subdivision field: the provinces, states or regions of one country.
 *
 * Params:
 *   props: `value`, `country`, and everything `Chooser` takes
 *
 * Returns: the chooser, over the subdivisions the provider has for that country. The cell holds the
 * subdivision's short code.
 *
 * It is the same control as `Country` and for the same reason: one country has 217 subdivisions and
 * the middle one has 11, and a threshold that opened a dropdown for a small country and a dialog for
 * a large one would change the control under the person as they picked a country.
 *
 * Handed no country, or one the provider has no subdivisions for, it is disabled and says so. It
 * does not clear the cell when the country changes: the page owns that write, and a form that
 * clears a field the person filled has to be the page's decision.
 *
 * The names are the data's, which is English. Hand `Countries` a `CountryData` of your own to
 * translate them.
 *
 * Throws: the assert for a page with no `Countries` provider above it.
 *
 * Example:
 *   <Region label="Province" value={region} country={country} name="region"
 *           autocomplete="address-level1" />
 */
export const Region = (props: RegionProps): Mounter =>
	(elem, item, before, context) => {
		const { value, country, disabled, ...rest } = props;
		const data = Countries.read(context) as CountryData | null;
		assert(data !== null,
			'Region needs the country list: wrap the page in <Countries value={data}>, with data '
			+ 'from countryData() in @aweftjs/ui/countries or a CountryData of your own');
		if (data === null) return () => undefined;

		const source = isSource(country) ? country : mutable(country ?? null);
		const items = all([source]).map(([code]): ChooserItem[] => {
			if (typeof code !== 'string' || code === '') return [];
			return data.regions(code).map((region) => ({
				value: region.code,
				label: region.name,
				terms: [plain(region.name), plain(region.code)],
			}));
		});

		// Disabled while there is nothing to choose from: a country nobody has picked, and a country
		// the data has no subdivisions for. A page may disable it for its own reasons as well, so its
		// own value is one of the three and any of them is enough.
		const own = isSource(disabled) ? disabled : mutable(disabled ?? false);
		const off = all([source, items, own]).map(([held, rows, held2]) =>
			(held2 === true || typeof held !== 'string' || held === '' || (rows as ChooserItem[]).length === 0));

		return mount(elem, h(Chooser, {
			...rest,
			value,
			items,
			disabled: off,
			autocomplete: rest['autocomplete'] ?? 'address-level1',
		}), before, context);
	};
