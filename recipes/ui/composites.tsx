// The composites, in both modes, on one page.
//
// Every one of them is written the way an application writes one: the component, a cell, and a
// theme entry the library already ships. The modal is opened through the stage, because that is the
// only way to open one and it is what makes back close it.
//
// These components ask for icons by name and the stack ships no drawings (design 144), so the page
// answers them once, at the top, from an installed set.

import { mutable, mutableArray } from '@aweftjs/core';
import {
	Button, ColorPicker, Default, DropDown, FileDrop, Icons, Modal, Paper, PopupContext, Stage,
	StageContext, TextField, Theme, Tooltip, Validate, ValidateContext, dark, h, light,
} from '@aweftjs/ui';
import type { Definitions, StageValue } from '@aweftjs/ui';
import standard from '@aweftjs/icons/lucide/+standard';

Theme.define({
	// How wide a pane is is this page's layout choice, so it gets a name of its own.
	'*': { $composWidth: '520px' },

	composites: {
		display: 'flex',
		flexWrap: 'wrap',
		gap: '$space6',
		padding: '$space6',
		alignItems: 'flex-start',
		fontFamily: '$font',
		background: '$background',
		color: '$foreground',
	},
	composites_pane: {
		flex: '1 1 $composWidth',
		minWidth: '$composWidth',
		display: 'flex',
		flexDirection: 'column',
		gap: '$space6',
		padding: '$space6',
		borderRadius: '$radiusLg',
		background: '$background',
		color: '$foreground',
		border: '$borderWidth solid $border',
	},
	composites_title: { flexBasis: '100%', margin: 0 },
	composites_group: { display: 'flex', flexDirection: 'column', gap: '$space3' },
});

/** One pane's own components and cells, built per mode so the two panes share nothing. */
const paneFor = (mode: string): { Panel: () => unknown } => {
	const at = (name: string): string => `${name}-${mode}`;

	const openFilters = mutable(false);
	const files = mutableArray();
	const ready = mutable<unknown>(null);
	const own = mutableArray();
	const email = mutable('');
	const phone = mutable('');
	const submitted = mutable(false);
	const allValid = mutable(true);
	const picked = mutable('#1b6ef3');
	const tipShown = mutable(false);

	const Editor = (): unknown => (
		<div theme={['composites', 'group']}>
			<p theme="text" id={at('editing')}>Editing, in a modal the stage opened.</p>
			<TextField label="Title" id={at('modal-field')} />
		</div>
	);

	const Titled = (props: { children?: unknown[] }): unknown =>
		h(Modal, { label: 'Edit the thing', id: at('modal') }, ...(props.children ?? []));

	// The stage holds the modal and nothing else: an act is what a modal is (design 134), and the
	// rest of the pane is the page under it.
	const Nothing = (): unknown => null;
	const Opener = StageContext.use((stage: StageValue | null) => (): unknown =>
		h(Button, {
			label: 'Edit the thing',
			id: at('open-modal'),
			onClick: () => { stage?.open({ name: 'edit', template: Titled }); },
		}));

	// The stage is around the tip rather than beside it: a `Detached` mounts its anchor where it was
	// written, so a stage that holds one can still swap acts (design 153).
	const Panel = (): unknown => {
		return (
			<section theme={['composites', 'pane']} id={at('pane')}>
				<h2 theme={['text', 'xl']}>{`${mode} mode`}</h2>

				<StageContext acts={{ '': Nothing, edit: Editor }} initial="" template={Default}>
					<div theme={['composites', 'group']}>
						<p theme={['text', 'sm', 'muted']}>A modal, on the stage</p>
						<Opener />
						<Stage />
					</div>

					<div theme={['composites', 'group']}>
						<p theme={['text', 'sm', 'muted']}>A tip, on hover and on focus</p>
						<div theme="row">
							<Tooltip label="This cannot be undone." enabled={tipShown}>
								<Button label="Delete" type="danger" id={at('tip-anchor')} />
							</Tooltip>
							<Button label="Show the tip" type="quiet" id={at('tip-toggle')}
								onClick={() => { tipShown.set(!tipShown.get()); }} />
						</div>
					</div>
				</StageContext>

				<div theme={['composites', 'group']}>
					<p theme={['text', 'sm', 'muted']}>A disclosure</p>
					<DropDown label="Filters" open={openFilters} id={at('dropdown')}>
						<Paper>
							<p theme={['text', 'sm']} id={at('dropdown-content')}>Everything under the summary.</p>
						</Paper>
					</DropDown>
					<DropDown label="Locked" disabled={true} id={at('dropdown-disabled')}>
						<p theme={['text', 'sm']}>Nothing opens this.</p>
					</DropDown>
				</div>

				<div theme={['composites', 'group']}>
					<p theme={['text', 'sm', 'muted']}>Files</p>
					<FileDrop files={files} ready={ready} extensions={['image/png', 'image/jpeg']}
						limit={4000000} id={at('filedrop')} />
					<FileDrop files={own} multiple={false} id={at('filedrop-own')}>
						<p theme={['text', 'sm']}>One file, and chrome of this page's own.</p>
						<FileDrop.Button label="Choose a file" type="quiet" id={at('filedrop-button')} />
					</FileDrop>
				</div>

				<div theme={['composites', 'group']}>
					<p theme={['text', 'sm', 'muted']}>A form that checks itself</p>
					<ValidateContext value={allValid}>
						<Validate value={email} validate="email" signal={submitted}>
							<TextField label="Email" value={email} id={at('validate-email')} />
						</Validate>
						<Validate value={phone} validate="phone" signal={submitted}>
							<TextField label="Phone" value={phone} id={at('validate-phone')} />
						</Validate>
					</ValidateContext>
					<div theme="row">
						<Button label="Submit" id={at('submit')} onClick={() => { submitted.set(true); }} />
						<span theme={['text', 'sm', 'muted']} id={at('valid')}>
							{allValid.map((ok) => (ok ? 'the form is happy' : 'the form is not happy'))}
						</span>
					</div>
				</div>

				<div theme={['composites', 'group']}>
					<p theme={['text', 'sm', 'muted']}>A colour</p>
					<ColorPicker value={picked} hasAlpha={false} id={at('picker')} />
					<ColorPicker value={mutable('rgba(27, 110, 243, 0.5)')} id={at('picker-alpha')} />
					<span theme={['text', 'sm', 'muted']} id={at('picked')}>{picked}</span>
				</div>
			</section>
		);
	};

	return { Panel };
};

const Pane = (props: { mode?: unknown; values?: unknown }): unknown => {
	const mode = String(props.mode ?? 'light');
	const { Panel } = paneFor(mode);
	return h(Theme, { value: props.values as Definitions }, h(PopupContext, {}, h(Panel, {})));
};

export const Gallery = (): unknown => (
	<Icons value={standard}>
		<main theme="composites" id="composites">
			<h1 theme={['text', '2xl', 'composites', 'title']} id="composites-heading">The composites</h1>
			<Pane mode="light" values={light} />
			<Pane mode="dark" values={dark} />
		</main>
	</Icons>
);
