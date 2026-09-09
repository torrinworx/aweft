// ToggleGroup: a row of choices drawn as one control, on real radios and real checkboxes. The
// arrows and Space are the platform's, because the inputs are real and only off the screen
// (design 202).

import { mutable } from '@aweftjs/core';
import { ToggleGroup, h } from '@aweftjs/ui';

import { ids } from '../example.ts';
import type { ExampleComponent } from '../example.ts';

export const name = 'ToggleGroup';
export const order = 15;

export const Example: ExampleComponent = (props) => {
	const at = ids(props.mode);
	const align = mutable('centre');
	const days = mutable(['Tue']);
	const size = mutable('sm');
	const off = mutable('one');

	return (
		<div theme="column">
			<p theme={['text', 'sm', 'muted']}>One choice, on radios</p>
			<ToggleGroup id={at('togglegroup')} label="Alignment" value={align}
				options={['left', 'centre', 'right']} />
			<p theme={['text', 'sm']} id={at('togglegroup-value')}>{align}</p>

			<p theme={['text', 'sm', 'muted']}>More than one, on checkboxes</p>
			<ToggleGroup id={at('togglegroup-many')} label="Days" value={days} multiple={true}
				options={['Mon', 'Tue', 'Wed', 'Thu', 'Fri']} />

			<p theme={['text', 'sm', 'muted']}>Small, quiet, and with its own words per option</p>
			<ToggleGroup id={at('togglegroup-small')} label="Size" value={size} size="sm" type="quiet"
				options={['sm', 'md', 'lg']} display={['Small', 'Medium', 'Large']} />

			<p theme={['text', 'sm', 'muted']}>Large, and one nobody can touch</p>
			<ToggleGroup id={at('togglegroup-large')} label="Weight" value={mutable('bold')} size="lg"
				options={['regular', 'bold']} />
			<ToggleGroup id={at('togglegroup-off')} label="Locked" value={off} disabled={true}
				options={['one', 'two']} />
		</div>
	);
};
