// Modal: an act on a stage, inside a native `<dialog>`. Opening one is the stage's job, because
// that is what makes the back button close it (design 134), so the example brings its own stage.
//
// A sheet is this same component with `type="sheet"`, so it is shown here rather than in a section
// of its own: there is no `Sheet` export to name one after (design 202).

import {
	Button, Default, Modal, Stage, StageContext, TextField, h,
} from '@aweftjs/ui';
import type { StageValue } from '@aweftjs/ui';

import { ids } from '../example.ts';
import type { ExampleComponent } from '../example.ts';

export const name = 'Modal';
export const order = 41;

export const Example: ExampleComponent = (props) => {
	const at = ids(props.mode);

	const Editor = (): unknown => (
		<div theme="column">
			<p theme="text" id={at('editing')}>Editing, in a modal the stage opened.</p>
			<TextField label="Title" id={at('modal-field')} />
		</div>
	);

	const Titled = (inner: { children?: unknown[] }): unknown =>
		h(Modal, { label: 'Edit the thing', id: at('modal') }, ...(inner.children ?? []));

	// The same component against an edge. `side` is read for no other type (design 202).
	const Sheet = (inner: { children?: unknown[] }): unknown =>
		h(Modal, { label: 'Filters', type: 'sheet', side: 'right', id: at('sheet') },
			...(inner.children ?? []));

	const Filters = (): unknown => (
		<div theme="column">
			<p theme="text" id={at('filtering')}>A sheet: the same dialog, against the right edge.</p>
			<TextField label="Contains" id={at('sheet-field')} />
		</div>
	);

	const Nothing = (): unknown => null;

	const Opener = StageContext.use((stage: StageValue | null) => (): unknown => (
		<div theme="row">
			<Button
				label="Edit the thing"
				id={at('open-modal')}
				onClick={() => { stage?.open({ name: 'edit', template: Titled }); }}
			/>
			<Button
				label="Open a sheet"
				type="quiet"
				id={at('open-sheet')}
				onClick={() => { stage?.open({ name: 'filters', template: Sheet }); }}
			/>
		</div>
	));

	return (
		<div theme="column">
			<StageContext acts={{ '': Nothing, edit: Editor, filters: Filters }} initial="" template={Default}>
				<Opener />
				<Stage />
			</StageContext>
		</div>
	);
};
