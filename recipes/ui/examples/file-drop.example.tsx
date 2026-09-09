// FileDrop: a zone a file can be dropped on, with a real file input in it that stays focusable,
// and the same component wearing chrome of the page's own.

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

	return (
		<div theme="column">
			<FileDrop files={files} ready={ready} extensions={['image/png', 'image/jpeg']}
				limit={4000000} id={at('filedrop')} />

			<FileDrop files={own} multiple={false} id={at('filedrop-own')}>
				<p theme={['text', 'sm']}>One file, and chrome of this page's own.</p>
				<FileDrop.Button label="Choose a file" type="quiet" id={at('filedrop-button')} />
			</FileDrop>

			<FileDrop files={mutableArray()} disabled={true} id={at('filedrop-disabled')} />
		</div>
	);
};
