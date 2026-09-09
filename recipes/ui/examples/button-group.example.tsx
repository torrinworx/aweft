// ButtonGroup: a row of buttons drawn as one control, and the same run down the page.
//
// Each button carries its own size: a size on the group would have to say the size axis again on
// the group's children (design 200).

import { Button, ButtonGroup, Icon, h } from '@aweftjs/ui';

import { ids } from '../example.ts';
import type { ExampleComponent } from '../example.ts';

export const name = 'ButtonGroup';
export const order = 70;

export const Example: ExampleComponent = (props) => {
	const at = ids(props.mode);

	return (
		<div theme="column">
			<p theme={['text', 'sm', 'muted']}>Across the page</p>
			<ButtonGroup label="Alignment" id={at('buttongroup')}>
				<Button label="Left" type="quiet" id={at('buttongroup-left')} />
				<Button label="Centre" type="quiet" id={at('buttongroup-middle')} />
				<Button label="Right" type="quiet" id={at('buttongroup-right')} />
			</ButtonGroup>

			<p theme={['text', 'sm', 'muted']}>Icons only, at the small size</p>
			<ButtonGroup label="Text style" id={at('buttongroup-icons')}>
				<Button icon={<Icon name="lucide:chevron-left" label="Back" />} type="quiet" size="icon-sm" />
				<Button icon={<Icon name="lucide:chevron-right" label="Forward" />} type="quiet" size="icon-sm" />
			</ButtonGroup>

			<p theme={['text', 'sm', 'muted']}>Down the page</p>
			<ButtonGroup label="Sort" vertical={true} id={at('buttongroup-vertical')}>
				<Button label="Newest" type="quiet" />
				<Button label="Oldest" type="quiet" />
			</ButtonGroup>
		</div>
	);
};
