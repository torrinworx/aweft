// Alert: the two types, with and without an icon, and with and without a body.

import { Alert, Icon, h } from '@aweftjs/ui';

import { ids } from '../example.ts';
import type { ExampleComponent } from '../example.ts';

export const name = 'Alert';
export const order = 60;

export const Example: ExampleComponent = (props) => {
	const at = ids(props.mode);

	return (
		<div theme="column">
			<Alert title="Saved" icon={<Icon name="lucide:check" />} id={at('alert')}>
				Everything went through.
			</Alert>

			<Alert type="danger" title="Nothing was saved" icon={<Icon name="lucide:x" />} id={at('alert-danger')}>
				The server refused the write. Try again in a moment.
			</Alert>

			<Alert title="No icon here" id={at('alert-bare')}>
				With nothing in the first column the box is one column wide, so the text is not indented
				past a gap beside an empty track.
			</Alert>

			<Alert icon={<Icon name="lucide:info" />} id={at('alert-title-only')}>
				A body on its own, with no heading above it.
			</Alert>
		</div>
	);
};
