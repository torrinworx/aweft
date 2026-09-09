// Tabs: one set of panels with one showing, and the strip that picks between them (design 203).
// The arrows move the selection as well as the focus, so a person holding Right sees each panel in
// turn.

import { mutable } from '@aweftjs/core';
import { Tab, TabPanel, Tabs, h, mark } from '@aweftjs/ui';

import { ids } from '../example.ts';
import type { ExampleComponent } from '../example.ts';

export const name = 'Tabs';
export const order = 82;

export const Example: ExampleComponent = (props) => {
	const at = ids(props.mode);
	const view = mutable('all');
	const step = mutable('two');

	return (
		<div theme="column">
			<p theme={['text', 'sm', 'muted']}>The filled strip, with one tab nobody can choose</p>
			<Tabs
				id={at('tabs')}
				label="Views"
				value={view}
				tabs={[
					{ value: 'all', label: 'All', content: <p theme={['text', 'sm']}>Everything there is.</p> },
					{ value: 'mine', label: 'Mine', content: <p theme={['text', 'sm']}>The ones I own.</p> },
					{ value: 'gone', label: 'Deleted', disabled: true, content: <p theme={['text', 'sm']}>The bin.</p> },
				]}
			/>
			<p theme={['text', 'sm']} id={at('tabs-value')}>{view}</p>

			<p theme={['text', 'sm', 'muted']}>The line type, small</p>
			<Tabs
				id={at('tabs-line')}
				label="Steps"
				type="line"
				size="sm"
				value={step}
				tabs={[
					{ value: 'one', label: 'Details', content: <p theme={['text', 'sm']}>Who it is for.</p> },
					{ value: 'two', label: 'Address', content: <p theme={['text', 'sm']}>Where it goes.</p> },
					{ value: 'three', label: 'Payment', content: <p theme={['text', 'sm']}>How it is paid.</p> },
				]}
			/>

			<p theme={['text', 'sm', 'muted']}>Large, standing on its side, and written out by hand</p>
			<Tabs id={at('tabs-vertical')} label="Sections" orientation="vertical" size="lg">
				<mark.tabs>
					<Tab value="left" label="Left" />
					<Tab value="right" label="Right" />
				</mark.tabs>
				<mark.panels>
					<TabPanel value="left"><p theme={['text', 'sm']}>The first panel.</p></TabPanel>
					<TabPanel value="right"><p theme={['text', 'sm']}>The second panel.</p></TabPanel>
				</mark.panels>
			</Tabs>
		</div>
	);
};
