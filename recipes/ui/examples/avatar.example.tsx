// Avatar: a picture that loads, letters with no picture at all, the three sizes, and the square.
//
// The picture is a data URL, so the example needs nothing from the network.

import { Avatar, h } from '@aweftjs/ui';

import { ids } from '../example.ts';
import type { ExampleComponent } from '../example.ts';

export const name = 'Avatar';
export const order = 61;

// One flat colour, small enough to sit in the source: a 2 by 2 PNG.
const picture = 'data:image/png;base64,'
	+ 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mNk+M/wn4GBgYEJTAAAKgQDAX'
	+ 'oCLW8AAAAASUVORK5CYII=';

export const Example: ExampleComponent = (props) => {
	const at = ids(props.mode);

	return (
		<div theme="column">
			<p theme={['text', 'sm', 'muted']}>A picture, and the letters shown without one</p>
			<div theme={['row', 'wrap']}>
				<Avatar src={picture} alt="Taylor Lee" fallback="TL" id={at('avatar')} />
				<Avatar fallback="AB" id={at('avatar-fallback')} />
				<Avatar fallback="CD" round={false} id={at('avatar-square')} />
			</div>

			<p theme={['text', 'sm', 'muted']}>Sizes</p>
			<div theme={['row', 'wrap']}>
				<Avatar fallback="SM" size="sm" id={at('avatar-sm')} />
				<Avatar fallback="MD" id={at('avatar-md')} />
				<Avatar fallback="LG" size="lg" id={at('avatar-lg')} />
			</div>
		</div>
	);
};
