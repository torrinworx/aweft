// DropDown: a native `<details>` whose summary wears the button theme, so the keyboard, the role
// and the expanded state are the platform's. It opens in the page's flow, not over it.

import { mutable } from '@aweftjs/core';
import { DropDown, Icon, Paper, h } from '@aweftjs/ui';

import { ids } from '../example.ts';
import type { ExampleComponent } from '../example.ts';

export const name = 'DropDown';
export const order = 43;

export const Example: ExampleComponent = (props) => {
	const at = ids(props.mode);
	const filters = mutable(false);

	return (
		<div theme="column">
			<DropDown label="Filters" open={filters} id={at('dropdown')}>
				<Paper>
					<p theme={['text', 'sm']} id={at('dropdown-content')}>Everything under the summary.</p>
				</Paper>
			</DropDown>

			<DropDown label="Open already" open={mutable(true)} id={at('dropdown-open')}>
				<p theme={['text', 'sm']}>A section that starts open.</p>
			</DropDown>

			<DropDown label="Locked" disabled={true} id={at('dropdown-disabled')}>
				<p theme={['text', 'sm']}>Nothing opens this.</p>
			</DropDown>

			<DropDown
				label="Its own two icons"
				arrow="left"
				iconOpen={<Icon name="lucide:minus" />}
				iconClose={<Icon name="lucide:plus" />}
				id={at('dropdown-icons')}
			>
				<p theme={['text', 'sm']}>A plus that becomes a minus, on the other side.</p>
			</DropDown>
		</div>
	);
};
