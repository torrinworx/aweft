// Every post, for anyone. `public`, so a visitor nobody knows may read it, which is who a render
// on request asks as.

import type { Post } from '../../site.tsx';

export const POSTS: readonly Post[] = [
	{ id: 'first-light', title: 'First light', body: 'The press ran its first sheet at dawn.' },
	{ id: 'second-wind', title: 'Second wind', body: 'The second issue went out a week later.' },
];

/** Every time a module here was called, from a render or from a socket alike. */
export const called: string[] = [];

export default () => ({
	public: true,
	call: () => {
		called.push('posts/List');
		return POSTS;
	},
});
