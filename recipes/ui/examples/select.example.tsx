// Select: a button and the list this package draws under it, on every host (design 224). The
// chevron is still CSS, so a page with no icon pack has one (design 195).
//
// The open one is opened by the button beside it rather than shipped open: the list is a fixed box
// in the top layer, and one left open would sit over the rest of the page.

import { mutable } from '@aweftjs/core';
import { Button, Select, h } from '@aweftjs/ui';

import { ids } from '../example.ts';
import type { ExampleComponent } from '../example.ts';

export const name = 'Select';
export const order = 17;

export const Example: ExampleComponent = (props) => {
	const at = ids(props.mode);
	const visibility = mutable<unknown>(null);
	const open = mutable(false);
	const fruit = mutable<unknown>('Banana');

	return (
		<div theme="column">
			<Select
				label="Visibility"
				value={visibility}
				options={[{ key: 'private' }, { key: 'public' }]}
				display={(row: { key: string }) => row.key}
				placeholder="Pick one"
				name="visibility"
				id={at('select')}
			/>

			<div theme={['row', 'start']}>
				<Select
					label="Fruit"
					value={fruit}
					open={open}
					options={['Apple', 'Apricot', 'Banana', 'Cherry']}
					id={at('select-open')}
				/>
				{/* Opens it and nothing else: a mousedown anywhere but the control and the list is
				    what closes one, so a button that toggled would close it and open it again. */}
				<Button
					label="Open the list"
					type="quiet"
					id={at('select-toggle')}
					onClick={() => { open.set(true); }}
				/>
			</div>

			<Select label="Owner" value={mutable('alex')} options={['alex', 'sam']} id={at('select-chosen')} />
			<Select label="Locked" options={['a', 'b']} disabled={true} id={at('select-disabled')} />
			<Select
				label="Region"
				options={['east', 'west']}
				error="Pick the region the account is in"
				id={at('select-error')}
			/>

			<p theme={['text', 'sm', 'muted']}>Sizes</p>
			<Select options={['a', 'b']} size="sm" aria-label="Small select" id={at('select-sm')} />
			<Select options={['a', 'b']} aria-label="Default select" id={at('select-md')} />
			<Select options={['a', 'b']} size="lg" aria-label="Large select" id={at('select-lg')} />
		</div>
	);
};
