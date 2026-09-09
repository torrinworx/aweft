// The catalogue: one page per component `@aweftjs/ui` ships, in light and dark side by side.
//
// The page lists nothing. It reads `examples/` at build time and turns what it finds into one act
// per component, sorted by name (designs 197 and 226). Adding a component to the catalogue is
// adding a file.
//
// It routes on the stack's own stage and router, so the gallery uses the routing it ships. The
// router's base is this page's path with a `#` on the end, which makes the router's path the URL's
// hash: a reload asks the server for `catalogue.html` and nothing else, which is the only form a
// three-page dev server answers.
//
// Everything the page draws of its own is layout, named `catalogue*` and defined here. The
// examples use the library's default theme and nothing else, which is what they are here to show.
//
// Several components ask for an icon by name and the stack ships no drawings (design 144), so the
// page answers them once, at the top, from an installed set.

import { mutable } from '@aweftjs/core';
import { Icon, Icons, PopupContext, Stage, StageContext, TextField, Theme, dark, h, light } from '@aweftjs/ui';
import type { Act, Definitions } from '@aweftjs/ui';
import type { Router } from '@aweftjs/dom/router';
import standard from '@aweftjs/icons/lucide/+standard';

import type { ExampleComponent, ExampleModule } from './example.ts';

Theme.define({
	// This page's own layout choices, so each one has a name anybody can find again.
	'*': { $navWidth: '180px', $paneWidth: '480px' },

	catalogue: {
		display: 'flex',
		flexDirection: 'column',
		gap: '$space6',
		padding: '$space6',
		fontFamily: '$font',
		background: '$background',
		color: '$foreground',
	},
	catalogue_head: {
		display: 'flex',
		flexWrap: 'wrap',
		alignItems: 'center',
		justifyContent: 'space-between',
		gap: '$space4',
	},
	catalogue_title: { margin: 0 },
	catalogue_body: { display: 'flex', alignItems: 'flex-start', gap: '$space6' },

	catalogue_nav: {
		position: 'sticky',
		top: '$space6',
		alignSelf: 'flex-start',
		flex: '0 0 $navWidth',
		width: '$navWidth',
		boxSizing: 'border-box',
		display: 'flex',
		flexDirection: 'column',
		gap: '$space2',
		// Thirty components ran off the bottom of the screen and there was no way back to them. The
		// box is the viewport less the room above and below it, and the rest scrolls inside it.
		maxHeight: 'calc(100vh - $space6 * 2)',
		overflowY: 'auto',
		// A scrolling box clips both axes, and the focus halo is 3px wide, so it needs the room.
		padding: '$space',
	},
	catalogue_list: {
		listStyle: 'none',
		margin: 0,
		padding: 0,
		display: 'flex',
		flexDirection: 'column',
		gap: '$space',
	},
	catalogue_link: {
		display: 'block',
		padding: '$space $space2',
		borderRadius: '$radiusSm',
		color: '$foreground',
		textDecoration: 'none',
		fontSize: '$textSm',
		lineHeight: '$textSmLine',
		'_cssProp_hover': { background: '$muted', color: '$mutedForeground' },
	},
	catalogue_link_current: { background: '$accent', color: '$accentForeground' },

	catalogue_main: { display: 'flex', flexDirection: 'column', gap: '$space6', flexGrow: 1, minWidth: 0 },
	catalogue_page: {
		display: 'flex',
		flexDirection: 'column',
		gap: '$space3',
		// The page takes the focus when it opens, so a reader is told where it is; the ring is for a
		// control a person has to find again, and a whole page framed in it is noise.
		'_cssProp_focus-visible': { boxShadow: 'none' },
	},
	catalogue_panes: {
		display: 'flex',
		flexWrap: 'wrap',
		alignItems: 'flex-start',
		gap: '$space4',
	},
	catalogue_pane: {
		flex: '1 1 $paneWidth',
		minWidth: '$paneWidth',
		display: 'flex',
		flexDirection: 'column',
		gap: '$space4',
		padding: '$space4',
		borderRadius: '$radiusLg',
		border: '$borderWidth solid $border',
		background: '$background',
		color: '$foreground',
	},
});

// One static import per file, written by the bundler. Nothing here names an example.
const found = import.meta.glob('./examples/*.example.tsx', { eager: true });

/** Every example, in the order the nav lists them and the order a person looks for a name in. */
const examples = Object.values(found)
	.map((module) => module as ExampleModule)
	.sort((left, right) => left.name.localeCompare(right.name));

