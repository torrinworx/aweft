// Skeleton: the shape of a card that has not arrived.

import { Skeleton, h } from '@aweftjs/ui';

import { ids } from '../example.ts';
import type { ExampleComponent } from '../example.ts';

export const name = 'Skeleton';
export const order = 66;

export const Example: ExampleComponent = (props) => {
	const at = ids(props.mode);

	return (
		<div theme="column">
			<div theme="row">
				<Skeleton width={40} height={40} round={true} id={at('skeleton-round')} />
				<div theme={['column', 'fill']}>
					<Skeleton width="60%" id={at('skeleton')} />
					<Skeleton width="40%" id={at('skeleton-short')} />
				</div>
			</div>
			<Skeleton height="6rem" id={at('skeleton-block')} />
		</div>
	);
};
