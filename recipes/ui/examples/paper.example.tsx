// Paper: a raised block, and the same block with its padding taken off so a header or a table can
// reach the edge.

import { Paper, h } from '@aweftjs/ui';

import { ids } from '../example.ts';
import type { ExampleComponent } from '../example.ts';

export const name = 'Paper';
export const order = 18;

export const Example: ExampleComponent = (props) => {
	const at = ids(props.mode);

	return (
		<div theme="column">
			<Paper id={at('paper')}>
				<p theme={['text', 'lg']}>A card</p>
				<p theme={['text', 'muted']}>A raised block is told apart by its tint and its line.</p>
			</Paper>
			<Paper tight={true} id={at('paper-tight')}>
				<p theme={['text', 'sm', 'muted']}>Tight: nothing between the edge and what is in it.</p>
			</Paper>
			<hr theme="divider" id={at('divider')} />
			<div theme={['row', 'spread']} id={at('spread')}>
				<span theme={['text', 'sm']}>left</span>
				<span theme={['text', 'sm']}>right</span>
			</div>
		</div>
	);
};
