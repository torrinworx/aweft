// A running log of what a document did.
//
// Built on `observer(...).watch`, which is public, so a trace is an ordinary watcher and obeys
// every rule one obeys: it is told after the commit has landed, and it stops when its stop
// function is called. Nothing here reaches into core.

import { observer } from '@aweftjs/core';

import { commitOf } from './commit.ts';
import { render } from './render.ts';

/** A running trace. `stop` is the function that ends it, as every listener in this stack. */
export interface Trace {
	/** Every commit so far, each rendered as its own block. */
	text(): string;
	/** How many commits have landed since the trace started. */
	count(): number;
	/** Stop listening. Calling it twice is harmless. */
	stop(): void;
}

/**
 * Watch a document and keep what it did, as text.
 *
 * Params:
 *   document: any observable in the document to watch
 *   limit: how many commits to keep, oldest dropped first. Defaults to 200, because a trace
 *     left running on a busy document is a memory leak with a friendly name
 *
 * Returns: the trace. Registering it returns its stop function on the object, as every
 * listener in this stack does. Each commit is rendered as it lands, so what a trace says about
 * a commit does not change when the document moves underneath it later.
 *
 * Throws: `not-observable` when the value is not one of this stack's observables.
 *
 * Example:
 *   const t = trace(doc);
 *   doc.title = 'changed';
 *   console.log(t.text());
 *   t.stop();
 */
export const trace = (document: unknown, limit = 200): Trace => {
	const kept: string[] = [];

	const unwatch = observer(document).watch((change) => {
		// Rendered here, not when the trace is read. A delta names its observable by id, and the
		// path that reaches it is a fact about the document at that moment: resolving it later
		// prints one commit two different ways once the tree above it has moved. Rendering costs
		// a little on every commit, which is the price of a trace saying the same thing twice.
		kept.push(render(commitOf({ deltas: [...change.deltas] }, document)));
		if (kept.length > limit) kept.shift();
	});

	let stopped = false;
	return {
		text: () => kept.join('\n\n'),
		count: () => kept.length,
		stop: () => {
			if (stopped) return;
			stopped = true;
			unwatch();
		},
	};
};
