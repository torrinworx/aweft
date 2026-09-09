// Popup: something floating over the page, anchored to what opened it.
//
// `Detached` is what measures the anchor, scores the placements and picks one; `Popup` is what puts
// the element in the sink a `PopupContext` renders at the end of its own subtree. There is no
// z-index in any of it: the box asks the host for the top layer with `popover`.

import { mutable } from '@aweftjs/core';
import { Button, Detached, Paper, h, mark } from '@aweftjs/ui';

import { ids } from '../example.ts';
import type { ExampleComponent } from '../example.ts';

export const name = 'Popup';
export const order = 46;

export const Example: ExampleComponent = (props) => {
	const at = ids(props.mode);
	const open = mutable(false);

	return (
		<div theme="column">
			<div theme="row">
				<Detached enabled={open}>
					<Button label="Open the menu" id={at('popup-anchor')}
						onClick={() => { open.set(!open.get()); }} />
					<mark.popup>
						<Paper id={at('popup-menu')}>
							<p theme={['text', 'sm']}>Rename</p>
							<p theme={['text', 'sm']}>Duplicate</p>
						</Paper>
					</mark.popup>
				</Detached>
			</div>
			<p theme={['text', 'sm', 'muted']}>It closes when the anchor moves, on the reading that the page scrolled.</p>
		</div>
	);
};
