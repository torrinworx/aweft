// The controls, in both modes, on one page.
//
// Every control here is written the way an application writes one: the component, a cell, and a
// theme entry the library already ships. Nothing on this page draws a control out of `div`s,
// because there is nothing here that has to.
//
// The icons are named `lucide:name`, which the build turns into an import of that one icon
// (design 141). The stack ships no drawings of its own (design 144).

import { mutable } from '@aweftjs/core';
import {
	Button, Checkbox, Icon, LoadingDots, Paper, Radio, Select, Slider, TextArea, TextField,
	Theme, Toggle, dark, h, light,
} from '@aweftjs/ui';
import type { Definitions } from '@aweftjs/ui';

Theme.define({
	// How wide a pane is is this page's layout choice, so it gets a name of its own.
	'*': { $paneWidth: '480px' },

	gallery: {
		display: 'flex',
		flexWrap: 'wrap',
		gap: '$space6',
		padding: '$space6',
		alignItems: 'flex-start',
		fontFamily: '$font',
		background: '$background',
		color: '$foreground',
	},
	pane: {
		flex: '1 1 $paneWidth',
		minWidth: '$paneWidth',
		display: 'flex',
		flexDirection: 'column',
		gap: '$space6',
		padding: '$space6',
		borderRadius: '$radiusLg',
		background: '$background',
		color: '$foreground',
		border: '$borderWidth solid $border',
	},
	heading: { flexBasis: '100%', margin: 0 },
	group: { display: 'flex', flexDirection: 'column', gap: '$space3' },
});

const SIZES = ['small', 'medium', 'large'];

/** One pane: every control, in whichever mode the provider above it says. */
const Controls = (props: { mode?: unknown }): unknown => {
	const mode = String(props.mode ?? 'light');
	const at = (name: string): string => `${name}-${mode}`;

	const name = mutable('');
	const notes = mutable('');
	const remember = mutable(false);
	const emails = mutable(false);
	const size = mutable('medium');
	const volume = mutable(4);
	const visibility = mutable<unknown>(null);
	const busy = mutable(false);
	const bad = mutable<string | null>(null);

	return (
		<section theme="pane" id={at('pane')}>
			<h2 theme={['text', 'xl']}>{`${mode} mode`}</h2>

			<div theme="group">
				<p theme={['text', 'sm', 'muted']}>Buttons</p>
				<div theme={['row', 'wrap']}>
					<Button label="Save changes" id={at('button')} />
					<Button label="Cancel" type="quiet" id={at('button-quiet')} />
					<Button label="Delete" type="danger" id={at('button-danger')} />
					<Button label="Off" disabled={true} id={at('button-disabled')} />
					<Button label="Working" loading={busy} id={at('button-loading')} />
					<Button label="Docs" href="https://example.com/docs" type="quiet" id={at('button-link')} />
					<Button label="Search" icon={<Icon name="lucide:search" />} id={at('button-icon')} />
					<Button label="More" icon={<Icon name="lucide:chevron-down" />} iconPosition="right" id={at('button-icon-right')} />
				</div>
				<div theme="row">
					<Button label="Start" onClick={() => { busy.set(!busy.get()); }} id={at('button-toggle-busy')} type="quiet" />
					<LoadingDots id={at('dots')} />
				</div>
			</div>

			<div theme="group">
				<p theme={['text', 'sm', 'muted']}>Text</p>
				<TextField label="Project name" value={name} placeholder="Something short" id={at('field')} />
				<TextField label="Password" password={true} id={at('field-password')} />
				<TextField label="Email" error={bad} value={mutable('not an address')} id={at('field-invalid')} />
				<TextField label="Locked" disabled={true} id={at('field-disabled')} />
				<TextArea label="Notes" value={notes} description="It grows to what you type." id={at('area')} />
			</div>

			<div theme="group">
				<p theme={['text', 'sm', 'muted']}>Choices</p>
				<Checkbox label="Remember me" value={remember} id={at('checkbox')} />
				<Checkbox label="Locked" disabled={true} id={at('checkbox-disabled')} />
				<Toggle label="Email me" value={emails} id={at('toggle')} />
				<fieldset theme={['column', 'tight']} id={at('radios')}>
					<legend theme={['text', 'sm']}>Size</legend>
					{SIZES.map((option) => (
						<Radio label={option} value={size} option={option} id={at(`radio-${option}`)} />
					))}
				</fieldset>
				<Select
					label="Visibility"
					value={visibility}
					options={[{ key: 'private' }, { key: 'public' }]}
					display={(row: { key: string }) => row.key}
					placeholder="Pick one"
					id={at('select')}
				/>
				<Slider label="Volume" value={volume} min={0} max={10} id={at('slider')} />
			</div>

			<div theme="group">
				<p theme={['text', 'sm', 'muted']}>Blocks and icons</p>
				<Paper id={at('paper')}>
					<p theme={['text', 'lg']}>A card</p>
					<p theme={['text', 'muted']}>A raised block is told apart by its tint and its line.</p>
				</Paper>
				<div theme="row" id={at('icons')}>
					<Icon name="lucide:check" label="done" id={at('icon-check')} />
					<Icon name="lucide:x" label="not done" />
					<Icon name="lucide:triangle-alert" label="careful" />
					<Icon name="lucide:chevron-right" label="next" />
					<Icon name="lucide:search" size="2rem" label="find" id={at('icon-big')} />
				</div>
				<hr theme="divider" id={at('divider')} />
				<div theme={['row', 'spread']} id={at('spread')}>
					<span theme={['text', 'sm']}>left</span>
					<span theme={['text', 'sm']}>right</span>
				</div>
			</div>

			<Button
				label={bad.bool('Clear the error', 'Show an error')}
				type="quiet"
				id={at('toggle-error')}
				onClick={() => { bad.set(bad.get() === null ? 'That does not look like an address.' : null); }}
			/>
		</section>
	);
};

const Pane = (props: { mode?: unknown; values?: unknown }): unknown =>
	h(Theme, { value: props.values as Definitions }, h(Controls, { mode: props.mode }));

export const Gallery = (): unknown => (
	<main theme="gallery" id="controls">
		<h1 theme={['text', '2xl', 'heading']} id="controls-title">The controls</h1>
		<Pane mode="light" values={light} />
		<Pane mode="dark" values={dark} />
	</main>
);
