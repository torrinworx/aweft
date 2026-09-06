// The gallery: every system `@aweftjs/ui` ships this step, in each of its states.
//
// One file, written the way an application writes one: JSX, a theme defined at import, cells for
// every piece of state, and no imperative handle anywhere. It is the page `main.ts` builds and
// drives, and the page `npx vite recipes/ui` serves.

import { mutable, mutableArray } from '@aweftjs/core';
import {
	Detached, LoaderContext, PopupContext, Shown, Switch, Theme, ThemeContext,
	h, mark, suspend,
} from '@aweftjs/ui';

Theme.define({
	'*': { $brand: '#1b6ef3', $paper: '#ffffff', $edge: '#d8dbe2' },

	page: {
		fontFamily: 'system-ui, sans-serif',
		maxWidth: 720,
		margin: '40px auto',
		padding: 24,
		display: 'flex',
		flexDirection: 'column',
		gap: 24,
	},
	section: { display: 'flex', flexDirection: 'column', gap: 8 },
	heading: { fontSize: 18, margin: 0 },

	// One entry, three states, and the states are written where they belong rather than in the
	// component. `demo_hovered` reaches an element themed `demo primary hovered` too.
	demo: {
		padding: '8px 14px',
		borderRadius: 6,
		border: '1px solid $edge',
		background: '$brand',
		color: '$contrast_text($brand)',
		cursor: 'pointer',
		_cssProp_focusVisible: { outline: '3px solid $hue($brand, 180)', outlineOffset: 2 },
	},
	demo_hovered: { background: '$shiftBrightness($brand, -0.12)' },
	demo_quiet: { background: 'transparent', color: '$brand' },

	tile: { background: '$paper', border: '1px solid $edge', borderRadius: 6, padding: 12 },
	menu: { background: '$paper', border: '1px solid $edge', borderRadius: 6, padding: 8, minWidth: 160 },

	// A function defined by this page, used by the entry below it. Theme functions are theme data,
	// so a page can add one and a nested theme can replace it.
	sized: {
		$em: (args: string[]) => `${Number(args[0]) * 16}px`,
		fontSize: '$em(1.25)',
	},
});

const Spinner = (): unknown => <span id="spinner">loading…</span>;
const Broken = (props: { error?: unknown }): unknown => <span id="failed">{String(props.error)}</span>;

const Slow = suspend(Spinner, async () => {
	await new Promise((resolve) => setTimeout(resolve, 30));
	return <span id="arrived">the slow part arrived</span>;
});

const Failing = suspend(Spinner, async () => { throw new Error('the loader said no'); }, Broken);

const Row = (props: { each?: unknown }): unknown => <li theme="tile">{props.each as string}</li>;

/** A component that takes its `h` from the cascade, so everything it themes inherits the prefix. */
const Card = ThemeContext.use((themed) => (props: { children?: unknown[] }) =>
	themed('div', { theme: 'tile', id: 'card' }, ...(props.children ?? [])));

export const App = (): unknown => {
	const clicks = mutable(0);
	const hovered = mutable(false);
	const focused = mutable(false);
	const typed = mutable('');
	const open = mutable(false);
	const shown = mutable(true);
	const stage = mutable<'one' | 'two'>('one');
	const rows = mutableArray(['first', 'second']);

	return (
		<PopupContext>
			<main theme="page" id="page">
				<section theme="section">
					<h1 theme="heading">Gallery</h1>
					<p theme="sized" id="sized">A theme function this page defined.</p>
				</section>

				<section theme="section">
					<h2 theme="heading">Theme, state and events</h2>
					<button
						id="counter"
						theme={['demo', hovered.bool('hovered', null)]}
						isHovered={hovered}
						isFocused={focused}
						onClick={() => clicks.set(clicks.get() + 1)}
					>
						clicked {clicks} times
					</button>
					<button id="quiet" theme="demo_quiet">quiet</button>
					<p id="focus-state">{focused.bool('focused', 'not focused')}</p>
					<input
						id="field"
						$value={typed}
						onInput={(event: { target: { value: string } }) => typed.set(event.target.value)}
					/>
					<p id="typed">{typed}</p>
				</section>

				<section theme="section">
					<h2 theme="heading">Nested themes</h2>
					<div theme="tile" id="outer-tile">outer</div>
					<Theme value={{ tile: { background: '#fdf3d8' } }}>
						<div theme="tile" id="inner-tile">inner</div>
					</Theme>
					<ThemeContext value="brand">
						<Card>a card built through the cascade</Card>
					</ThemeContext>
				</section>

				<section theme="section">
					<h2 theme="heading">Control flow</h2>
					<button id="toggle" theme="demo" onClick={() => shown.set(!shown.get())}>toggle</button>
					<Shown value={shown}>
						<p id="then">shown</p>
						<mark.else><p id="else">hidden</p></mark.else>
					</Shown>
					<button id="switch" theme="demo" onClick={() => stage.set(stage.get() === 'one' ? 'two' : 'one')}>
						switch
					</button>
					<Switch value={stage}>
						<mark.case value="one"><p id="case-one">case one</p></mark.case>
						<mark.case value="two"><p id="case-two">case two</p></mark.case>
						<mark.default><p id="case-none">nothing</p></mark.default>
					</Switch>
					<ul id="rows"><Row each={rows} /></ul>
					<button id="add-row" theme="demo" onClick={() => rows.push(`row ${rows.length + 1}`)}>add a row</button>
				</section>

				<section theme="section">
					<h2 theme="heading">A popup</h2>
					<Detached enabled={open}>
						<button id="anchor" theme="demo" onClick={() => open.set(!open.get())}>open the menu</button>
						<mark.popup>
							<div id="menu" theme="menu">
								<p>one</p>
								<p>two</p>
							</div>
						</mark.popup>
					</Detached>
				</section>

				<section theme="section">
					<h2 theme="heading">Loading, and failing to</h2>
					<LoaderContext value={{ loading: Spinner }}>
						<p><Slow /></p>
						<p><Failing /></p>
					</LoaderContext>
				</section>
			</main>
		</PopupContext>
	);
};
