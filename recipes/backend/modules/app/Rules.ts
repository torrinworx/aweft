// The rules the board keeps, as reasons. Pure: it holds nothing, reads nothing, and takes no
// store, which is what makes it the one module worth testing on its own.

import type { Commit, WireReason } from '@aweftjs/sync';

export default () => ({
	/** Why this commit may not land on the board. Empty allows, as everywhere in this stack. */
	whyNot: (commit: Commit): WireReason[] => {
		if (commit.deltas.some((delta) => delta.type === 'remove')) {
			return [{ code: 'keep', message: 'a note on the board is never removed' }];
		}
		return [];
	},
});
