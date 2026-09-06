// Two documents in one process, kept in step.

import { idOf, kindOf } from '@aweftjs/core';

import { inProcess } from './channel.ts';
import { rootFrom } from './document.ts';
import { connect } from './link.ts';

/**
 * Keep a second document in step with a first, both ways.
 *
 * Params:
 *   source: any observable in the document to copy from. Its state is the state both start at
 *   target: the document to keep in step. Minted from the source's root when left out
 *
 * Returns: the document being kept in step, and the function that stops it.
 *
 * This is a link over an in-process pair, with `connect` at both ends and nothing else: the
 * same code a link over a socket runs. It is asynchronous for the same reason every link is,
 * so the two documents are in step at the end of the tick, not at the end of the statement.
 *
 * The target starts by asking for the source's state, so a target holding something else is
 * moved to the source. After that the two are equal ends and a change on either crosses.
 *
 * Throws: `not-observable` when the source is not part of a document.
 *
 * Example:
 *   const editing = mirror(stored);
 *   await Promise.resolve();
 *   (editing.document as { title: string }).title = 'draft';  // reaches `stored`
 */
export const mirror = (source: object, target?: object): {
	readonly document: object;
	stop(): void;
} => {
	const document = target ?? rootFrom(idOf(source), kindOf(source));
	const [here, there] = inProcess();

	const from = connect(here);
	const to = connect(there);
	from.share('mirror', source);
	to.share('mirror', document).resync();

	return {
		document,
		stop: () => {
			from.close();
			to.close();
		},
	};
};
