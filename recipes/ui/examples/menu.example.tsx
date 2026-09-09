// Menu: a button and the actions it opens (design 225), on the same keyboard map a Select uses.
//
// It is shipped closed for the reason the Select example gives: the list is a fixed box in the top
// layer, and one left open would sit over the rest of the page.

import { mutable } from '@aweftjs/core';
import { Menu, h } from '@aweftjs/ui';

import { ids } from '../example.ts';
import type { ExampleComponent } from '../example.ts';

export const name = 'Menu';
export const order = 47;

export const Example: ExampleComponent = (props) => {
	const at = ids(props.mode);
	const done = mutable('nothing yet');

	return (
		<div theme="column">
			<div theme={['row', 'start']}>
				<Menu
					id={at('menu')}
					label="Quick Actions"
					items={[{
						heading: 'Conversation',
						items: [
							{ label: 'Mute Conversation', onSelect: () => { done.set('muted'); } },
							{ label: 'Mark as Read', onSelect: () => { done.set('marked as read'); } },
							{ label: 'Block User', onSelect: () => { done.set('blocked'); } },
							{
								label: 'Delete Conversation',
								type: 'danger',
								onSelect: () => { done.set('deleted'); },
							},
						],
					}]}
				/>
				<Menu
					id={at('menu-quiet')}
					label="Sort"
					type="quiet"
					size="sm"
					items={[
						{ label: 'Newest first' },
						{ label: 'Oldest first' },
						{ label: 'Unread only', disabled: true },
					]}
				/>
			</div>
			<p theme={['text', 'sm', 'muted']} id={at('menu-done')}>{done}</p>
		</div>
	);
};
