// The reading side of a small publication: an index of posts and a page per post, each read from
// the server through the client the page is handed.
//
// The same component runs in three places. In the server's render, the client is the one the
// render made, and every read goes straight to a module. In the browser's hydration, the client
// answers from what the render recorded. On every navigation after it, the client asks the server
// over the socket. Each read goes through `suspend`, which keeps the server's markup on
// screen until the answer arrives, and each loader answers a component call with what it read as
// props, because that is what a hydration adopts: an element built inside the loader is built
// outside the mount and replaces the server's.

import type { Client } from '@aweftjs/client';
import type { Router } from '@aweftjs/dom/router';
import { Head, Meta, Stage, StageContext, Title, h, suspend } from '@aweftjs/ui';
import type { Act, StageValue } from '@aweftjs/ui';

/** One post, as the module answers it. */
export interface Post {
	readonly id: string;
	readonly title: string;
	readonly body: string;
}

const Index = (props: { posts: readonly Post[] }): unknown => (
	<main id="index">
		<Head><Title>The publication</Title></Head>
		<h1>Posts</h1>
		<ul id="posts">
			{props.posts.map((post) => <li><a href={`/posts/${post.id}`}>{post.title}</a></li>)}
		</ul>
	</main>
);

const Article = (props: { post: Post }): unknown => (
	<article id="post">
		<Head><Title>{props.post.title}</Title></Head>
		<h1 id="post-title">{props.post.title}</h1>
		<p id="post-body">{props.post.body}</p>
		<a id="home" href="/">All posts</a>
	</article>
);

// The page knows the id names no post, so it says the status a crawler should get.
const NoPost = (): unknown => (
	<main id="no-post">
		<Head><Title>No such post</Title><Meta httpEquiv="status" content="404" /></Head>
		<p>That post is not here.</p>
		<a id="home" href="/">All posts</a>
	</main>
);

const actsFor = (client: Client): Record<string, Act> => ({
	'': suspend(null, async () => <Index posts={await client.ask('posts/List') as Post[]} />),
	'posts/:id': suspend<{ stage?: StageValue }>(null, async ({ stage }) => {
		try {
			return <Article post={await client.ask('posts/Read', { id: stage!.params.get()['id'] }) as Post} />;
		} catch (error) {
			if ((error as { reason?: string }).reason !== 'no-such-post') throw error;
			return <NoPost />;
		}
	}),
	missing: (): unknown => (
		<main id="missing">
			<Head><Title>Not found</Title></Head>
			<p>Nothing is here.</p>
		</main>
	),
});

/** The site. `exact`, so `/posts/first-light/extra` is the fallback rather than the post. */
export const Site = (props: { router: Router; client: Client }): unknown => (
	<StageContext router={props.router} acts={actsFor(props.client)} fallback="missing" exact>
		<Stage />
	</StageContext>
);
