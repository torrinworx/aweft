// TextField: the words around it, the states it can be in, and the size axis.

import { mutable } from '@aweftjs/core';
import { Button, TextField, h } from '@aweftjs/ui';

import { ids } from '../example.ts';
import type { ExampleComponent } from '../example.ts';

export const name = 'TextField';
export const order = 11;

export const Example: ExampleComponent = (props) => {
	const at = ids(props.mode);
	const project = mutable('');
	const bad = mutable<string | null>(null);

	return (
		<div theme="column">
			<TextField label="Project name" value={project} placeholder="Something short" id={at('field')} />
			<TextField label="Work address" description="We only write when something breaks." id={at('field-described')} />
			<TextField label="Password" password={true} id={at('field-password')} />
			<TextField label="Email" error={bad} value={mutable('not an address')} id={at('field-invalid')} />
			<TextField label="Locked" disabled={true} id={at('field-disabled')} />

			<p theme={['text', 'sm', 'muted']}>Sizes</p>
			<TextField placeholder="Small" size="sm" aria-label="Small field" id={at('field-sm')} />
			<TextField placeholder="Default" aria-label="Default field" id={at('field-md')} />
			<TextField placeholder="Large" size="lg" aria-label="Large field" id={at('field-lg')} />

			<Button
				label={bad.bool('Clear the error', 'Show an error')}
				type="quiet"
				id={at('toggle-error')}
				onClick={() => { bad.set(bad.get() === null ? 'That does not look like an address.' : null); }}
			/>
		</div>
	);
};
