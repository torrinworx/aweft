// Card: the head, the body and the foot, and the same block with only a body.

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
		</div>
	);
};
