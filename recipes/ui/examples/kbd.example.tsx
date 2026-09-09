// Kbd: single keys, and a chord written as keys with a word between them.

import { Kbd, h } from '@aweftjs/ui';

import { ids } from '../example.ts';
import type { ExampleComponent } from '../example.ts';

export const name = 'Kbd';
export const order = 64;

export const Example: ExampleComponent = (props) => {
	const at = ids(props.mode);

	return (
		<div theme="column">
			<div theme={['row', 'wrap']}>
				<Kbd label="Esc" id={at('kbd')} />
				<Kbd label="Tab" id={at('kbd-tab')} />
				<Kbd label="K" id={at('kbd-letter')} />
			</div>
			<p theme="text">
				Press <Kbd label="Ctrl" id={at('kbd-ctrl')} /> and <Kbd label="K" id={at('kbd-k')} /> to search.
			</p>
		</div>
	);
};
