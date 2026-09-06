// Making an observable of a kind decided at runtime.
//
// Applying a commit needs this: a reference names a kind and an id for an observable the
// receiver may never have seen, and it has to be able to make one without knowing in advance
// which of the three it will be.

import type { Id, ObservableKind } from '@aweftjs/codec';

import type { Node } from './types.ts';
import { createArray } from './array.ts';
import { createMap } from './map.ts';
import { createObject } from './object.ts';
import { nodeOf } from './value.ts';

export const nodeFor = (kind: ObservableKind, id: Id): Node => {
	const made = kind === 'object'
		? createObject(undefined, id)
		: kind === 'array'
			? createArray(undefined, id)
			: createMap(undefined, id);

	return nodeOf(made)!;
};
