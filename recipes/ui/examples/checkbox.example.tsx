// Checkbox: checked, the third state, disabled, and the size axis. The tick is drawn in CSS on the
// native input (design 195), so nothing here asks for an icon.

import { mutable } from '@aweftjs/core';
import { Checkbox, h } from '@aweftjs/ui';

import { ids } from '../example.ts';
import type { ExampleComponent } from '../example.ts';

export const name = 'Checkbox';
export const order = 13;

export const Example: ExampleComponent = (props) => {
	const at = ids(props.mode);
	const remember = mutable(false);
	const some = mutable(false);

	return (
		<div theme="column">
			<Checkbox label="Remember me" value={remember} id={at('checkbox')} />
			<Checkbox label="Checked" value={mutable(true)} id={at('checkbox-checked')} />
			<Checkbox label="Some of them" value={some} indeterminate={true} id={at('checkbox-indeterminate')} />
			<Checkbox label="Locked" disabled={true} id={at('checkbox-disabled')} />
			<Checkbox label="Words first" invert={true} id={at('checkbox-invert')} />

			<p theme={['text', 'sm', 'muted']}>Sizes</p>
			<Checkbox label="Small" size="sm" id={at('checkbox-sm')} />
			<Checkbox label="Default" id={at('checkbox-md')} />
			<Checkbox label="Large" size="lg" id={at('checkbox-lg')} />
		</div>
	);
};
