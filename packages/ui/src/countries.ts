// The country list, on its own subpath because it is the only file that names the peer holding it
// (designs 140 and 251).
//
// Nothing in the root entry imports this, and `Country` does not either: the data reaches the
// components through the `Countries` provider, so an application that allows five countries hands
// over five and installs nothing. What this adds over the peer is the aliases, which no data set
// has, and the shape the components read.
//
// The names are not here. `Intl.DisplayNames` has them, in every language the host knows, and a
// list of them in this file would be one language and out of date.

import { codecError } from '@aweftjs/codec';

/** One subdivision of one country: a province, a state, a region, a prefecture. */
export interface Subdivision {
	/** The subdivision's own short code, as the standard writes it: `ON`, `NY`, `BY`. */
	readonly code: string;
	/** What a person reads. English, because that is what the data has. */
	readonly name: string;
}

/** What `Countries` holds: the codes a form may offer, their subdivisions, and the aliases. */
export interface CountryData {
	/** The two-letter codes. The fields sort them for themselves, so any order will do. */
	readonly codes: readonly string[];
	/** The subdivisions of one code, empty for a country the data has none for. */
	regions(code: string): readonly Subdivision[];
	/** Extra words that match a code in the search, keyed by code and lowercase. */
	readonly aliases?: Readonly<Record<string, readonly string[]>>;
}

/** What the peer's `allCountries` is: a name, a code, and the subdivisions as pairs. */
type PeerCountry = [string, string, [string, string][]];

const INSTALL = 'Install the package the message names, or hand your own CountryData to Countries.';

/**
 * The words a person types that no data set carries.
 *
 * Keyed by the two-letter code, lowercase, and searched with the country's own name. Two kinds of
 * entry: a name the country used to have or is also called (`Holland`, `Burma`, `Ivory Coast`), and
 * the letters a person actually types for it (`uk`, `usa`, `uae`, `nz`). A formal name is not here:
 * `Republic of India` is not what anybody types, and the search already matches the name the host
 * gives and the code itself.
 */
export const countryAliases: Readonly<Record<string, readonly string[]>> = {
	ae: ['uae', 'emirates'],
	ar: ['argentine republic'],
	bo: ['plurinational state of bolivia'],
	br: ['brasil'],
	bn: ['brunei darussalam'],
	cd: ['drc', 'zaire', 'congo kinshasa'],
	cg: ['congo brazzaville'],
	ch: ['swiss', 'suisse', 'schweiz', 'helvetia'],
	ci: ['ivory coast', 'cote divoire'],
	cn: ['prc', 'mainland china'],
	cz: ['czech republic', 'czechoslovakia'],
	de: ['deutschland', 'germany west'],
	dk: ['danmark'],
	es: ['espana'],
	fk: ['malvinas'],
	fr: ['france metropolitaine'],
	gb: ['uk', 'united kingdom', 'great britain', 'britain', 'england', 'scotland', 'wales'],
	gr: ['hellas', 'hellenic republic'],
	hk: ['hong kong sar'],
	ir: ['persia'],
	jp: ['nippon', 'nihon'],
	kh: ['kampuchea'],
	kp: ['dprk', 'north korea'],
	kr: ['rok', 'south korea'],
	kz: ['kazakstan'],
	la: ['lao'],
	lk: ['ceylon'],
	mk: ['macedonia'],
	mm: ['burma'],
	mo: ['macau', 'macao sar'],
	mx: ['mexico estados unidos'],
	nl: ['holland', 'the netherlands'],
	nz: ['nz', 'aotearoa'],
	ph: ['philippines islands'],
	ru: ['russian federation', 'ussr', 'soviet union'],
	sa: ['ksa', 'saudi'],
	sy: ['syrian arab republic'],
	sz: ['swaziland'],
	tl: ['east timor'],
	tr: ['turkey'],
	tw: ['roc', 'formosa', 'chinese taipei'],
	tz: ['zanzibar'],
	ua: ['ukrainian'],
	us: ['usa', 'us', 'america', 'united states of america', 'states'],
	va: ['vatican', 'holy see'],
	ve: ['bolivarian republic of venezuela'],
	vn: ['viet nam'],
	za: ['rsa', 'south africa'],
};

/**
 * The whole country list, from the package that has it.
 *
 * Params:
 *   load: where to get the data from. Omitted, the optional `country-region-data` peer. Hand one
 *         over for a copy of that data you got some other way: a file the page fetched, a module an
 *         application vendored, a subset it built. What comes back must have an `allCountries`
 *
 * Returns: a promise of `CountryData` over every territory the data has, with this package's
 * aliases on it. Hand it to `Countries`.
 *
 * The peer is optional and is named here and nowhere else. In a bundler an import it cannot resolve
 * fails the build before this runs, naming the same package; in Node a missing peer is the refusal
 * below.
 *
 * Throws: `countries-not-installed` when the load fails, carrying the install command, and
 * `countries-unreadable` when what it answers is not the list this reads. A `load` of your own that
 * throws refuses the same way, with the same message: the common reason to be here is the peer, and
 * a caller who handed over a loader can see what their own loader did.
 *
 * Example:
 *   const data = await countryData();
 *   <Countries value={data}><Country value={country} /></Countries>
 */
export const countryData = async (load?: () => Promise<unknown>): Promise<CountryData> => {
	let held: { allCountries?: unknown };
	try {
		held = (load === undefined
			? await import('country-region-data')
			: await load()) as { allCountries?: unknown };
	} catch {
		throw codecError(
			'countries-not-installed',
			'country-region-data is not installed; run: npm install country-region-data',
			INSTALL,
		);
	}

	const all = held.allCountries;
	if (!Array.isArray(all) || all.length === 0) {
		throw codecError(
			'countries-unreadable',
			`country-region-data exported no allCountries list; found ${typeof all}`,
			'Install a 3 or 4 release of the package, whose allCountries is a list of countries.',
		);
	}

	// One walk, into two maps: the codes in the order the data has them, and the subdivisions by
	// code. A row that is not the shape this reads is skipped rather than refused, because a data
	// set that grows a row is not a reason to leave a page with no country field at all.
	const codes: string[] = [];
	const regions = new Map<string, readonly Subdivision[]>();
	for (const row of all as PeerCountry[]) {
		if (!Array.isArray(row) || typeof row[1] !== 'string') continue;
		const code = row[1].toUpperCase();
		codes.push(code);
		const held2 = Array.isArray(row[2]) ? row[2] : [];
		regions.set(code, held2
			.filter((pair) => Array.isArray(pair) && typeof pair[0] === 'string')
			.map((pair) => ({ name: pair[0], code: typeof pair[1] === 'string' ? pair[1] : pair[0] })));
	}

	return {
		codes,
		regions: (code: string) => regions.get(code.toUpperCase()) ?? [],
		aliases: countryAliases,
	};
};
