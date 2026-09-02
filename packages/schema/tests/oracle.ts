// A second reading of "where does this live", to check the first one against.
//
// The index under test keeps a parent pointer per observable and answers by walking up. This
// walks the other way: it replays a whole history into a map of attach edges and then walks
// down from the root, so the two share no code and no direction. G1a required exactly this,
// and the rule of evidence requires it: an expected value that came from the implementation
// under test compares that implementation against its own past behaviour.
//
// The slot spelling comes from the conformance harness, which is what the fixtures are
// written in, so this file does not restate the mapping the index states either.

import { type Commit, idToText, isReference } from '@aweftjs/codec';
import { slotKey } from '@aweftjs/testing';

/**
 * Every reachable observable and where it sits, rebuilt from scratch.
 *
 * Params:
 *   root: the document root's id in text form
 *   commits: the whole accepted history, in order
 *
 * Returns: a map from id in text form to its attach path, holding only what the root reaches.
 */
export const pathsFrom = (
	root: string,
	commits: readonly Commit[],
): Map<string, readonly string[]> => {
	// holder -> slot -> the observable that slot attaches.
	const edges = new Map<string, Map<string, string>>();

	const slotsOf = (holder: string): Map<string, string> => {
		const existing = edges.get(holder);
		if (existing !== undefined) return existing;

		const made = new Map<string, string>();
		edges.set(holder, made);
		return made;
	};

	for (const commit of commits) {
		for (const delta of commit.deltas) {
			const slots = slotsOf(idToText(delta.id));
			const slot = slotKey(delta.ref);
			const value = delta.value;

			if (value !== undefined && isReference(value) && value.edge === 'attach') {
				slots.set(slot, idToText(value.id));
			} else {
				slots.delete(slot);
			}
		}
	}

	const paths = new Map<string, readonly string[]>([[root, []]]);
	const queue: string[] = [root];

	while (queue.length > 0) {
		const at = queue.shift()!;
		const here = paths.get(at)!;

		for (const [slot, child] of slotsOf(at)) {
			// A cycle among detached observables never reaches here, and an observable already
			// placed is one the history attached twice, which `record` refuses before this runs.
			if (paths.has(child)) continue;
			paths.set(child, [...here, slot]);
			queue.push(child);
		}
	}

	return paths;
};
