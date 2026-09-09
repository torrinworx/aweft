// Slider: a real range input, its thumb and track drawn from the theme, at each size.

import { mutable } from '@aweftjs/core';
import { Slider, h } from '@aweftjs/ui';

import { ids } from '../example.ts';
import type { ExampleComponent } from '../example.ts';

export const name = 'Slider';
export const order = 16;

export const Example: ExampleComponent = (props) => {
	const at = ids(props.mode);
	const volume = mutable(4);

	return (
		<div theme="column">
			<Slider label="Volume" value={volume} min={0} max={10} id={at('slider')} />
			<p theme={['text', 'sm', 'muted']}>{volume}</p>
			<Slider label="Steps of ten" value={mutable(50)} min={0} max={100} step={10} id={at('slider-step')} />
			<Slider label="Locked" disabled={true} id={at('slider-disabled')} />

			<p theme={['text', 'sm', 'muted']}>Sizes</p>
			<Slider size="sm" aria-label="Small slider" id={at('slider-sm')} />
			<Slider aria-label="Default slider" id={at('slider-md')} />
			<Slider size="lg" aria-label="Large slider" id={at('slider-lg')} />
		</div>
	);
};
