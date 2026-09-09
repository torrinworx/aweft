// The catalogue: every component `@aweftjs/ui` ships, in light and dark, side by side.
//
// The page lists nothing. It reads `examples/` at build time and renders what it finds, one
// section per file, sorted by the `order` each file declares (design 197). Adding a component to
// the catalogue is adding a file.
//
// Everything the page draws of its own is layout, named `catalogue*` and defined here. The
// examples use the library's default theme and nothing else, which is what they are here to show.
//
// Several components ask for an icon by name and the stack ships no drawings (design 144), so the
// page answers them once, at the top, from an installed set.

import { mutable } from '@aweftjs/core';
import { Button, DropDown, Icons, PopupContext, Theme, dark, h, light } from '@aweftjs/ui';
import type { Definitions } from '@aweftjs/ui';
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

	catalogue_main: { display: 'flex', flexDirection: 'column', gap: '$space6', flexGrow: 1, minWidth: 0 },
	// The section is what a link lands on, so it keeps a gap above it once it has scrolled there.
	catalogue_section: { display: 'block', scrollMarginTop: '$space6' },
	catalogue_panes: {
		display: 'flex',
		flexWrap: 'wrap',
		alignItems: 'flex-start',
		gap: '$space4',
		paddingTop: '$space3',
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

/** Every example, in the order the page shows them, each with the cell its section opens on. */
const sections = Object.values(found)
	.map((module) => module as ExampleModule)
	.sort((left, right) => left.order - right.order || left.name.localeCompare(right.name))
	.map((example) => ({ example, open: mutable(true) }));

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

const setEvery = (open: boolean): void => {
	for (const section of sections) section.open.set(open);
};

export const Catalogue = (): unknown => (
	<Icons value={standard}>
		<div theme="catalogue" id="catalogue">
			<header theme="catalogue_head">
				<h1 theme={['text', '2xl', 'bold', 'catalogue_title']} id="catalogue-title">The catalogue</h1>
				<div theme="row">
					<Button label="Collapse all" type="quiet" id="collapse-all" onClick={() => { setEvery(false); }} />
					<Button label="Expand all" type="quiet" id="expand-all" onClick={() => { setEvery(true); }} />
				</div>
			</header>

			<div theme="catalogue_body">
				<nav theme="catalogue_nav" aria-label="Components">
					<ul theme="catalogue_list">
						{sections.map(({ example }) => (
							<li><a theme="catalogue_link" href={`#${example.name}`}>{example.name}</a></li>
						))}
					</ul>
				</nav>

				<main theme="catalogue_main">
					{sections.map(({ example, open }) => (
						<section theme="catalogue_section" id={example.name}>
							{/* A quiet summary: the header is a heading in a list of headings, and the
							    filled `button` look turns the page into a stack of black bars. */}
							<DropDown label={example.name} type="quiet" open={open} id={`panel-${example.name}`}>
								<div theme="catalogue_panes">
									<Pane name={example.name} mode="light" values={light} show={example.Example} />
									<Pane name={example.name} mode="dark" values={dark} show={example.Example} />
								</div>
							</DropDown>
						</section>
					))}
				</main>
			</div>
		</div>
	</Icons>
);
