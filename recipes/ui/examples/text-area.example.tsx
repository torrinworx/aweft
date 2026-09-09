// TextArea: the same words as a text field, and a box that grows to what is typed into it.

import { mutable } from '@aweftjs/core';
import { TextArea, h } from '@aweftjs/ui';

import { ids } from '../example.ts';
import type { ExampleComponent } from '../example.ts';

export const name = 'TextArea';
export const order = 12;

export const Example: ExampleComponent = (props) => {
	const at = ids(props.mode);
	const notes = mutable('');

	return (
		<div theme="column">
			<TextArea label="Notes" value={notes} description="It grows to what you type." id={at('area')} />
			<TextArea label="Capped" maxHeight="120px" id={at('area-capped')} />
			<TextArea label="Locked" disabled={true} id={at('area-disabled')} />

			<p theme={['text', 'sm', 'muted']}>Sizes</p>
			<TextArea placeholder="Small" size="sm" aria-label="Small area" id={at('area-sm')} />
			<TextArea placeholder="Large" size="lg" aria-label="Large area" id={at('area-lg')} />
		</div>
	);
};
