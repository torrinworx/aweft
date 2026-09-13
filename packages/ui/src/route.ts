// Matching a path against the declared act keys (design 122).
//
// A pure function of two strings and a list of keys. No components, no router, no context, so the
// precedence table is testable on its own and a static walk can reuse it.

import { assert } from './assert.ts';

/** What matching a path produced. */
export interface Match {
	/** The act key that won. */
	readonly name: string;
	/** The `:name` and `*name` values, decoded. */
	readonly params: Readonly<Record<string, string>>;
	/** The segments the key took, joined with `/`. A `*name` took every segment left; a bare `*` took none. */
	readonly taken: string;
	/** The segments it did not take, joined with `/`: everything from a bare `*` on. Design 123's business. */
	readonly tail: string;
}

/** A path with its leading and trailing slashes off, and its query and hash gone. */
export const pathOf = (url: string): string => {
	const cut = url.replace(/[?#].*$/, '');
	return cut.replace(/^\/+/, '').replace(/\/+$/, '');
};

/** The query part of a URL, without the `?`, or `''`. */
export const queryOf = (url: string): string => {
	const found = /\?([^#]*)/.exec(url);
	return found === null ? '' : found[1]!;
};

/** The hash part of a URL, `#` included, or `''`. */
export const hashOf = (url: string): string => {
	const at = url.indexOf('#');
	return at < 0 ? '' : url.slice(at);
};

const decode = (segment: string): string => {
	// A half-written escape is a URL a person typed, not a reason to throw out of a navigation.
	try {
		return decodeURIComponent(segment);
	} catch {
		return segment;
	}
};

const split = (path: string): string[] => (path === '' ? [] : path.split('/'));

/**
 * What a key matches on, with every parameter name taken out: literal segments as they are, and
 * `:` or `*` for the two kinds that take anything. Two keys with one signature match exactly the
 * same paths, so whichever loses is unreachable; a bare `*` and a `*name` are one signature,
 * because one parks the very segments the other takes.
 */
const signature = (key: string): string =>
	split(key)
		.map((piece) => (piece.startsWith(':') ? ':' : piece.startsWith('*') ? '*' : piece))
		.join('/');

/**
 * Check the act keys once, where the mistake is cheap to name.
 *
 * Throws: an assert, loud in development and stripped in a release build, for a key that starts
 * with a slash, ends with one, has an empty segment, has a `:` with no name after it, has more
 * than one `*` segment (named or bare), or has one anywhere but last; and for two keys that match
 * the same paths.
 */
export const checkActKeys = (keys: readonly string[]): void => {
	const seen = new Map<string, string>();
	for (const key of keys) {
		assert(!key.startsWith('/'),
			`the act key ${JSON.stringify(key)} starts with a slash; act keys are relative, so write it as ${JSON.stringify(key.slice(1))}`);
		assert(key === '' || !key.endsWith('/'),
			`the act key ${JSON.stringify(key)} ends with a slash, which no path this matcher is given ever has; write it as ${JSON.stringify(key.replace(/\/+$/, ''))}`);
		const pieces = split(key);
		for (const piece of pieces) {
			assert(piece !== '',
				`the act key ${JSON.stringify(key)} has an empty segment, which no path can match; take the extra slash out and write it as ${JSON.stringify(pieces.filter((one) => one !== '').join('/'))}`);
			assert(piece !== ':',
				`the act key ${JSON.stringify(key)} has a ":" with no name after it; name it, as ":name", because the name is how the act reads the value`);
		}
		const rest = pieces.filter((piece) => piece.startsWith('*'));
		assert(rest.length <= 1,
			`the act key ${JSON.stringify(key)} has ${rest.length} * segments and at most one is allowed; keep the last one and drop the others`);
		assert(rest.length === 0 || pieces[pieces.length - 1]!.startsWith('*'),
			`the act key ${JSON.stringify(key)} has a * segment that is not last; move it to the end, because everything after it is the rest`);

		const shape = signature(key);
		const first = seen.get(shape);
		assert(first === undefined,
			`the act keys ${JSON.stringify(first ?? '')} and ${JSON.stringify(key)} match the same paths, so the second can never win; give one of them a literal segment, or declare only one act and read the parameter inside it`);
		seen.set(shape, key);
	}
};

interface Candidate extends Match {
	/** One number per pattern segment: 0 literal, 1 `:name`, 2 `*name`. */
	readonly classes: readonly number[];
}

const attempt = (key: string, segments: readonly string[]): Candidate | null => {
	const pattern = split(key);
	// The index key takes the empty path and nothing else. Without this it would take every path
	// as a tail, and a site with an index would have no way to reach its 404. A page that wraps
	// every act is the stage's `template`, not an act that matches everything.
	if (pattern.length === 0 && segments.length > 0) return null;
	const params: Record<string, string> = {};
	const classes: number[] = [];
	let at = 0;

	for (const piece of pattern) {
		// A bare `*` takes nothing: it parks every segment from here as the tail, for the stage
		// below, and the act above is not rebuilt when that tail moves (designs 122 and 282).
		if (piece === '*') {
			classes.push(2);
			continue;
		}
		if (piece.startsWith('*')) {
			classes.push(2);
			params[piece.slice(1)] = segments.slice(at).map(decode).join('/');
			at = segments.length;
			continue;
		}
		if (piece.startsWith(':')) {
			if (at >= segments.length) return null;
			classes.push(1);
			params[piece.slice(1)] = decode(segments[at]!);
			at += 1;
			continue;
		}
		if (at >= segments.length || segments[at] !== piece) return null;
		classes.push(0);
		at += 1;
	}

	return {
		name: key,
		params,
		classes,
		taken: segments.slice(0, at).join('/'),
		tail: segments.slice(at).join('/'),
	};
};

/** Whether `a` beats `b`: the more specific segment first, then the longer pattern. */
const beats = (a: Candidate, b: Candidate): boolean => {
	const shared = Math.min(a.classes.length, b.classes.length);
	for (let i = 0; i < shared; i += 1) {
		if (a.classes[i] !== b.classes[i]) return a.classes[i]! < b.classes[i]!;
	}
	return a.classes.length > b.classes.length;
};

/**
 * The act a path names.
 *
 * Params:
 *   keys: the declared act keys, in any order
 *   path: the path to match, with or without its slashes, without a query or hash
 *
 * Returns: the match, or null when no key took the path. A key whose whole text is the path wins
 * outright; otherwise a literal segment beats `:name`, `:name` beats `*name` and a bare `*`, and
 * the longer pattern breaks a tie.
 *
 * Example:
 *   matchAct(['posts/:id', 'posts/new'], 'posts/new');  // name 'posts/new'
 *   matchAct(['posts/:id'], 'posts/3/edit');            // params { id: '3' }, tail 'edit'
 *   matchAct(['*'], 'a/b');                             // params {}, taken '', tail 'a/b'
 */
export const matchAct = (keys: readonly string[], path: string): Match | null => {
	const clean = pathOf(path);
	// A key written out in full is an author saying exactly which URL they mean, so it is read
	// before the path is split at all.
	if (keys.includes(clean)) {
		return { name: clean, params: {}, taken: clean, tail: '' };
	}

	const segments = split(clean);
	let best: Candidate | null = null;
	for (const key of keys) {
		const found = attempt(key, segments);
		if (found === null) continue;
		if (best === null || beats(found, best)) best = found;
	}
	if (best === null) return null;
	return { name: best.name, params: best.params, taken: best.taken, tail: best.tail };
};

/** A query string as a plain object, last value winning. */
export const parseQuery = (query: string): Record<string, string> => {
	const out: Record<string, string> = {};
	for (const [name, value] of new URLSearchParams(query)) out[name] = value;
	return out;
};

/**
 * A plain object as a query string, its keys sorted so two equal queries spell the same.
 *
 * Throws: an assert, loud in development and stripped in a release build, for a value that is not
 * a string. A URL holds text, so a number would go out as text and come back as text, and the cell
 * would stop holding what the URL says the moment it round trips.
 */
export const writeQuery = (query: Readonly<Record<string, string>>): string => {
	const params = new URLSearchParams();
	for (const name of Object.keys(query).sort()) {
		const value: unknown = query[name];
		assert(typeof value === 'string',
			`the query holds a ${typeof value} for ${JSON.stringify(name)} and a query is text; write String(value), or leave the key out to drop it from the URL`);
		// `String` and not the value, so a release build with the assert stripped writes what it
		// wrote before rather than throwing somewhere else.
		params.append(name, String(value));
	}
	return params.toString();
};
