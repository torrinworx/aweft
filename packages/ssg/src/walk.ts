// Turning one render of a site into the list of URLs it has (design 148).
//
// Everything here reads the stage registry `ui`'s `render` holds (designs 126, 145) and nothing
// here renders anything: the caller passes in a function that renders a URL and answers the stages
// that were up. That is what makes the rules testable without a site.

import { codecError } from '@aweftjs/codec';
import type { StageAct, StageEntry } from '@aweftjs/ui';

import { urlOf } from './url.ts';

/** An act with a parameter in its key and no `entries()`, so a walk cannot say what its URLs are. */
export interface Unenumerated {
	/** The prefix of the stage that declares it: what that stage's parent matched. */
	readonly prefix: string;
	/** The act key, as it was declared. */
	readonly name: string;
}

/** What a walk found. */
export interface WalkResult {
	/** Every URL the site has, in the order the walk reached them, starting at `/`. */
	readonly urls: readonly string[];
	/** The acts it could not enumerate. Each one is a page only the client can render. */
	readonly unenumerated: readonly Unenumerated[];
}

/** Whether an act key takes a value from somewhere: `:name` or `*rest`. */
const parameterised = (key: string): boolean =>
	key.split('/').some((piece) => piece.startsWith(':') || piece.startsWith('*'));

/** A `*rest` value is several segments, so its slashes stay slashes and the rest is escaped. */
const rest = (value: string): string => value.split('/').map(encodeURIComponent).join('/');

/** One answered parameter set, put in place of the names in an act key. */
const substitute = (key: string, row: Readonly<Record<string, string>>): string =>
	key.split('/').map((piece) => {
		const takes = piece.startsWith(':') ? 1 : piece.startsWith('*') ? 2 : 0;
		if (takes === 0) return piece;
		const name = piece.slice(1);
		const value = row[name];
		if (typeof value !== 'string') {
			throw codecError('missing-parameter', `${key} takes ${name} and entries() answered ${JSON.stringify(row)}`,
				'Answer every :name and *name in the act key from entries(), as a string.');
		}
		// A `*rest` is several segments, so every one of them is checked. `.` and `..` are path
		// operations rather than names: `posts/../index.html` is the site root's own page, and it
		// is still inside the output directory, so a guard on the written path would not see it.
		for (const segment of takes === 1 ? [value] : value.split('/')) {
			if (segment !== '' && segment !== '.' && segment !== '..') continue;
			throw codecError('bad-entry-value', `${key} was answered ${name}=${JSON.stringify(value)}`,
				'Answer a value with no empty, . or .. segment in it; those name a place rather than a page.');
		}
		return takes === 1 ? encodeURIComponent(value) : rest(value);
	}).join('/');

/** Every URL one act declares, or null when it cannot be enumerated. */
const urlsOfAct = async (prefix: string, act: StageAct): Promise<string[] | null> => {
	if (act.entries === null) {
		return parameterised(act.name) ? null : [urlOf(prefix, act.name)];
	}
	const rows = await act.entries();
	if (!Array.isArray(rows)) {
		const said = rows === null ? 'null' : typeof rows === 'object' ? 'an object' : `a ${typeof rows}`;
		throw codecError('bad-entries', `${act.name} answered ${said}`,
			'Answer an array of objects from entries(), one per page, and an empty array for none.');
	}
	// An empty answer is a site saying it has no posts yet, for a plain key as much as for a
	// parameterised one, so nothing is written either way.
	if (rows.length === 0) return [];
	if (!parameterised(act.name)) return [urlOf(prefix, act.name)];
	return rows.map((row) => urlOf(prefix, substitute(act.name, row)));
};

/**
 * Walk a site from one render of its root.
 *
 * Params:
 *   stagesAt: renders a URL and answers the stage entries that were mounted while it rendered
 *
 * Returns: the URLs and the acts that could not be enumerated.
 *
 * Throws: `missing-parameter` when an `entries()` answers an object that does not name every
 * `:name` and `*rest` in its act key.
 *
 * A nested stage exists only while the act holding it is mounted, so the URLs under it are
 * invisible until that page has been rendered. The walk is therefore a queue rather than one
 * pass: render, add what is new, take the next, and stop when a render adds nothing.
 *
 * Example:
 *   const found = await walkSite(async (url) => [...(await renderAt(url)).stage.items]);
 */
export const walkSite = async (
	stagesAt: (url: string) => Promise<readonly StageEntry[]>,
): Promise<WalkResult> => {
	const urls = ['/'];
	const seen = new Set(urls);
	const unenumerated: Unenumerated[] = [];
	const reported = new Set<string>();

	for (let at = 0; at < urls.length; at += 1) {
		for (const entry of await stagesAt(urls[at]!)) {
			const prefix = entry.prefix;
			for (const act of entry.acts) {
				// The fallback is what a URL nothing matches shows, and that page is the site's
				// `404.html`. Writing it at its own key as well puts a "not found" page on a URL
				// the site says it has, and in the sitemap (design 152).
				if (act.name === entry.fallback) continue;
				const found = await urlsOfAct(prefix, act);
				if (found === null) {
					const key = `${prefix}|${act.name}`;
					if (reported.has(key)) continue;
					reported.add(key);
					unenumerated.push({ prefix, name: act.name });
					continue;
				}
				for (const url of found) {
					if (seen.has(url)) continue;
					seen.add(url);
					urls.push(url);
				}
			}
		}
	}

	return { urls, unenumerated };
};
