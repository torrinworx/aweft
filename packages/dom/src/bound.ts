// What `h` hands the mounter: the element it made, and the parts still to bind.
//
// A leaf on purpose. The row template (design 089) makes the same shape from a clone, and
// this is what both it and `h` write; putting it here keeps the template out of the mounter.

import { setAttribute } from './host.ts';
import type { Handle } from './list.ts';
import type { ElementLike, NodeLike } from './types.ts';
import { isNodeLike, isSource } from './types.ts';

export const BOUND: unique symbol = Symbol('aweft.bound');

export interface ChildSignal {
	readonly kind: 'child';
	parent: ElementLike;
	readonly item: unknown;
	staticNext: NodeLike | null;
	next: ChildSignal | null;
	handle: Handle | null;
}

export interface PropSignal {
	readonly kind: 'prop';
	element: ElementLike;
	/** The property whose value is the real target (`style`), or null for the element itself. */
	readonly via: string | null;
	readonly name: string;
	readonly source: { effect(fn: (value: unknown) => void): () => void };
	readonly set: (target: object, name: string, value: unknown) => void;
}

export type Signal = ChildSignal | PropSignal;

/** An element `h` made with reactive parts still to bind. */
export interface Bound {
	readonly [BOUND]: true;
	node: ElementLike;
	readonly signals: Signal[];
}

export const isBound = (value: unknown): value is Bound =>
	typeof value === 'object' && value !== null && (value as { [BOUND]?: true })[BOUND] === true;

export const propertySet = (target: object, name: string, value: unknown): void => {
	(target as Record<string, unknown>)[name] = value;
};

export const attributeSet = (target: object, name: string, value: unknown): void => {
	setAttribute(target as ElementLike, name, value);
};

export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value) && !isNodeLike(value) && !isSource(value)
	&& Object.getPrototypeOf(value) === Object.prototype;
