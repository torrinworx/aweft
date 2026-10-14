// board/Search: what is pinned whose title holds the words asked for. Public, so a page can
// search before anyone has signed in. The page follows its search field with `asking`.

import type { BoardInstance, Item } from './Board.ts';

export const deps = ['board/Board'];

export default ({ imports }: { imports: { Board: BoardInstance } }) => ({
	public: true,
	call: (args: { text?: unknown } | null): Item[] => {
		const text = typeof args?.text === 'string' ? args.text.trim().toLowerCase() : '';
		return imports.Board.items().filter((item) => item.title.toLowerCase().includes(text));
	},
});
