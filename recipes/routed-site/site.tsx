// A small routed site: two nested stages, an act with a parameter, an act that arrives later, a
// dialog that owns a history entry, and a title per act that the layout supplies a default for.
//
// The same file renders on a server with no browser and mounts in a page, which is the point.

import { Head, Stage, StageContext, Theme, Title, h } from '@aweftjs/ui';
import type { Act, Component } from '@aweftjs/ui';
import type { Router } from '@aweftjs/dom/router';

// A small look, so the pages carry generated classes and the per-page stylesheet check has
// something to check. Every value is one of the library's names; none is written out here.
Theme.define({
	page: {
		background: '$background',
		color: '$foreground',
		fontFamily: '$font',
		display: 'flex',
		flexDirection: 'column',
		gap: '$space4',
		padding: '$space4',
	},
	nav: {
		display: 'flex',
		gap: '$space3',
		paddingBottom: '$space2',
		borderBottom: '$borderWidth solid $border',
	},
	// One act's own entry, so a page carries a class the others do not.
	postcard: {
		background: '$surface',
		color: '$surfaceForeground',
		border: '$borderWidth solid $border',
		borderRadius: '$radius',
		padding: '$space3',
	},
});

/** Wraps every act. Its `Title` is the site default, and an act inside a `Head` beats it. */
const Layout = (props: { children?: unknown[] }): unknown => (
	<div id="page" theme="page">
		<Title>Routed site</Title>
		<nav id="nav" theme="nav">
			<a id="to-home" href="/">Home</a>
			<a id="to-docs" href="/docs">Docs</a>
			<a id="to-install" href="/docs/install">Install</a>
			<a id="to-post" href="/posts/hello">Post</a>
			<a id="to-about" href="/about">About</a>
			<a id="to-nowhere" href="/nowhere">Nowhere</a>
		</nav>
		{props.children}
	</div>
);

const Home = (): unknown => (
	// Tall on purpose: the browser run scrolls it and expects to come back to where it was.
	<main id="home" style="min-height: 2400px">
		<Head><Title>Home</Title></Head>
		<h1>Home</h1>
	</main>
);

const DocsIndex = (): unknown => (
	<article id="docs-index">
		<Head><Title>The docs</Title></Head>
		<p>Pick a page.</p>
	</article>
);

const DocsPage = StageContext.use((stage) => (): unknown => {
	const name = String(stage!.params.get()['page']);
	return (
		<article id="docs-page">
			<Head><Title>{`Docs: ${name}`}</Title></Head>
			<p id="docs-page-name">{name}</p>
		</article>
	);
});

/** The child stage. It routes on whatever the act above it did not match. */
const Docs = (): unknown => (
	<main id="docs">
		<Head><Title>Docs</Title></Head>
		<StageContext acts={{ '': DocsIndex, ':page': DocsPage }} initial="">
			<Stage />
		</StageContext>
	</main>
);

const Post = StageContext.use((stage) => (): unknown => (
	<main id="post" theme="postcard">
		<Head><Title>{`Post ${String(stage!.params.get()['id'])}`}</Title></Head>
		<h1 id="post-heading">{String(stage!.params.get()['id'])}</h1>
		<button id="open-dialog" onClick={() => stage!.open({ name: 'dialog', history: true, from: 'the post' })}>
			open the dialog
		</button>
		<button id="sort" onClick={() => stage!.query.set({ ...stage!.query.get(), sort: 'new' })}>sort</button>
		<p id="query">{stage!.query.map((held) => JSON.stringify(held))}</p>
	</main>
));

/** Opened rather than routed to, on a history entry of its own, so back dismisses it. */
const Dialog = (props: { from?: unknown }): unknown => (
	<div id="dialog" role="dialog">
		<Head><Title>The dialog</Title></Head>
		<p id="dialog-from">{String(props.from ?? '')}</p>
	</div>
);

const NotFound = (): unknown => (
	<main id="not-found">
		<Head><Title>Not found</Title></Head>
		<p>Nothing here.</p>
	</main>
);

/** Every act of the root stage. `about` arrives through a loader; the rest are components. */
export const acts: Record<string, Act> = {
	'': Home,
	docs: Docs,
	'posts/:id': Post,
	about: { load: () => import('./about.tsx') },
	missing: NotFound,
	dialog: Dialog as Component,
};

/** Every URL this site answers, and what each one should show. */
export const urls: readonly { readonly url: string; readonly id: string; readonly title: string }[] = [
	{ url: '/', id: 'home', title: 'Home' },
	{ url: '/docs', id: 'docs-index', title: 'The docs' },
	{ url: '/docs/install', id: 'docs-page', title: 'Docs: install' },
	{ url: '/posts/hello', id: 'post', title: 'Post hello' },
	{ url: '/about', id: 'about', title: 'About' },
	{ url: '/nowhere', id: 'not-found', title: 'Not found' },
];

export const Site = (props: { router: Router }): unknown => (
	<StageContext router={props.router} acts={acts} template={Layout} fallback="missing">
		<Stage />
	</StageContext>
);
