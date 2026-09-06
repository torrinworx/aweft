// Holding a document to its description, wherever a change comes from.

import { intercept } from '@aweftjs/core';

import type { Shape } from './shape.ts';
import { check } from './check.ts';

/**
 * Refuse every commit on a document that would take it outside its description.
 *
 * Params:
 *   document: any observable in the document. The guard covers the whole document
 *   form: the description, from `shape`, `list` or `table`
 *
 * Returns: the function that stops guarding.
 *
 * This is `check` run on every commit, through core's `intercept`, so a local assignment that
 * breaks the shape throws a `RefusedError` carrying the refusals and leaves the document as it
 * was, and a commit arriving through `apply` is refused before any watcher hears about it.
 *
 * A guarded slot refuses a half-written value, which is what it is for and what makes it the
 * wrong place to hold one: keep a draft in a cell and write it to the document on submit.
 *
 * Throws: at the write, not here. A change that breaks the description throws a
 * `RefusedError` carrying the refusals, and a leaf that answers later throws
 * `async-validator`.
 *
 * Example:
 *   const stop = guard(board, Board);
 *   board.title = '';       // throws: the refusal says why
 *   stop();
 */
export const guard = (document: unknown, form: Shape): (() => void) =>
	intercept(document, (commit) => check(form, document, commit));
