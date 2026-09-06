// Tracking one document: which commits it made, and which one it was handed.
//
// Every replication seam needs to tell a commit that arrived from one that was made here,
// and a watcher cannot tell them apart on its own. The obvious answer, a flag held across
// `apply`, is wrong, and measurably so: delivery is deferred, so a watcher that writes in
// answer to an arriving commit produces its commit inside the same drain, while the flag is
// still up. A flag swallows it, and a local write made in answer to a remote change would
// never replicate.
//
// The rule that holds instead: the FIRST delivery inside an `apply` is the commit that was
// applied, and everything after it in the same window was made here. Both halves are checked
// in `tests/behavior.sync.test.ts`, and each goes red if the rule is removed.

import { type Change, type Commit, apply, observer } from '@aweftjs/core';

/** One commit this document took part in, and the commit that undoes it. */
export interface Tracked {
	readonly commit: Commit;
	/** Prior values, captured by core while the change was applied. Never transmitted. */
	readonly undo: Commit;
	/** True when this is the commit handed to `receive`, false when the document made it. */
	readonly landed: boolean;
}

/** A document being tracked for replication. */
export interface Tracker {
	/**
	 * Apply a commit from elsewhere. The listener hears it with `landed` true, and hears
	 * anything a watcher wrote in answer with `landed` false, in the order they happened.
	 */
	receive(commit: Commit): void;
	/** Stop tracking. The document is left exactly as it is. */
	stop(): void;
}

/**
 * Watch a document for replication.
 *
 * Params:
 *   document: any observable in the document. The whole document is tracked, from its root
 *   on: called once per commit, in the order the document saw them
 *
 * Returns: a tracker. `receive` is the only way to apply a commit to a tracked document, and
 * calling `apply` around it would make an arriving commit look locally made.
 *
 * `receive` must not be called from inside a watcher. Delivery is deferred, so a commit
 * applied there reaches its watchers after the outer one returned, and the ordering this
 * rests on is gone. Queue it and apply on a microtask, which is what every channel here does.
 *
 * Throws: `not-observable` when the value is not part of a document.
 *
 * Example:
 *   const tracker = track(doc, ({ commit, landed }) => {
 *     if (!landed) channel.send({ kind: 'commits', topic, first: next++, commits: [commit] });
 *   });
 */
export const track = (document: unknown, on: (event: Tracked) => void): Tracker => {
	// Zero outside a receive. One from the moment a receive starts until the commit it applied
	// has been delivered, which is the only delivery it covers.
	let landing = 0;

	const stopWatch = observer(document).watch((change: Change) => {
		const landed = landing > 0;
		if (landed) landing = 0;
		on({ commit: { deltas: [...change.deltas] }, undo: change.inverse(), landed });
	});

	return {
		receive: (commit) => {
			landing = 1;
			try {
				apply(document, commit);
			} finally {
				// A commit whose deltas all write what the slot already holds changes nothing and
				// is never delivered. Clearing here stops that window from swallowing the next
				// genuinely local commit.
				landing = 0;
			}
		},
		stop: stopWatch,
	};
};
