// Breadcrumb: where a page sits, as a trail of plain links. Plain is the point: a router takes an
// anchor with no target of its own, so the trail navigates with nothing written here (design 201).

import { Breadcrumb, h } from '@aweftjs/ui';

import { ids } from '../example.ts';
import type { ExampleComponent } from '../example.ts';

export const name = 'Breadcrumb';
export const order = 80;

export const Example: ExampleComponent = (props) => {
	const at = ids(props.mode);

	return (
		<div theme="column">
			<p theme={['text', 'sm', 'muted']}>Three levels, the last one where you are</p>
			<Breadcrumb
				id={at('breadcrumb')}
				items={[
					{ label: 'Home', href: '/' },
					{ label: 'Files', href: '/files' },
					{ label: 'shot.png' },
				]}
			/>

			<p theme={['text', 'sm', 'muted']}>One level, and a nav named something else</p>
			<Breadcrumb id={at('breadcrumb-one')} label="Where you are" items={[{ label: 'Home' }]} />

			<p theme={['text', 'sm', 'muted']}>A long trail, which wraps rather than pushing the page</p>
			<Breadcrumb
				id={at('breadcrumb-long')}
				items={[
					{ label: 'Home', href: '/' },
					{ label: 'Projects', href: '/projects' },
					{ label: 'The one with the long name', href: '/projects/1' },
					{ label: 'Settings', href: '/projects/1/settings' },
					{ label: 'Members' },
				]}
			/>
		</div>
	);
};
