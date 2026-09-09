// board/Board: one document, opened here and offered to every connection the gate allows.
//
// What a module holds, it opens, and what it opens, it closes in `stop`. The boot file knows
// none of this.

import type { ModuleProps } from '@aweftjs/modules';
import type { Connection } from '@aweftjs/server';
import { open } from '@aweftjs/server';
import type { Store } from '@aweftjs/store';

export default async ({ store }: ModuleProps) => {
	const handle = await (store as Store).open('board:main');
	const board = handle.root as { title?: string };
	// An unwritten name opens as an empty document, so the title this application starts with
	// is written once, here.
	board.title ??= 'the notice board';

	return {
		public: true,
		// A share on a connection's link has to say what it accepts. This board takes anything
		// a connection sends, and `open` is the handlers for that case; a rule of your own goes
		// where it is.
		connection: ({ link }: Connection) => { link.share('board', handle.root, open); },
		stop: async () => { await (store as Store).close(handle); },
	};
};
