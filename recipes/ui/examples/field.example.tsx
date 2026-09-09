// Laying a form out: the theme entries, with no component between the page and them (design 209).
//
// A control still labels itself, so `label`, `description` and `error` stay where they are; what
// these entries do is the column, the row, the row-at-a-width and the fieldset around them.
//
// `responsive` is measured against the group around it, which is the only thing here that declares
// itself a container.

import { mutable } from '@aweftjs/core';
import { Checkbox, TextField, h } from '@aweftjs/ui';

import { ids } from '../example.ts';
import type { ExampleComponent } from '../example.ts';

export const name = 'Form';
export const order = 30;

export const Example: ExampleComponent = (props) => {
	const at = ids(props.mode);
	const street = mutable('');
	const post = mutable(false);
	const notes = mutable('');

	return (
		<div theme="column">
			<div theme="field_group" id={at('form')}>
				<fieldset theme="field_set" id={at('fieldset')}>
					<legend theme="field_legend">Where to send it</legend>
					<div theme={['field', 'responsive']} id={at('field-responsive')}>
						<label for={at('street')} theme="field_label">Street</label>
						<TextField id={at('street')} value={street} placeholder="12 Somewhere Ave" />
					</div>
					<div theme={['field', 'inline']} id={at('field-inline')}>
						<Checkbox id={at('post')} value={post} />
						<label for={at('post')} theme="field_label">Post it rather than email it</label>
					</div>
				</fieldset>

				<TextField label="Notes" value={notes} description="Anything else" />

				<TextField label="Email" value={mutable('not an address')}
					error="That does not look like an address." />
			</div>
		</div>
	);
};
