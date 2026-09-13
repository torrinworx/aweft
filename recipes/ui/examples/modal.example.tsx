// Modal: an act on a stage, inside a native `<dialog>`. Opening one is the stage's job, because
// that is what makes the back button close it (design 134), so the example brings its own stage.
//
// The dialog is named at the call: the props an `open` carries past `name`, `template`, `history`
// and `children` reach the template as well as the act (design 213), so `Modal` goes in as the
// template itself rather than inside a closure written per open. `Modal` reads the ones it names
// and writes none of the others on the element.
//
// A sheet is this same component with `type="sheet"`, so it is shown here rather than in a section
// of its own: there is no `Sheet` export to name one after (design 202).

import {
	Button, Default, Head, Meta, Modal, Stage, StageContext, TextField, h,
} from '@aweftjs/ui';
import type { StageValue } from '@aweftjs/ui';

import { ids } from '../example.ts';
import type { ExampleComponent } from '../example.ts';

export const name = 'Modal';
export const order = 41;

export const Example: ExampleComponent = (props) => {
	const at = ids(props.mode);

	// The two dialogs are acts, and every declared act is a page to a static walk; the head says
	// they are not to be found, as `@aweftjs/ssg`'s README asks of a dialog.
	const Editor = (): unknown => (
		<div theme="column">
			<Head><Meta name="robots" content="noindex" /></Head>
			<p theme="text" id={at('editing')}>Editing, in a modal the stage opened.</p>
			<TextField label="Title" id={at('modal-field')} />
		</div>
	);

	const Filters = (): unknown => (
		<div theme="column">
			<Head><Meta name="robots" content="noindex" /></Head>
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
				onClick={() => {
					// Nothing here but what the Modal and the act read: a prop this open carried
					// would reach both, and the Modal writes none of them on the element (design 213).
					stage?.open({ name: 'edit', template: Modal, label: 'Edit the thing' });
				}}
			/>
			<Button
				label="Open a sheet"
				type="quiet"
				id={at('open-sheet')}
				onClick={() => {
					// The same component against an edge. `side` is read for no other type (design 202).
					stage?.open({
						name: 'filters', template: Modal, label: 'Filters',
						type: 'sheet', side: 'right',
					});
				}}
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
