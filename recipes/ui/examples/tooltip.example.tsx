// Tooltip: a hint on hover and on focus, placed against whatever it wraps.

import { mutable } from '@aweftjs/core';
import { Button, Tooltip, h } from '@aweftjs/ui';

import { ids } from '../example.ts';
import type { ExampleComponent } from '../example.ts';

export const name = 'Tooltip';
export const order = 42;

export const Example: ExampleComponent = (props) => {
	const at = ids(props.mode);
	const shown = mutable(false);

	return (
		<div theme="column">
			<div theme="row">
				<Tooltip label="This cannot be undone." enabled={shown}>
					<Button label="Delete" type="danger" id={at('tip-anchor')} />
				</Tooltip>
				<Button label="Show the tip" type="quiet" id={at('tip-toggle')}
					onClick={() => { shown.set(!shown.get()); }} />
			</div>
			<div theme="row">
				<Tooltip label="Above it, because that is where the room is." locations={['above']}>
					<Button label="Placed above" type="quiet" id={at('tip-above')} />
				</Tooltip>
			</div>
		</div>
	);
};
