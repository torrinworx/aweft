// board/Board: one document a signed-in page shares. Its accept refuses a removal, so a delete
// is a refused commit the server reports and the page hears.

import type { ModuleProps } from '@aweftjs/modules';
import type { Connection } from '@aweftjs/server';
import type { Store } from '@aweftjs/store';

export default async ({ store }: ModuleProps) => {
	const handle = await (store as Store).open('board:main');
	const board = handle.root as { title?: string };
	board.title ??= 'the board';
	return {
		public: true,
		connection: ({ link }: Connection) => {
			link.share('board', handle.root, {
				accept: (commit) => (commit.deltas.some((delta) => delta.type === 'remove')
					? [{ code: 'keep', message: 'nothing is removed from the board' }]
					: []),
			});
		},
		stop: async () => { await (store as Store).close(handle); },
	};
};
