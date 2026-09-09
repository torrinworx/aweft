// Radio: a group of them sharing one cell, and the size axis. The dot is drawn in CSS on the
// native input (design 195).

import { mutable } from '@aweftjs/core';
import { Radio, h } from '@aweftjs/ui';

import { ids } from '../example.ts';
import type { ExampleComponent } from '../example.ts';

export const name = 'Radio';
export const order = 14;

const SIZES = ['small', 'medium', 'large'];

export const Example: ExampleComponent = (props) => {
	const at = ids(props.mode);
	const size = mutable('medium');

	return (
		<div theme="column">
			<fieldset theme={['column', 'tight']} id={at('radios')}>
				<legend theme={['text', 'sm']}>Size</legend>
				{SIZES.map((option) => (
					<Radio label={option} value={size} option={option} id={at(`radio-${option}`)} />
				))}
			</fieldset>
			<Radio label="Locked" option="locked" disabled={true} id={at('radio-disabled')} />

			<p theme={['text', 'sm', 'muted']}>Sizes</p>
			<Radio label="Small" size="sm" option="a" id={at('radio-sm')} />
			<Radio label="Default" option="b" id={at('radio-md')} />
			<Radio label="Large" size="lg" option="c" id={at('radio-lg')} />
		</div>
	);
};
