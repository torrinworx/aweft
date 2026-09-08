// The look, in both modes, on one page.
//
// Every specimen is written the way an application writes one: a `theme` prop naming an entry the
// library already ships, and no value of its own. The two panes are the same markup under two
// providers, so anything that differs between them comes from the roles.

import { mutable } from '@aweftjs/core';
import { Theme, Typography, dark, h, light } from '@aweftjs/ui';
import type { Definitions } from '@aweftjs/ui';

Theme.define({
	// How wide a pane is is this page's layout choice, so it gets a name of its own. That is the
	// escape hatch the rule leaves open: a value with a name is a value anyone can find again.
	'*': { $paneWidth: '520px' },

	preview: {
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
	row: { display: 'flex', flexWrap: 'wrap', gap: '$space2', alignItems: 'center' },
	swatches: { display: 'flex', gap: '$space', flexWrap: 'wrap' },
	swatch: {
		width: '$space8',
		height: '$space6',
		borderRadius: '$radius',
		border: '$borderWidth solid $border',
	},
	swatch_background: { background: '$background' },
	swatch_surface: { background: '$surface' },
	swatch_muted: { background: '$muted' },
	swatch_accentSubtle: { background: '$accentSubtle' },
	swatch_accent: { background: '$accent' },
	swatch_dangerSubtle: { background: '$dangerSubtle' },
	swatch_danger: { background: '$danger' },
	field: { display: 'flex', flexDirection: 'column', gap: '$space' },
});

const SWATCHES = ['background', 'surface', 'muted', 'accentSubtle', 'accent', 'dangerSubtle', 'danger'];

/** One pane: the whole specimen set, in whichever mode the provider above it says. */
const Specimens = (props: { mode?: unknown }): unknown => {
	const mode = String(props.mode ?? 'light');
	const hovered = mutable(false);
	const pressed = mutable(false);

	return (
		<section theme="pane" id={`pane-${mode}`}>
			<h2 theme={['text', 'xl']} id={`title-${mode}`}>{`${mode} mode`}</h2>

			<div theme="group">
				<p theme={['text', 'sm', 'muted']}>The roles, as fills</p>
				<div theme="swatches">
					{SWATCHES.map((name) => (
						<span theme={['swatch', name]} id={`swatch-${mode}-${name}`} title={name} />
					))}
				</div>
			</div>

			<div theme="group">
				<p theme={['text', 'sm', 'muted']}>Buttons</p>
				<div theme="row">
					<button
						theme={['button', hovered.bool('hovered', null), pressed.bool('pressed', null)]}
						id={`button-${mode}`}
						isHovered={hovered}
						isClicked={pressed}
					>
						Save changes
					</button>
					<button theme={['button', 'quiet']} id={`button-quiet-${mode}`}>Cancel</button>
					<button theme={['button', 'danger']} id={`button-danger-${mode}`}>Delete</button>
					<button theme={['button', 'disabled']} id={`button-disabled-${mode}`} disabled="">Disabled</button>
				</div>
			</div>

			<div theme="group">
				<p theme={['text', 'sm', 'muted']}>Fields</p>
				<div theme="field">
					<label theme={['text', 'sm']} for={`input-${mode}`}>Project name</label>
					<input theme="input" id={`input-${mode}`} placeholder="Something short" />
				</div>
				<div theme="field">
					<label theme={['text', 'sm']} for={`select-${mode}`}>Visibility</label>
					<select theme="select" id={`select-${mode}`}>
						<option>Private</option>
						<option>Public</option>
					</select>
				</div>
				<div theme="field">
					<label theme={['text', 'sm']} for={`invalid-${mode}`}>Email</label>
					<input
						theme={['input', 'invalid']}
						id={`invalid-${mode}`}
						value="not an address"
						aria-invalid="true"
						aria-describedby={`invalid-why-${mode}`}
					/>
					<span theme={['text', 'xs', 'muted']} id={`invalid-why-${mode}`}>
						That does not look like an address.
					</span>
				</div>
			</div>

			<div theme="group">
				<p theme={['text', 'sm', 'muted']}>Card and popup</p>
				<div theme="card" id={`card-${mode}`}>
					<p theme={['text', 'lg']}>A card</p>
					<p theme={['text', 'muted']}>A raised block is told apart by its tint and its line.</p>
				</div>
				<div theme="popup" id={`popup-${mode}`}>
					<p theme={['text', 'sm']}>Rename</p>
					<p theme={['text', 'sm']}>Duplicate</p>
				</div>
			</div>

			<div theme="group">
				<p theme={['text', 'sm', 'muted']}>Type</p>
				<p theme={['text', '2xl']}>Two extra large</p>
				<p theme={['text', 'xl']}>One extra large</p>
				<p theme={['text', 'lg']}>Large</p>
				<p theme="text" id={`body-${mode}`}>Body text, one rem, with the line height that belongs to it.</p>
				<p theme={['text', 'sm']}>Small</p>
				<p theme={['text', 'xs', 'muted']}>Extra small, quiet</p>
				<p theme={['text', 'sm', 'mono']}>monospace 0123456789</p>
			</div>

			<div theme="group">
				<p theme={['text', 'sm', 'muted']}>Type, as a component</p>
				{/* The pane's own title is the `h2` above, so the specimens start at `h3` and the two
				    levels over them wear their look on a paragraph. That is what `element` is for:
				    the look of a heading where the page's outline wants a different level. */}
				<Typography type="h1" element={<p />} id={`type-h1-${mode}`} label="Heading one" />
				<Typography type="h2" element={<p />} id={`type-h2-${mode}`} label="Heading two" />
				<Typography type="h2_bold" element={<p />} id={`type-h2-bold-${mode}`} label="Heading two, bold" />
				<Typography type="h3" id={`type-h3-${mode}`} label="Heading three" />
				<Typography type="h4" id={`type-h4-${mode}`} label="Heading four" />
				<Typography type="h5" id={`type-h5-${mode}`} label="Heading five" />
				<Typography type="h6" id={`type-h6-${mode}`} label="Heading six" />
				<Typography type="p1" id={`type-p1-${mode}`} label="Body copy at one rem, with the line height that belongs to it." />
				<Typography type="p2" id={`type-p2-${mode}`} label="The smaller body size." />
				<Typography type="p1_bold" label="Bold" />
				<Typography type="p1_italic" label="Italic" />
				<Typography type="p1_center" label="Centred" />
				<Typography type="p1_muted" label="Quiet" />
				<Typography type="p2">
					{/* `sm` is a span at the paragraph's size. A `p2` here would put a paragraph
					    inside a paragraph, which a browser closes early and a hydration then
					    pairs against a different tree. */}
					An <Typography type="sm_inline_bold" id={`type-inline-${mode}`} label="inline run" /> inside a line of text.
				</Typography>
			</div>
		</section>
	);
};

const Pane = (props: { mode?: unknown; values?: unknown }): unknown =>
	h(Theme, { value: props.values as Definitions }, h(Specimens, { mode: props.mode }));

export const Preview = (): unknown => (
	<main theme="preview" id="preview">
		<h1 theme={['text', '2xl', 'heading']} id="preview-title">The look</h1>
		<Pane mode="light" values={light} />
		<Pane mode="dark" values={dark} />
	</main>
);
