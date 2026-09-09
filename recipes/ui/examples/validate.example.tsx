// Validate: a form that checks itself. Nothing is wrong until the signal says the person is done,
// and the context above the checks is the form's own answer.

import { mutable } from '@aweftjs/core';
import { Button, TextField, Validate, ValidateContext, h } from '@aweftjs/ui';

import { ids } from '../example.ts';
import type { ExampleComponent } from '../example.ts';

export const name = 'Validate';
export const order = 40;

export const Example: ExampleComponent = (props) => {
	const at = ids(props.mode);
	const email = mutable('');
	const phone = mutable('');
	const submitted = mutable(false);
	const allValid = mutable(true);

	return (
		<div theme="column">
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
	);
};
