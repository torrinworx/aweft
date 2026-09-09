// Icon: one `<svg>` built from icon data, named two ways.
//
// A `lucide:name` is rewritten by the build into an import of that one icon, so it is in the
// bundle and needs nothing at run time (design 141). A bare name is looked up in the sets the page
// put on `Icons`, which is how a component that asks for `chevron-down` by name finds one. The
// stack ships no drawings of its own (design 144).

import { Icon, h } from '@aweftjs/ui';

import { ids } from '../example.ts';
import type { ExampleComponent } from '../example.ts';

export const name = 'Icon';
export const order = 20;

export const Example: ExampleComponent = (props) => {
	const at = ids(props.mode);

	return (
		<div theme="column">
			<p theme={['text', 'sm', 'muted']}>Named by the build, one import each</p>
			<div theme="row" id={at('icons')}>
				<Icon name="lucide:check" label="done" id={at('icon-check')} />
				<Icon name="lucide:x" label="not done" />
				<Icon name="lucide:triangle-alert" label="careful" />
				<Icon name="lucide:chevron-right" label="next" />
			</div>

			<p theme={['text', 'sm', 'muted']}>Named at run time, out of the set this page installed</p>
			<div theme="row" id={at('icons-named')}>
				<Icon name="chevron-down" label="open" id={at('icon-named')} />
				<Icon name="upload" label="upload" />
				<Icon name="search" label="find" />
			</div>

			<p theme={['text', 'sm', 'muted']}>Sizes, and a quarter turn</p>
			<div theme="row">
				<Icon name="lucide:search" label="find, small" />
				<Icon name="lucide:search" size="2rem" label="find, big" id={at('icon-big')} />
				<Icon name="lucide:chevron-right" rot={90} label="turned a quarter" id={at('icon-rot')} />
				<Icon name="lucide:chevron-right" rot={180} label="turned back" />
			</div>
		</div>
	);
};
