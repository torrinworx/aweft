// The reading side of a small publication: an index of posts and a page per post.
//
// The posts are a prop, not something this file goes and fetches. The build hands it the rows in
// the store; the browser hands it the same rows, read from a file the build wrote beside the pages.
// That is the pattern `dom`'s README describes for a component that would otherwise wait on the
// server and wait again on the client.

import { Head, Meta, Stage, StageContext, Title, h } from '@aweftjs/ui';
import type { Act } from '@aweftjs/ui';
import type { Router } from '@aweftjs/dom/router';

/** One post, as the store holds it and as the page reads it. */
export interface Post {
	readonly id: string;
	readonly title: string;
	readonly body: string;
}

const Index = (props: { posts?: readonly Post[] }): unknown => (
	<main id="index">
		<Head><Title>The publication</Title></Head>
		<h1>Posts</h1>
		<ul id="posts">
			{(props.posts ?? []).map((post) => <li><a href={`/posts/${post.id}`}>{post.title}</a></li>)}
		</ul>
	</main>
);

const Missing = (): unknown => (
	<main id="missing">
		<Head><Title>No such post</Title><Meta name="robots" content="noindex" /></Head>
		<p>That post is not here.</p>
	</main>
);

/** Builds the acts around one list of posts, so the same list reaches the pages and `entries()`. */
export const actsFor = (posts: readonly Post[]): Record<string, Act> => {
	const Article = StageContext.use((stage) => (): unknown => {
		const id = String(stage!.params.get()['id']);
		const post = posts.find((one) => one.id === id);
		return post === undefined ? <Missing /> : (
			<article id="post" data-post={post.id}>
				<Head><Title>{post.title}</Title></Head>
				<h1 id="post-title">{post.title}</h1>
				<p id="post-body">{post.body}</p>
			</article>
		);
	});

	const Home = (): unknown => <Index posts={posts} />;

	return {
		'': Home,
		// Which posts exist is the application's answer, and here it is the store's rows.
		'posts/:id': Object.assign(Article, { entries: async () => posts.map((post) => ({ id: post.id })) }),
		missing: Missing,
	};
};

export const Site = (props: { router: Router; posts?: readonly Post[] }): unknown => (
	<StageContext router={props.router} acts={actsFor(props.posts ?? [])} fallback="missing">
		<Stage />
	</StageContext>
);
