// FileDrop: a zone a file can be dropped on, with a real file input in it that stays focusable,
// the same component wearing chrome of the page's own, and the button standing on its own as the
// picker with no zone at all (design 214).

import { mutable, mutableArray } from '@aweftjs/core';
import { FileDrop, h } from '@aweftjs/ui';

import { ids } from '../example.ts';
import type { ExampleComponent } from '../example.ts';

export const name = 'FileDrop';
export const order = 44;

export const Example: ExampleComponent = (props) => {
	const at = ids(props.mode);
	const files = mutableArray();
	const ready = mutable<unknown>(null);
	const own = mutableArray();
	const picked = mutableArray();

	return (
		<div theme="column">
			<FileDrop files={files} ready={ready} extensions={['image/png', 'image/jpeg']}
				limit={4000000} id={at('filedrop')} />

			<FileDrop files={own} multiple={false} id={at('filedrop-own')}>
				<p theme={['text', 'sm']}>One file, and chrome of this page's own.</p>
				<FileDrop.Button label="Choose a file" type="quiet" id={at('filedrop-button')} />
			</FileDrop>

			<FileDrop files={mutableArray()} disabled={true} id={at('filedrop-disabled')} />

			<FileDrop.Button label="Change photo" files={picked} multiple={false}
				extensions={['image/png', 'image/jpeg']} id={at('filedrop-picker')} />
		</div>
	);
};
