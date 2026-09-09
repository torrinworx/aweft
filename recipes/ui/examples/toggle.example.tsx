// Toggle: a checkbox that reads as a switch, in its states and at each size.

import { mutable } from '@aweftjs/core';
import { Toggle, h } from '@aweftjs/ui';

import { ids } from '../example.ts';
import type { ExampleComponent } from '../example.ts';

export const name = 'Toggle';
export const order = 15;

export const Example: ExampleComponent = (props) => {
	const at = ids(props.mode);
	const emails = mutable(false);

	return (
		<div theme="column">
			<Toggle label="Email me" value={emails} id={at('toggle')} />
			<Toggle label="On" value={mutable(true)} id={at('toggle-on')} />
			<Toggle label="Locked" disabled={true} id={at('toggle-disabled')} />
			<Toggle label="Notes" description="Once a week, at most." id={at('toggle-described')} />

			<p theme={['text', 'sm', 'muted']}>Sizes</p>
			<div theme={['row', 'wrap']}>
				<Toggle size="sm" aria-label="Small switch" id={at('toggle-sm')} />
				<Toggle aria-label="Default switch" id={at('toggle-md')} />
				<Toggle size="lg" aria-label="Large switch" id={at('toggle-lg')} />
			</div>
		</div>
	);
};
