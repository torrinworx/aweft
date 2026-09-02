// Loading the conformance corpus.
//
// Four suites were each walking the directory, parsing, and casting on their own before
// this existed, and the corpus counts lived in two files. One loader, sorted by filename so
// every consumer sees the corpus in one order.

import { readFileSync, readdirSync } from 'node:fs';

import type { Fixture, InvalidFixture } from './conformance.ts';

const load = <T>(dir: URL | string): T[] => {
	const base = dir instanceof URL ? dir : new URL(`${dir.endsWith('/') ? dir : `${dir}/`}`, 'file://');
	return readdirSync(base)
		.filter((name) => name.endsWith('.json'))
		.sort()
		.map((name) => JSON.parse(readFileSync(new URL(name, base), 'utf8')) as T);
};

/**
 * Every fixture in a directory, sorted by filename.
 *
 * Params:
 *   dir: the fixtures directory, as a URL or an absolute path ending in a slash
 *
 * Returns: the parsed fixtures, in filename order.
 *
 * Example:
 *   for (const f of loadFixtures(new URL('../../../spec/fixtures/', import.meta.url))) {
 *     checkFixture(f);
 *   }
 */
export const loadFixtures = (dir: URL | string): Fixture[] => load<Fixture>(dir);

/**
 * Every rejection fixture in a directory, sorted by filename.
 *
 * Params:
 *   dir: the invalid-fixtures directory, as a URL or an absolute path ending in a slash
 *
 * Returns: the parsed rejection fixtures, in filename order.
 *
 * Example:
 *   for (const f of loadInvalidFixtures(new URL('../../../spec/fixtures/invalid/', import.meta.url))) {
 *     checkInvalidFixture(f);
 *   }
 */
export const loadInvalidFixtures = (dir: URL | string): InvalidFixture[] => load<InvalidFixture>(dir);
