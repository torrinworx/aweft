// Card: the head, the body and the foot, and the same block with none of the three, which is the
// bare block it always was (design 211).

import { Button, Card, h } from '@aweftjs/ui';

import { ids } from '../example.ts';
import type { ExampleComponent } from '../example.ts';

export const name = 'Card';
export const order = 71;

export const Example: ExampleComponent = (props) => {
	const at = ids(props.mode);

	return (
		<div theme="column">
			<Card
				title="Today"
				description="What is due before the end of the day"
				foot={<Button label="Add one" type="quiet" size="sm" id={at('card-add')} />}
				id={at('card')}
			>
				<p theme="text">Nothing yet.</p>
			</Card>

			<Card title="No foot on this one" id={at('card-plain')}>
				<p theme={['text', 'sm', 'muted']}>Each part renders only where it was given something.</p>
			</Card>

			<Card id={at('paper')}>
				<p theme={['text', 'lg']}>A bare block</p>
				<p theme={['text', 'muted']}>With no title, no description and no foot, it is the block
					and its children.</p>
			</Card>
			<Card tight={true} id={at('paper-tight')}>
				<p theme={['text', 'sm', 'muted']}>Tight: nothing between the edge and what is in it.</p>
			</Card>
			<hr theme="divider" id={at('divider')} />
			<div theme={['row', 'spread']} id={at('spread')}>
				<span theme={['text', 'sm']}>left</span>
				<span theme={['text', 'sm']}>right</span>
			</div>
		</div>
	);
};
