// LoadingDots: three dots that say something is happening, at whatever size the text around them is.

import { LoadingDots, h } from '@aweftjs/ui';

import { ids } from '../example.ts';
import type { ExampleComponent } from '../example.ts';

export const name = 'LoadingDots';
export const order = 19;

export const Example: ExampleComponent = (props) => {
	const at = ids(props.mode);

	return (
		<div theme="column">
			<div theme="row">
				<LoadingDots id={at('dots')} />
				<span theme={['text', 'sm', 'muted']}>the default</span>
			</div>
			<div theme="row">
				<LoadingDots size="0.5rem" id={at('dots-big')} />
				<span theme={['text', 'sm', 'muted']}>a size of its own</span>
			</div>
			<div theme="row">
				<LoadingDots label="Saving your work" id={at('dots-labelled')} />
				<span theme={['text', 'sm', 'muted']}>with a name a screen reader reads</span>
			</div>
		</div>
	);
};
