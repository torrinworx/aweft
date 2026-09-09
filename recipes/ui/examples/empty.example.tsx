// Empty: everything it takes, and the same thing with only a title.

import { Button, Empty, Icon, h } from '@aweftjs/ui';

import { ids } from '../example.ts';
import type { ExampleComponent } from '../example.ts';

export const name = 'Empty';
export const order = 63;

export const Example: ExampleComponent = (props) => {
	const at = ids(props.mode);

	return (
		<div theme="column">
			<Empty
				icon={<Icon name="lucide:inbox" />}
				title="No messages"
				description="Anything sent to this address will show up here."
				id={at('empty')}
			>
				<Button label="Refresh" type="quiet" size="sm" id={at('empty-refresh')} />
			</Empty>

			<Empty title="Nothing to see" id={at('empty-bare')} />
		</div>
	);
};
