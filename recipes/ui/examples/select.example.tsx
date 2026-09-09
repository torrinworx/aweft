// Select: a real `<select>` in a wrapper that carries its own arrow, drawn in CSS so a page with
// no icon pack still has one (design 195).

import { mutable } from '@aweftjs/core';
import { Select, h } from '@aweftjs/ui';

import { ids } from '../example.ts';
import type { ExampleComponent } from '../example.ts';

export const name = 'Select';
export const order = 17;

export const Example: ExampleComponent = (props) => {
	const at = ids(props.mode);
	const visibility = mutable<unknown>(null);

	return (
		<div theme="column">
			<Select
				label="Visibility"
				value={visibility}
				options={[{ key: 'private' }, { key: 'public' }]}
				display={(row: { key: string }) => row.key}
				placeholder="Pick one"
				id={at('select')}
			/>
			<Select label="Owner" value={mutable('rita')} options={['rita', 'devlin']} id={at('select-chosen')} />
			<Select label="Locked" options={['a', 'b']} disabled={true} id={at('select-disabled')} />

			<p theme={['text', 'sm', 'muted']}>Sizes</p>
			<Select options={['a', 'b']} size="sm" aria-label="Small select" id={at('select-sm')} />
			<Select options={['a', 'b']} aria-label="Default select" id={at('select-md')} />
			<Select options={['a', 'b']} size="lg" aria-label="Large select" id={at('select-lg')} />
		</div>
	);
};
