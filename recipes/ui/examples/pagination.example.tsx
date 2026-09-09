// Pagination: the pages of a long list, as quiet buttons. The window is first, last and a sibling
// each side of the current page, with an ellipsis where a run was left out (design 201).

import { mutable } from '@aweftjs/core';
import { Pagination, h } from '@aweftjs/ui';

import { ids } from '../example.ts';
import type { ExampleComponent } from '../example.ts';

export const name = 'Pagination';
export const order = 81;

export const Example: ExampleComponent = (props) => {
	const at = ids(props.mode);
	const page = mutable(5);
	const early = mutable(1);
	const small = mutable(2);

	return (
		<div theme="column">
			<p theme={['text', 'sm', 'muted']}>Page 5 of 12: a gap on each side</p>
			<Pagination id={at('pagination')} page={page} count={12} />
			<p theme={['text', 'sm']} id={at('pagination-at')}>{page}</p>

			<p theme={['text', 'sm', 'muted']}>The first page, where previous is off</p>
			<Pagination id={at('pagination-first')} page={early} count={12} />

			<p theme={['text', 'sm', 'muted']}>Four pages, so nothing is left out, at the small size</p>
			<Pagination id={at('pagination-small')} page={small} count={4} size="sm" siblings={2} />
		</div>
	);
};
