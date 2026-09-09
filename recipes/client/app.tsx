// The page: four acts, three of them module names, and one loader for the whole routing tree.
//
// Nothing shared is built here. The gate, the document and the two pages are modules that say
// what they need in `deps`, and the battery's sign-in form lands on `/join` by being named there.

import { authClient } from '@aweftjs/auth/client';
import type { Router } from '@aweftjs/dom/router';
import { fromBundle } from '@aweftjs/modules';
import type { Source } from '@aweftjs/modules';
import { Stage, StageContext, Theme, Title, h } from '@aweftjs/ui';
import type { Act } from '@aweftjs/ui';

// A page has to paint its own ground: the mode's tokens are on the theme, and an element has to
// ask for them. Without this the text follows the mode and the background does not.
Theme.define({
	page: {
		background: '$background',
		color: '$foreground',
		fontFamily: '$font',
		display: 'flex',
		flexDirection: 'column',
		gap: '$space4',
		padding: '$space4',
		minHeight: '100vh',
	},
	nav: {
		display: 'flex',
		gap: '$space3',
	},
	// A browser paints an anchor its own colour, which is not a colour the mode chose, so the
	// link says which one it wants rather than inheriting one it will not get.
	link: {
		color: '$foreground',
	},
});

/** This application's own modules. Nothing imports them: the stage loads what it shows. */
export const app: Source = fromBundle({
	'./site/Gate.ts': () => import('./modules/Gate.ts'),
	'./site/Home.tsx': () => import('./modules/Home.tsx'),
	'./notes/Current.ts': () => import('./modules/Current.ts'),
	'./notes/Page.tsx': () => import('./modules/Page.tsx'),
});

const Layout = (props: { children?: unknown[] }): unknown => (
	<main id="page" theme="page">
		<Title>Notes</Title>
		<nav id="nav" theme="nav">
			<a id="to-home" theme="link" href="/">Home</a>
			{' '}
			<a id="to-notes" theme="link" href="/notes">Notes</a>
			{' '}
			<a id="to-join" theme="link" href="/join">Join</a>
		</nav>
		{props.children}
	</main>
);

const NotFound = (): unknown => <p id="not-found">Nothing here.</p>;

/** Where each act lives. Three names and one component, which is all a route table is. */
export const acts: Record<string, Act> = {
	'': 'site/Home',
	notes: 'notes/Page',
	join: 'auth/SignIn',
	missing: NotFound,
};

export const App = (props: { router: Router; client: unknown }): unknown => (
	<StageContext
		router={props.router}
		sources={[app, authClient]}
		client={props.client}
		acts={acts}
		template={Layout}
		fallback="missing"
		refused="join"
	>
		<Stage />
	</StageContext>
);
