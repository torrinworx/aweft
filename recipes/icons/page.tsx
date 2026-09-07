// A page that names icons the three ways there are.
//
// Nothing here draws an icon. The stack ships no drawings (design 144), so every glyph on this
// page comes from the set the recipe installed, and the three ways differ in when the drawing is
// decided: at build time, at import time, or when the page runs.

import { mutable } from '@aweftjs/core';
import { Button, Icon, Icons, Paper, Theme, h, light } from '@aweftjs/ui';
import standard from '@aweftjs/icons/lucide/+standard';

Theme.define({
	page: {
		display: 'flex',
		flexDirection: 'column',
		gap: '$space5',
		padding: '$space6',
		fontFamily: '$font',
		background: '$background',
		color: '$foreground',
	},
	strip: { display: 'flex', alignItems: 'center', gap: '$space4' },
});

/** The name the run-time lookup asks for. A variable, so the build cannot see it. */
const LATE = 'lucide:anchor';

/** The icon the bundle must not carry, so the check that it does not is checking something. */
export const unnamed = LATE;

export interface PageProps {
	/**
	 * Where the late name is answered from: `fromUrl` over the icon route in a browser, and the
	 * icons a server already resolved when a page it rendered is being taken over.
	 */
	readonly icons?: unknown;
}

export const Page = (props: PageProps): unknown => {
	const late = mutable<unknown>(LATE);

	return (
		<main theme="page" id="page">
			<h1 theme={['text', '2xl', 'heading']} id="title">Three ways to name an icon</h1>

			{/* One: written out, so the build imports that one icon and nothing else. */}
			<Paper id="named">
				<p theme={['text', 'sm', 'muted']}>Named in the source</p>
				<div theme="strip">
					<Icon name="lucide:check" label="done" id="icon-named" />
					<Icon name="lucide:star" size="2rem" label="starred" id="icon-named-big" />
				</div>
			</Paper>

			{/* Two: a standard name, answered by whatever pack the page put in front. */}
			<Icons value={standard}>
				<Paper id="standard">
					<p theme={['text', 'sm', 'muted']}>A standard name, from the set's standard selection</p>
					<div theme="strip">
						<Button label="More" icon={<Icon name="chevron-down" />} id="button-standard" />
						<Icon name="triangle-alert" label="careful" id="icon-standard" />
					</div>
				</Paper>
			</Icons>

			{/* Three: a name the page only has when it runs, fetched from the icon route. */}
			<Icons value={props.icons}>
				<Paper id="fetched">
					<p theme={['text', 'sm', 'muted']}>Fetched by name when the page runs</p>
					<div theme="strip"><Icon name={late} label="anchor" id="icon-fetched" /></div>
				</Paper>
			</Icons>
		</main>
	);
};

/** The page inside the theme it is drawn in, which is what both the browser and Node mount. */
export const Site = (props: PageProps): unknown => h(Theme, { value: light }, h(Page, { icons: props.icons }));
