// InputGroup: text addons, an icon, a button, the three sizes, and a field in error.

import { mutable } from '@aweftjs/core';
import { Button, Icon, InputGroup, h } from '@aweftjs/ui';

import { ids } from '../example.ts';
import type { ExampleComponent } from '../example.ts';

export const name = 'InputGroup';
export const order = 72;

export const Example: ExampleComponent = (props) => {
	const at = ids(props.mode);
	const price = mutable('12.00');
	const query = mutable('');

	return (
		<div theme="column">
			<InputGroup label="Price" leading="$" trailing="CAD" value={price} id={at('inputgroup')} />

			<InputGroup
				label="Search"
				placeholder="Anything"
				leading={<Icon name="lucide:search" />}
				trailing={<Button icon={<Icon name="lucide:x" label="Clear" />} type="quiet" size="icon-sm"
					onClick={() => { query.set(''); }} />}
				value={query}
				id={at('inputgroup-search')}
			/>

			<InputGroup label="Website" leading="https://" description="Without the protocol"
				id={at('inputgroup-described')} />

			<InputGroup label="Amount" leading="$" error="that is more than you have"
				id={at('inputgroup-invalid')} />

			<p theme={['text', 'sm', 'muted']}>Sizes</p>
			<InputGroup label="Small" leading="$" size="sm" id={at('inputgroup-sm')} />
			<InputGroup label="Default" leading="$" id={at('inputgroup-md')} />
			<InputGroup label="Large" leading="$" size="lg" id={at('inputgroup-lg')} />

			<InputGroup label="Off" leading="$" disabled={true} id={at('inputgroup-disabled')} />
		</div>
	);
};