/** One pane: the example again, under the mode this pane is in. */
const Pane = (props: { name?: unknown; mode?: unknown; values?: unknown; show?: unknown }): unknown =>
	h(Theme, { value: props.values as Definitions },
		h(PopupContext, {},
			h('div', {
				theme: 'catalogue_pane',
				id: `${String(props.name)}-pane-${String(props.mode)}`,
			},
			h('p', { theme: ['text', 'xs', 'muted'] }, `${String(props.mode)} mode`),
			h(props.show as ExampleComponent, { mode: props.mode }))));

/** One act: the component's name, and its example under each of the two modes. */
const pageFor = (example: ExampleModule): Act => (): unknown => (
	<article theme="catalogue_page" id={example.name}>
		<h2 theme={['text', 'xl', 'bold']}>{example.name}</h2>
		<div theme="catalogue_panes">
			<Pane name={example.name} mode="light" values={light} show={example.Example} />
			<Pane name={example.name} mode="dark" values={dark} show={example.Example} />
		</div>
	</article>
);

const acts: Record<string, Act> = Object.fromEntries(
	examples.map((example) => [example.name, pageFor(example)]));

/** What the search field holds, and what the nav shows for it. */
const query = mutable('');
const matches = (name: string, text: string): boolean =>
	name.toLowerCase().includes(text.trim().toLowerCase());
const hits = query.map((text) => examples.filter((held) => matches(held.name, String(text))).length);

/**
 * A nav link the router takes rather than the browser.
 *
 * `router.links` leaves a link into the page showing now that differs only in its hash, and every
 * link here is one: the browser would move the address bar and fire no `popstate`, so the stage
 * would never hear about it. A click with a modifier on it still belongs to the browser, so a
 * middle click or a Ctrl click opens the page in a tab of its own.
 */
const go = (router: Router, event: unknown, name: string): void => {
	const click = event as {
		button?: number; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean;
		preventDefault(): void;
	};
	if (click.button !== undefined && click.button !== 0) return;
	if (click.metaKey === true || click.ctrlKey === true || click.shiftKey === true || click.altKey === true) return;
	click.preventDefault();
	router.push(`/${name}`);
};

/** The list down the left: every component, the one showing marked, and a search over the names. */
const Nav = StageContext.use((stage) => (props: { router?: unknown }): unknown => (
	<nav theme="catalogue_nav" aria-label="Components">
		<TextField
			id="catalogue-search"
			aria-label="Search components"
			placeholder="Search"
			value={query}
			leading={<Icon name="search" />}
			onKeyDown={(event: unknown) => {
				if ((event as { key?: string }).key === 'Escape') query.set('');
			}}
		/>
		<p
			theme={['text', 'xs', 'muted']}
			id="catalogue-count"
			hidden={query.map((text) => String(text).trim() === '')}
		>{hits.map((count) => `${String(count)} of ${String(examples.length)}`)}</p>

		<ul theme="catalogue_list">
			{examples.map((example) => (
				<li hidden={query.map((text) => !matches(example.name, String(text)))}>
					<a
						theme={['catalogue_link',
							stage!.current.map((name) => (name === example.name ? 'current' : null))]}
						href={`#/${example.name}`}
						aria-current={stage!.current.map((name) => (name === example.name ? 'page' : false))}
						onClick={(event: unknown) => { go(props.router as Router, event, example.name); }}
					>{example.name}</a>
				</li>
			))}
		</ul>

		<p
			theme={['text', 'xs', 'muted']}
			id="catalogue-none"
			hidden={hits.map((count) => count > 0)}
		>Nothing matches that.</p>
	</nav>
));

export const Catalogue = (props: { router?: unknown }): unknown => (
	<Icons value={standard}>
		<div theme="catalogue" id="catalogue">
			{/* The nav and the search sit beside the `Stage` rather than in a template, because a
			    template is rebuilt on every act change and a search box that empties itself when
			    you pick a result is not a search box. */}
			<StageContext router={props.router as Router} acts={acts} initial={examples[0]!.name}>
				<header theme="catalogue_head">
					<h1 theme={['text', '2xl', 'bold', 'catalogue_title']} id="catalogue-title">The catalogue</h1>
				</header>

				<div theme="catalogue_body">
					<Nav router={props.router} />
					<main theme="catalogue_main"><Stage /></main>
				</div>
			</StageContext>
		</div>
	</Icons>
);
