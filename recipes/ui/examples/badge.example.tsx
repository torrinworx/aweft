// Badge: every type, both sizes, and one with an icon in front of the label.

import { Badge, Icon, h } from '@aweftjs/ui';

import { ids } from '../example.ts';
import type { ExampleComponent } from '../example.ts';

export const name = 'Badge';
export const order = 62;

export const Example: ExampleComponent = (props) => {
	const at = ids(props.mode);

	return (
		<div theme="column">
			<p theme={['text', 'sm', 'muted']}>Types</p>
			<div theme={['row', 'wrap']}>
				<Badge label="New" id={at('badge')} />
				<Badge label="Draft" type="quiet" id={at('badge-quiet')} />
				<Badge label="3 failed" type="danger" id={at('badge-danger')} />
				<Badge label="Beta" type="outline" id={at('badge-outline')} />
			</div>

			<p theme={['text', 'sm', 'muted']}>With an icon, and the two sizes</p>
			<div theme={['row', 'wrap']}>
				<Badge label="Verified" icon={<Icon name="lucide:check" />} id={at('badge-icon')} />
				<Badge label="Small" size="sm" id={at('badge-sm')} />
				<Badge label="Default" id={at('badge-md')} />
				<Badge label="Large" size="lg" id={at('badge-lg')} />
			</div>

			<p theme="text">
				A sentence with a <Badge label="tag" type="quiet" size="sm" id={at('badge-inline')} /> in it.
			</p>
		</div>
	);
};
