// Modal: an act on a stage, inside a native `<dialog>`. Opening one is the stage's job, because
// that is what makes the back button close it (design 134), so the example brings its own stage.

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

	const Nothing = (): unknown => null;

	const Opener = StageContext.use((stage: StageValue | null) => (): unknown =>
		h(Button, {
			label: 'Edit the thing',
			id: at('open-modal'),
			onClick: () => { stage?.open({ name: 'edit', template: Titled }); },
		}));

	return (
		<div theme="column">
			<StageContext acts={{ '': Nothing, edit: Editor }} initial="" template={Default}>
				<Opener />
				<Stage />
			</StageContext>
		</div>
	);
};
