// Field, FieldGroup and FieldSet: layout and nothing else (design 196). A control still labels
// itself, so nothing here can disagree with one about what a label is.
//
// `responsive` is measured against the group around it, which is the only thing here that declares
// itself a container.

import { mutable } from '@aweftjs/core';
import { Checkbox, Field, FieldGroup, FieldSet, TextField, h } from '@aweftjs/ui';

import { ids } from '../example.ts';
import type { ExampleComponent } from '../example.ts';

export const name = 'Field';
export const order = 30;

export const Example: ExampleComponent = (props) => {
	const at = ids(props.mode);
	const street = mutable('');
	const post = mutable(false);
	const notes = mutable('');

	return (
		<div theme="column">
			<FieldGroup id={at('form')}>
				<FieldSet legend="Where to send it" id={at('fieldset')}>
					<Field orientation="responsive" id={at('field-responsive')}>
						<label for={at('street')} theme="field_label">Street</label>
						<TextField id={at('street')} value={street} placeholder="12 Somewhere Ave" />
					</Field>
					<Field orientation="inline" id={at('field-inline')}>
						<Checkbox id={at('post')} value={post} />
						<label for={at('post')} theme="field_label">Post it rather than email it</label>
					</Field>
				</FieldSet>

				<Field id={at('field-column')}>
					<TextField label="Notes" value={notes} description="Anything else" />
				</Field>

				<Field id={at('field-bad')}>
					<TextField label="Email" value={mutable('not an address')}
						error="That does not look like an address." />
				</Field>
			</FieldGroup>
		</div>
	);
};
