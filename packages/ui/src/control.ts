// The three things every control does with its element: check the one it was handed, put the
// state segments on its theme, and read a value back off an event.
//
// `hovered`, `pressed` and `disabled` are one rule each in the default theme (design 118), and a
// component's only job is to get the segment into the class list at the right moment. Nine
// components doing that by hand is nine chances to spell one of them wrong, so they say it here.
//
// This is not exported.

import { mutable } from '@aweftjs/core';

import { assert } from './assert.ts';
import { type Render, use } from './render.ts';
import { isWritable, through } from './source.ts';

// Per render, and inside that per cell, so two renders on one page never mint one name for two
// groups. Both keys are objects the caller already holds, which is the only kind of cache this
// package keeps at module scope (design 109).
const groups = new WeakMap<Render, WeakMap<object, string>>();

/**
 * The `name` every input sharing this value cell uses, so the platform treats them as one group.
 *
 * Params:
 *   context: the opaque context `dom` handed the mounter
 *   cell: the value cell the inputs share
 *
 * Returns: the same name for the same cell in the same render, minted off the render's id counter
 * so a server and the hydration that adopts it agree. `Radio` calls it, so two radios pointed at one
 * cell are one group.
 *
 * Example:
 *   const name = groupFor(context, cell);
 */
export const groupFor = (context: unknown, cell: object): string => {
	const render = use(context);
	let byCell = groups.get(render);
	if (byCell === undefined) {
		byCell = new WeakMap();
		groups.set(render, byCell);
	}
	let name = byCell.get(cell);
	if (name === undefined) {
		name = render.ids.next('radio');
		byCell.set(cell, name);
	}
	return name;
};

/** The two cells a control hands its element, and the segments that follow them. */
export interface ControlStates {
	/** Hand to the element as `isHovered`. The caller's own cell when it gave one. */
	readonly isHovered: unknown;
	/** Hand to the element as `isClicked`. The caller's own cell when it gave one. */
	readonly isClicked: unknown;
	/** Goes on the end of the element's `theme` list. */
	readonly segments: unknown[];
	/** Whether it is disabled now, for a handler that has to decide. */
	isDisabled(): boolean;
}

/** The state props a caller may hand a control, which are cells or nothing. */
export interface StateProps {
	readonly isHovered?: unknown;
	readonly isClicked?: unknown;
	readonly [prop: string]: unknown;
}

const held = (value: unknown): boolean => {
	const source = value as { get?: () => unknown } | null | undefined;
	return Boolean(typeof source?.get === 'function' ? source.get() : value);
};

/**
 * The hover, press and disabled segments for one control.
 *
 * Params:
 *   disabled: a value or a cell. A control that is disabled shows neither of the other two,
 *             because `disabled` clears the tint in the default theme
 *   given: the control's own props. A caller's `isHovered` or `isClicked` cell is the one that
 *          gets written and followed; a control mints one only where it was given none
 *
 * Returns: the two cells to write on the element and the segments to append to its theme.
 *
 * Example:
 *   const states = controlStates(props.disabled, props);
 *   h('button', { theme: ['button', props.type, ...states.segments],
 *     isHovered: states.isHovered, isClicked: states.isClicked });
 */
export const controlStates = (disabled: unknown, given?: StateProps): ControlStates => {
	const isHovered = isWritable(given?.isHovered) ? given.isHovered : mutable(false);
	const isClicked = isWritable(given?.isClicked) ? given.isClicked : mutable(false);
	return {
		isHovered,
		isClicked,
		segments: [
			through(isHovered, (on) => (on ? 'hovered' : null)),
			through(isClicked, (on) => (on ? 'pressed' : null)),
			through(disabled, (value) => (value ? 'disabled' : null)),
		],
		isDisabled: () => held(disabled),
	};
};

// The public name of the square size is `icon`, and the segment it puts in the class list is
// `square`. They differ because `icon` is also a top-level entry, so a class list holding the
// bare segment `icon` compiles that entry too and the button loses its own box (design 194,
// amended). No segment of a modifier may be the name of an entry, and `checkTheme` refuses one.
const SEGMENT_OF: Readonly<Record<string, string>> = { icon: 'square' };

/**
 * The theme segments a control's `size` prop puts after its `type`.
 *
 * Params:
 *   size: `'sm'`, `'lg'`, nothing, or one of `Button`'s `'icon'`, `'icon-sm'` and `'icon-lg'`.
 *         A value or a cell
 *
 * Returns: the segments, or null for no size at all, following the cell when it is one. A hyphen
 * separates two segments, so `icon-sm` is `square` then `sm` and reaches `button_square` and
 * `button_square_sm` (design 194).
 *
 * Example:
 *   theme: ['button', props.type, sizeSegments(props.size), ...states.segments]
 */
export const sizeSegments = (size: unknown): unknown =>
	through(size, (held) => (held === null || held === undefined || held === false || held === ''
		? null
		: String(held).split('-').map((part) => SEGMENT_OF[part] ?? part)));

/** What was handed in, for a message that has to say why it is not an element. */
const describe = (value: unknown): string => {
	if (typeof value === 'function') return 'a function, which is a component or a themed element';
	const type = (value as { nodeType?: unknown }).nodeType;
	if (typeof type === 'number') return `a node of type ${String(type)}`;
	return `a ${typeof value}`;
};

/**
 * The node a control decorates: the one it was handed, or the name of the one to build.
 *
 * Params:
 *   element: the caller's `element` prop, or nothing
 *   tags: the element names this control wraps, the one it builds for itself first. None means
 *         any element will do, and the check is only that it is one
 *
 * Returns: the handed element, or the first tag name.
 *
 * Throws: an assert, loud in development and stripped in a release build, when the handed
 * element is not one of those tags, or is not an element at all. Taken silently it would wear
 * the theme and the ARIA and behave like nothing at all, which is the failure that costs an
 * afternoon.
 *
 * Example:
 *   const node = elementFor(props.element, 'input');
 */
export const elementFor = (element: unknown, ...tags: string[]): unknown => {
	if (element === undefined || element === null) return tags[0]!;
	const name = (element as { localName?: unknown }).localName;
	if (tags.length === 0) {
		// A component function reaches `h` as a component and a text node reaches it as a tag
		// name, and both render nothing where an element was meant.
		assert(typeof name === 'string' && name !== '',
			`element must be an element and this one is ${describe(element)}`);
		return element;
	}
	const got = String(name ?? '').toLowerCase();
	assert(tags.includes(got),
		`element must be <${tags.join('> or <')}> and this one is <${got}>`);
	return element;
};

/**
 * The text a control starts with, for the markup, or null when it starts with nothing.
 *
 * Params:
 *   cell: the control's value cell
 *
 * Returns: what it holds now as a string, or null, so an empty control writes no attribute and
 * no text rather than an empty one a hydration would then have to pair.
 *
 * Example:
 *   h('input', { value: starting(cell), $value: cell });
 */
export const starting = (cell: { get(): unknown }): string | null => {
	const held = cell.get();
	return held === null || held === undefined || held === '' ? null : String(held);
};

/** What the element holds now, off the event it fired. */
export const valueOf = (event: unknown): string =>
	String((event as { target?: { value?: unknown } }).target?.value ?? '');

/** Whether the box the event came from is ticked. */
export const checkedOf = (event: unknown): boolean =>
	Boolean((event as { target?: { checked?: unknown } }).target?.checked);
