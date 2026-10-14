// notes/Note: a note the page opens by sharing its name, `note:<words>`. No `call` opens it and
// no `connection` hook offers it: the page's `client.share('note:pinned')` is the ask, and this
// hook answers it on whichever connection asked, the one after a drop included.
//
// Public, so a page reads the pinned note before anyone has signed in. A name that is not a note's
// is not this module's, and it declines. A note's name is offered only when the note exists, so
// sharing a made-up name writes nothing to the store. It is refused, and the page's share hears
// why.

import { idToText } from '@aweftjs/codec';
import type { Commit } from '@aweftjs/codec';
import { textIdOf } from '@aweftjs/core';
import type { ModuleProps } from '@aweftjs/modules';
import type { Offer } from '@aweftjs/server';
import type { Store } from '@aweftjs/store';

export default async ({ store }: ModuleProps) => {
	const notes = store as Store;
	// The one note this application starts with, written once.
	const pinned = await notes.open('note:pinned');
	(pinned.root as { text?: string }).text ??= 'Nothing is written here yet.';
	await notes.close(pinned);

	return {
		public: true,
		offer: async (name: string): Promise<Offer | undefined> => {
			if (!name.startsWith('note:')) return undefined;
			// A read must not create: `head` answers 0 for a name nothing was ever written under.
			if (await notes.head(name) === 0) {
				throw Object.assign(new Error(`there is no note called ${name}`), { reason: 'no-such-note' });
			}
			const handle = await notes.open(name);
			const root = textIdOf(handle.root);
			return {
				document: handle.root,
				// The page may change what the note says, and nothing else.
				accept: (commit: Commit) => (commit.deltas.every((delta) =>
					idToText(delta.id) === root && delta.ref.kind === 'object' && delta.ref.key === 'text')
					? []
					: [{ code: 'read-only', message: 'only the text of a note is written from the page' }]),
				// The share ended: the page stopped asking, or the connection is gone.
				fault: () => { void notes.close(handle); },
			};
		},
	};
};
