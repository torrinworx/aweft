// ColorPicker: real range inputs and a swatch, with and without the alpha channel.

import { mutable } from '@aweftjs/core';
import { ColorPicker, h } from '@aweftjs/ui';

import { ids } from '../example.ts';
import type { ExampleComponent } from '../example.ts';

export const name = 'ColorPicker';
export const order = 45;

export const Example: ExampleComponent = (props) => {
	const at = ids(props.mode);
	const picked = mutable('#1b6ef3');

	return (
		<div theme="column">
			<p theme={['text', 'sm', 'muted']}>Three sliders, because there is no alpha</p>
			<ColorPicker value={picked} hasAlpha={false} id={at('picker')} />
			<span theme={['text', 'sm', 'muted']} id={at('picked')}>{picked}</span>

			<p theme={['text', 'sm', 'muted']}>Four, with it</p>
			<ColorPicker value={mutable('rgba(27, 110, 243, 0.5)')} id={at('picker-alpha')} />

			<ColorPicker value={mutable('#1b6ef3')} disabled={true} id={at('picker-disabled')} />
		</div>
	);
};
