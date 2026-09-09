// Button: every type, both icon positions, the shapes, and the size axis.
//
// The icons are named `lucide:name`, which the build turns into an import of that one icon
// (design 141). The stack ships no drawings of its own (design 144).

import { mutable } from '@aweftjs/core';
import { Button, Icon, h } from '@aweftjs/ui';

import { ids } from '../example.ts';
import type { ExampleComponent } from '../example.ts';

export const name = 'Button';
export const order = 10;

export const Example: ExampleComponent = (props) => {
	const at = ids(props.mode);
	const busy = mutable(false);

	return (
		<div theme="column">
			<p theme={['text', 'sm', 'muted']}>Types</p>
			<div theme={['row', 'wrap']}>
				<Button label="Save changes" id={at('button')} />
				<Button label="Cancel" type="quiet" id={at('button-quiet')} />
				<Button label="Delete" type="danger" id={at('button-danger')} />
				<Button label="Off" disabled={true} id={at('button-disabled')} />
				<Button label="Working" loading={busy} id={at('button-loading')} />
				<Button label="Docs" href="https://example.com/docs" type="quiet" id={at('button-link')} />
			</div>

			<p theme={['text', 'sm', 'muted']}>With an icon, and the two shapes</p>
			<div theme={['row', 'wrap']}>
				<Button label="Search" icon={<Icon name="lucide:search" />} id={at('button-icon')} />
				<Button label="More" icon={<Icon name="lucide:chevron-down" />} iconPosition="right" id={at('button-icon-right')} />
				<Button icon={<Icon name="lucide:x" label="Dismiss" />} round={true} id={at('button-round')} />
				<p theme="text">
					A sentence with <Button label="a button in it" type="quiet" inline={true} id={at('button-inline')} /> reading as text.
				</p>
			</div>

			<p theme={['text', 'sm', 'muted']}>Sizes</p>
			<div theme={['row', 'wrap']}>
				<Button label="Small" size="sm" id={at('button-sm')} />
				<Button label="Default" id={at('button-md')} />
				<Button label="Large" size="lg" id={at('button-lg')} />
				<Button icon={<Icon name="lucide:search" label="Find" />} size="icon-sm" id={at('square-sm')} />
				<Button icon={<Icon name="lucide:search" label="Find" />} size="icon" id={at('square-md')} />
				<Button icon={<Icon name="lucide:search" label="Find" />} size="icon-lg" id={at('square-lg')} />
			</div>

			<p theme={['text', 'sm', 'muted']}>A promise the handler returns disables it while it is out</p>
			<div theme="row">
				<Button label="Start" type="quiet" id={at('button-toggle-busy')}
					onClick={() => { busy.set(!busy.get()); }} />
			</div>
		</div>
	);
};
