// A document's projection, computed from the rows a driver holds.
//
// The same walk `store` runs on every write, offered to a driver that has to fill in the
// projection for documents it stored before a path was declared (design 162). It ships
// because a driver written outside this package cannot reach the internal one, and two walks
// of a declared path are two chances to disagree about what that path names.

import type { Row } from './driver.ts';
import { projectionOf as fieldsOf, type Declaration, type Indexable } from './query.ts';
import { rowsFrom } from './rows.ts';

/**
 * Every declared field of one document, and what it holds.
 *
 * Params:
 *   rows: the document's rows, as `read` hands them back
 *   root: the id of the document's root
 *   declaration: the paths to read, by the name a query calls each one
 *
 * Returns: one entry per declared field. A field whose path is missing, or whose path runs
 * into a primitive or into bytes part way down, holds null rather than being left out: a
 * document absent from the index answers nothing, not even `field eq null`.
 *
 * Throws: `array-in-path` when a declared path crosses an array, which is a mistake rather
 * than an empty result.
 *
 * Example:
 *   const held = await driver.read(doc);
 *   const fields = projectionOf(held.rows, held.root, { title: ['title'] });
 */
export const projectionOf = (
	rows: readonly Row[], root: string, declaration: Declaration,
): Readonly<Record<string, Indexable>> => fieldsOf(rowsFrom(rows), root, declaration);
