// Progress: a value that moves, an indeterminate bar, and the three thicknesses.

import { mutable } from '@aweftjs/core';
import { Button, Progress, h } from '@aweftjs/ui';

import { ids } from '../example.ts';
import type { ExampleComponent } from '../example.ts';

export const name = 'Progress';
export const order = 65;

export const Example: ExampleComponent = (props) => {
	const at = ids(props.mode);
	const done = mutable(0.5);

	return (
		<div theme="column">
			<Progress value={done} label="Uploading" id={at('progress')} />
			<div theme="row">
				<Button label="Less" type="quiet" size="sm" id={at('progress-less')}
					onClick={() => { done.set(Math.max(0, done.get() - 0.25)); }} />
				<Button label="More" type="quiet" size="sm" id={at('progress-more')}
					onClick={() => { done.set(Math.min(1, done.get() + 0.25)); }} />
			</div>

			<p theme={['text', 'sm', 'muted']}>No value at all, which the platform draws as waiting</p>
			<Progress label="Working" id={at('progress-waiting')} />

			<p theme={['text', 'sm', 'muted']}>Sizes</p>
			<Progress value={0.4} label="Small" size="sm" id={at('progress-sm')} />
			<Progress value={0.4} label="Default" id={at('progress-md')} />
			<Progress value={0.4} label="Large" size="lg" id={at('progress-lg')} />
		</div>
	);
};
