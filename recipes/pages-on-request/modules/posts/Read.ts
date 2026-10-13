// One post by its id, or a refusal the page shows as its not-found page.

import { codecError } from '@aweftjs/codec';

import { POSTS, called } from './List.ts';

export default () => ({
	public: true,
	call: (args: { id?: unknown }) => {
		called.push(`posts/Read ${String(args.id)}`);
		const post = POSTS.find((one) => one.id === args.id);
		if (post === undefined) throw codecError('no-such-post', `no post has the id ${JSON.stringify(args.id)}`, 'Ask for an id from posts/List.');
		return post;
	},
});
