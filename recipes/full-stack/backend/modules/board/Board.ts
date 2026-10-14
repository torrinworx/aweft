// board/Board: one document, opened here and offered to every connection the gate allows.
//
// What a module holds, it opens, and what it opens, it closes in `stop`. The boot file knows
// none of this.

import { fromPlain, toPlain } from '@aweftjs/core';
import type { ModuleProps } from '@aweftjs/modules';
import type { Connection } from '@aweftjs/server';
import { open } from '@aweftjs/server';
import type { Store } from '@aweftjs/store';

/** One thing pinned to the board. */
export interface Item {
	readonly title: string;
}

/** What `board/Search` reaches through `imports`. */
export interface BoardInstance {
	/** A plain copy of what is pinned, which is what may cross to a page. */
	items(): Item[];
}

// What a new board starts with, written as plain data and made into the document's own
// observables on the way in: a slot refuses a plain array.
const FIRST: readonly Item[] = [
	{ title: 'Bring a chair to the meeting' },
	{ title: 'The kitchen closes at nine' },
	{ title: 'Chairs are back in the hall' },
];

export default async ({ store }: ModuleProps) => {
	const handle = await (store as Store).open('board:main');
	const board = handle.root as { title?: string; items?: Item[] };
	// An unwritten name opens as an empty document, so what this application starts with is
	// written once, here.
	board.title ??= 'the notice board';
	board.items ??= fromPlain([...FIRST]);

	return {
		public: true,
		// A share on a connection's link has to say what it accepts. This board takes anything
		// a connection sends, and `open` is the handlers for that case; a rule of your own goes
		// where it is.
		connection: ({ link }: Connection) => { link.share('board', handle.root, open); },
		items: (): Item[] => toPlain<Item[]>(board.items ?? []),
		stop: async () => { await (store as Store).close(handle); },
	};
};
