// A small site written in one language, shown in three (designs 277, 278, 279).
//
// Nothing here says which language it is in. The literals are English, the build wraps each one
// in `text()` because `vite.config.ts` and the process that renders it both turn the option on,
// and the render each page mounts under carries the catalog. The same file renders on a server
// with no browser and mounts in a page.

import { mutable } from '@aweftjs/core';
import type { Router } from '@aweftjs/dom/router';
import { fromDocument } from '@aweftjs/modules';
import type { Source } from '@aweftjs/modules';
import {
	Button, Head, Stage, StageContext, TextField, TextModifiers, Theme, Title, Typography, h, text,
} from '@aweftjs/ui';
import type { Act } from '@aweftjs/ui';

import { type Compile, stored } from './stored.ts';

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
	nav: { display: 'flex', gap: '$space3' },
});

/** Wraps every act. Its links carry the router's base, so a French page links to French pages. */
const Layout = (props: { router: Router; children?: unknown[] | undefined }): unknown => (
	<div id="page" theme="page">
		<Title>Translated site</Title>
		<nav id="nav" theme="nav">
			<a id="to-home" href={`${props.router.base}/`}>Home</a>
			<a id="to-about" href={`${props.router.base}/about`}>About</a>
			<a id="to-notes" href={`${props.router.base}/notes`}>Notes</a>
		</nav>
		{props.children}
	</div>
);

const count = mutable(1);

/** Bold whichever word for "now" the catalog wrote, so the modifier runs over the translation. */
const modifiers = [{ check: /\b(now|maintenant|зараз)\b/gi, return: (word: string) => <b id="now">{word}</b> }];

const Home = (props: { router: Router }): unknown => (
	<main id="home">
		<Head><Title>Home</Title></Head>
		<h1 id="welcome">Welcome</h1>
		<img id="photo" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="A photo of the team" width="1" height="1" />
		<TextModifiers value={modifiers}>
			<Typography id="save-now" type="p1" label="Save now" />
		</TextModifiers>
		<Button id="save" label="Save" onClick={() => count.set(count.get() + 1)} />
		<TextField id="name" label="Name" placeholder="Your name" />
		{/* One message, not two: the link sits inside the sentence. */}
		<p id="docs">{text('Read <link>the docs</link> first', { link: (inner: unknown) => <a id="docs-link" href={`${props.router.base}/about`}>{inner}</a> })}</p>
		<p id="items">{text('{n, plural, one {# item} other {# items}}', { n: count })}</p>
		<button id="three" onClick={() => count.set(3)}>3</button>
		<button id="five" onClick={() => count.set(5)}>5</button>
		{/* Code is code in every language. */}
		<p id="code" translate="no"><code>text('Save')</code> is the call the build writes</p>
	</main>
);

const About = (): unknown => (
	<main id="about">
		<Head><Title>About</Title></Head>
		<p id="about-line">Written once, shown in three languages.</p>
		<p id="untranslated">This line has no French entry</p>
	</main>
);

const NotFound = (): unknown => (
	<main id="not-found">
		<Head><Title>Not found</Title></Head>
		<p>Nothing here.</p>
	</main>
);

/** What the browser and the server both hand the stage: the stored act, compiled where it runs. */
export const sourcesWith = (compile: Compile): Source[] => [fromDocument(stored, { compile })];

export const Site = (props: { router: Router; sources: Source[] }): unknown => {
	const acts: Record<string, Act> = {
		'': () => Home(props),
		about: About,
		notes: 'site/Notes',
		missing: NotFound,
	};
	return (
		<StageContext router={props.router} sources={props.sources} acts={acts} template={(inner: { children?: unknown[] }) => Layout({ router: props.router, children: inner.children })} fallback="missing">
			<Stage />
		</StageContext>
	);
};
