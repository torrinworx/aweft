// A place to drop files, with a real file input in it (designs 137, 214).
//
// The input is what opens the file dialog, what the keyboard reaches and what a form sees, so it is
// visually hidden rather than `display: none`: an input nobody can focus is a picker only a mouse
// can use. The zone around it takes a drop, which does not go through `accept` at all, so the
// extensions are checked here as well as declared there.
//
// The zone listens for `dragenter`, `dragleave` and `drop`, reading the dropped files off the
// event's `dataTransfer.files`; the input listens for `change` and reads its own `files`. Those four
// are everything that reaches this component from the host.
//
// `FileDrop.Button` is two things decided by where it is: inside a zone it opens that zone's input,
// and outside one it is the picker with no chrome, running the same checks over an input of its own
// (design 214). Which one it is is never a prop.
//
// No upload happens here and none ever will. An entry carries the platform `File` and
// the application takes it from there.

import { type ElementLike, type Mounter, createElement, mount } from '@aweftjs/dom';
import { type MutableArray, isMutableArray, mutable, mutableArray } from '@aweftjs/core';

import { Button, type ButtonProps } from './button.tsx';
import { type FileDropEntry, type Limits, type Say, promptFor, readyValue, sortFiles } from './file-checks.ts';
import { textOf } from './text.ts';
import { Icon } from './icon.tsx';
import { LoaderContext } from './suspend.tsx';
import { LoadingDots } from './loading-dots.tsx';
import { assert } from './assert.ts';
import { controlStates, elementFor } from './control.ts';
import { findFrom, under, within } from './tree.ts';
import { h } from './h.ts';
import { isWritable, through } from './source.ts';
import { slotOf, use, withSlot } from './render.ts';

export type { FileDropEntry } from './file-checks.ts';

/** How the zone tells `FileDrop.Button` where the input is. Not exported: it is not API. */
const OPENER: unique symbol = Symbol('aweft.ui.filedrop');

interface Opener {
	/** Given the node the click landed on, so the zone can find its input from there. */
	open(from: unknown): void;
}

const filesIn = (source: unknown): unknown[] => {
	const held = (source as { files?: ArrayLike<unknown> } | null)?.files;
	if (held === undefined || held === null) return [];
	return Array.from(held as ArrayLike<unknown>);
};

const idOf = (element: unknown): string | null =>
	(element as { getAttribute?(name: string): string | null }).getAttribute?.('id') ?? null;

/** What either shape was told to accept. */
const limitsOf = (props: Record<string, unknown>): Limits => ({
	wanted: Array.isArray(props['extensions']) ? props['extensions'].map((one) => String(one)) : [],
	many: props['multiple'] !== false,
	cap: props['limit'] === undefined || props['limit'] === null ? null : Number(props['limit']),
});

/** The list either shape writes into: the caller's, or one of its own. */
const listOf = (files: unknown): MutableArray<FileDropEntry> => {
	// A state prop is a cell or absent. A plain value looks as though it was honoured and is not,
	// so it is a loud assert rather than a silent fallback, as `Validate`'s `value` already was.
	assert(files === undefined || isMutableArray(files),
		'FileDrop files takes a cell, not a value; pass files={mutableArray()}, or leave it out and '
		+ 'the component keeps its own');
	return (isMutableArray(files) ? files : mutableArray<FileDropEntry>()) as MutableArray<FileDropEntry>;
};

/**
 * Sort a run of files into the list and tell the caller.
 *
 * The one place either shape adds files, so a zone and a standalone button cannot come to disagree
 * about what happens to a refused one.
 */
const adder = (
	limits: Limits,
	list: MutableArray<FileDropEntry>,
	onDrop: ((files: unknown[]) => void) | undefined,
	blocked: () => boolean,
	say: Say,
): ((given: readonly unknown[]) => void) => (given) => {
	if (given.length === 0 || blocked()) return;
	const { rows, taken } = sortFiles(limits, given, say);
	if (limits.many) list.push(...rows);
	else list.splice(0, list.length, ...rows);
	if (taken.length === 0) return;
	// A handler the page wrote is reported where `Detached` reports one, and the list keeps the
	// edit it has already made.
	try {
		onDrop?.(taken);
	} catch (error) {
		queueMicrotask(() => { throw error; });
	}
};

/** Follow the list and write `ready`, until the component goes. */
const settler = (list: MutableArray<FileDropEntry>, ready: unknown, many: boolean): (() => void) => {
	const settle = (): void => {
		if (!isWritable(ready)) return;
		ready.set(readyValue([...list], many));
	};
	const stop = list.watch(() => { settle(); });
	settle();
	return stop;
};

/** What `FileDrop` takes. Everything not named here goes to the zone. */
export interface FileDropProps {
	/**
	 * The entries, a `mutableArray`. Absent, the component keeps its own.
	 *
	 * With `multiple` false a second pick replaces the entry that is already there, in place, so a
	 * `watch` on this list hears a `replace` and never a second `add`.
	 */
	readonly files?: unknown;
	/** MIME types (`image/png`, `image/*`) or dotted extensions (`.csv`). */
	readonly extensions?: unknown;
	/** Take more than one. True unless it is set false. */
	readonly multiple?: unknown;
	/** The largest file, in bytes. No limit when it is omitted. */
	readonly limit?: unknown;
	/** A click anywhere on the zone opens the dialog. True unless it is set false. */
	readonly clickable?: unknown;
	/** A value or a cell. */
	readonly disabled?: unknown;
	/** Called with the accepted platform `File`s, after they have been added. */
	readonly onDrop?: (files: unknown[]) => void;
	/** A cell: null while anything is loading, else the file or the files. */
	readonly ready?: unknown;
	/** The theme variant. */
	readonly type?: unknown;
	/** Decorate this node instead of building one. */
	readonly element?: unknown;
	/** Extra theme segments, appended to this component's own. */
	readonly theme?: unknown;
	/** Given, they replace the prompt and the listing this component would draw. */
	readonly children?: unknown[];
	readonly [prop: string]: unknown;
}

/** What `FileDrop.Button` takes: the `Button` props, and the checks when it stands on its own. */
export interface FileDropButtonProps extends ButtonProps {
	/** The entries, a `mutableArray`. Read only outside a `FileDrop`. */
	readonly files?: unknown;
	/** MIME types or dotted extensions. Read only outside a `FileDrop`. */
	readonly extensions?: unknown;
	/** Take more than one. Read only outside a `FileDrop`. */
	readonly multiple?: unknown;
	/** The largest file, in bytes. Read only outside a `FileDrop`. */
	readonly limit?: unknown;
	/** Called with the accepted platform `File`s. Read only outside a `FileDrop`. */
	readonly onDrop?: (files: unknown[]) => void;
	/** A cell written the file or the files. Read only outside a `FileDrop`. */
	readonly ready?: unknown;
}

/** `FileDrop`, with the button that opens a file dialog. */
export interface FileDropComponent {
	(props: FileDropProps): Mounter;
	/** A `Button` that opens a file dialog: the zone's input inside one, its own outside one. */
	Button(props: FileDropButtonProps): Mounter;
}

/** The props only the standalone shape reads, so a zone can say they were wasted. */
const CHECKS = ['files', 'extensions', 'multiple', 'limit', 'onDrop', 'ready'] as const;

/** The button on its own: a `Button`, a hidden input beside it, and the same checks. */
const picker = (props: FileDropButtonProps): Mounter => (elem, _item, before, context) => {
	const { files, extensions, multiple, limit, onDrop, ready, onClick, ...rest } = props;

	const limits = limitsOf(props);
	const list = listOf(files);
	const id = use(context).ids.next('filedrop');
	const input = createElement('input') as ElementLike;
	const states = controlStates(props['disabled'], props);
	const add = adder(limits, list, onDrop, () => states.isDisabled(), (token) => textOf(context, token));

	// The button shows the words and the input is what the keyboard lands on, so the input needs a
	// name of its own. A `<label for>` is how the zone names its input and how `wireField` names a
	// control; this one is offscreen, because the button beside it already says the same thing.
	const name = props['label'] ?? props['aria-label'] ?? null;

	const node = [
		h(Button, {
			...rest,
			onClick: (event: unknown) => {
				onClick?.(event);
				// The input is the picker and the button is what a person sees. A hydration adopts
				// the server's node and drops the one built here (design 133), so the click walks to
				// the id this render minted rather than holding the node.
				const found = findFrom((event as { target?: unknown }).target,
					(element) => idOf(element) === id) as { click?(): void } | null;
				found?.click?.();
			},
		}),
		name === null ? null : h('label', { for: id, theme: ['offscreen'] }, name),
		h(input, {
			id,
			type: 'file',
			theme: ['filedrop_picker'],
			accept: limits.wanted.length === 0 ? null : limits.wanted.join(','),
			multiple: limits.many ? '' : null,
			$multiple: limits.many,
			disabled: props['disabled'],
			onChange: (event: unknown) => {
				const target = (event as { target?: unknown }).target;
				add(filesIn(target));
				// Cleared so choosing the same file twice in a row is two changes and not one.
				(target as { value?: unknown }).value = '';
			},
		}),
	];

	const stop = settler(list, ready, limits.many);
	const remove = mount(elem, node, before, context);
	return (arg) => {
		if (arg !== undefined) return remove(arg);
		stop();
		return remove();
	};
};

const openButton = (props: FileDropButtonProps): Mounter => (elem, item, before, context) => {
	const opener = slotOf(context, OPENER) as Opener | undefined;
	// Outside a zone this is the picker, with no chrome and no listing (design 214).
	if (opener === undefined) return picker(props)(elem, item, before, context);

	assert(CHECKS.every((name) => props[name] === undefined),
		'a FileDrop.Button inside a FileDrop takes no files, extensions, multiple, limit, onDrop or '
		+ 'ready: the zone around it already has them. Put them on the FileDrop, or take the button '
		+ 'out of the zone to make it a picker of its own');

	const { onClick, ...rest } = props;
	return mount(elem, h(Button, {
		...rest,
		onClick: (event: unknown) => {
			onClick?.(event);
			opener.open((event as { target?: unknown }).target ?? null);
		},
	}), before, context);
};

const zone = (props: FileDropProps): Mounter => (elem, _item, before, context) => {
	const {
		files, extensions, multiple, limit, clickable, disabled, onDrop, ready,
		type, element, theme, children, ...rest
	} = props;

	const limits = limitsOf(props);
	const list = listOf(files);
	const states = controlStates(disabled, props);
	const dragging = mutable(false);
	const id = use(context).ids.next('filedrop');

	const input = createElement('input') as ElementLike;
	const prompt = createElement('label') as ElementLike;

	// The two nodes above are what a fresh mount puts on the page, and a hydration adopts the
	// server's markup and drops both (design 133). So every path that needs one finds it from the
	// event instead, by the id this render minted, which both copies carry.
	const inputFrom = (target: unknown): { click?(): void } | null =>
		findFrom(target, (element) => idOf(element) === id) as { click?(): void } | null;
	const promptFrom = (target: unknown): unknown =>
		findFrom(target, (element) =>
			((element as { getAttribute?(name: string): string | null }).getAttribute?.('for') ?? null) === id);

	const add = adder(limits, list, onDrop, () => states.isDisabled(), (token) => textOf(context, token));

	// A counter rather than a flag: a `dragleave` fires at the zone every time the pointer crosses
	// onto one of its own children, and a flag turns the highlight off there.
	let depth = 0;
	const stopDragging = (): void => {
		depth = 0;
		dragging.set(false);
	};

	// The same fallback chain `Button` writes, so an application that named a loader once named it
	// for every wait in this package (design 219).
	const spinner = LoaderContext.read(context).loading ?? LoadingDots;

	const Row = (row: { each?: unknown }): unknown => {
		const entry = row.each as FileDropEntry;
		return h('li', { theme: ['filedrop_entry', entry.status] },
			entry.status === 'loading' ? h(spinner, {}) : null,
			h('span', { theme: ['text', 'sm'] }, entry.name),
			entry.error === undefined ? null : h('span', { theme: ['field_error'] }, entry.error),
			h(Button, {
				type: 'quiet',
				round: true,
				inline: true,
				'aria-label': `Remove ${entry.name}`,
				icon: h(Icon, { name: 'x' }),
				onClick: () => {
					const at = list.indexOf(entry);
					if (at >= 0) list.splice(at, 1);
				},
			}));
	};

	const replaced = children !== undefined && children.length > 0;

	const inside = [
		h(prompt, { for: id, theme: ['filedrop_prompt', replaced ? 'offscreen' : null] },
			replaced ? null : h(Icon, { name: 'upload' }), promptFor(limits, (token) => textOf(context, token))),
		h(input, {
			id,
			type: 'file',
			theme: ['filedrop_picker'],
			accept: limits.wanted.length === 0 ? null : limits.wanted.join(','),
			multiple: limits.many ? '' : null,
			$multiple: limits.many,
			disabled,
			onChange: (event: unknown) => {
				const target = (event as { target?: unknown }).target;
				add(filesIn(target));
				// Cleared so choosing the same file twice in a row is two changes and not one.
				(target as { value?: unknown }).value = '';
			},
		}),
		...(replaced ? children : [h('ul', { theme: ['filedrop_list'] }, h(Row, { each: list }))]),
	];

	const node = h(elementFor(element, 'div'), {
		...rest,
		theme: ['filedrop', type, theme, through(dragging, (on) => (on ? 'dragging' : null)), ...states.segments],
		isHovered: states.isHovered,
		isClicked: states.isClicked,
		onDragOver: (event: unknown) => { (event as { preventDefault?: () => void }).preventDefault?.(); },
		onDragEnter: (event: unknown) => {
			(event as { preventDefault?: () => void }).preventDefault?.();
			// Read the same way `add` reads it: a zone that will refuse the drop does not offer to
			// take it.
			if (states.isDisabled()) return;
			depth += 1;
			dragging.set(true);
		},
		onDragLeave: () => {
			depth = depth > 0 ? depth - 1 : 0;
			if (depth === 0) dragging.set(false);
		},
		onDrop: (event: unknown) => {
			(event as { preventDefault?: () => void }).preventDefault?.();
			stopDragging();
			add(filesIn((event as { dataTransfer?: unknown }).dataTransfer));
		},
		onClick: (event: unknown) => {
			if (clickable === false || states.isDisabled()) return;
			const target = (event as { target?: unknown }).target;
			const found = inputFrom(target);
			if (found === null) return;
			// The label and the input open the dialog themselves; opening it again here would open
			// it twice, and the click the input fires would come straight back to this handler.
			if (within(target, [found, promptFrom(target)])) return;
			// A button inside the zone has a job of its own and the click reaches here after it.
			// Without this a `FileDrop.Button` opens the dialog twice, and the listing's remove
			// button opens it at all.
			if (under(target, 'button')) return;
			found.click?.();
		},
	}, ...inside);

	const own = withSlot(context, OPENER, {
		open: (from: unknown) => { inputFrom(from)?.click?.(); },
	} satisfies Opener);

	const stop = settler(list, ready, limits.many);

	const remove = mount(elem, node, before, own);
	return (arg) => {
		if (arg !== undefined) return remove(arg);
		stop();
		return remove();
	};
};

/**
 * A place to drop files.
 *
 * Params:
 *   props: `files`, `extensions`, `multiple`, `limit`, `clickable`, `disabled`, `onDrop`, `ready`,
 *          `type`, `element`, and anything else, which goes to the zone
 *   children: given, they replace the prompt line and the listing this draws for itself
 *
 * Returns: a `<div>` holding a `<label>`, a visually hidden `<input type="file">` and either the
 * default chrome or your children. A drop, a click and the keyboard all reach the same input. The
 * zone listens for `dragenter`, `dragleave` and `drop` (reading `dataTransfer.files`), and the input
 * for `change` (reading `files`).
 *
 * An entry is `{ name, file, status, error, reason }`. A file the zone accepted starts as `ready`
 * and one it refused as `error`, with `error` the sentence a person reads and `reason` the code a
 * page branches on: `type` for a file the `extensions` do not cover, `size` for one over `limit`,
 * and `count` for a second file while `multiple` is false (design 214). A refused file stays in the
 * list. Move `status` to `loading` while you upload by writing the entry back into the list
 * (`files[0] = { ...files[0], status: 'loading' }`), which is the edit the list can hear.
 *
 * `limit` is bytes, and every sentence naming it writes it in KB, MB or GB, so a `limit` of
 * 4_000_000 reads as 3.8 MB. The prompt names the accepted types the way a person says them, so
 * `image/png` reads as `png` and `image/*` reads as `image`.
 *
 * `ready` is written null while any entry is loading, and otherwise the file, or the array of files
 * when `multiple` is true, counting every entry that is not in error.
 *
 * `FileDrop.Button` is a `Button` that opens a file dialog. Inside a `FileDrop` it opens that zone's
 * input and takes no checking props of its own; outside one it is the picker with no chrome, taking
 * `files`, `extensions`, `multiple`, `limit`, `onDrop` and `ready` itself.
 *
 * There is no upload here: the entry carries the platform `File` and the rest is yours.
 *
 * Throws: the assert `elementFor` makes for an `element` that is not a `<div>`, the assert `files`
 * makes for a value that is not a cell, and the assert a `FileDrop.Button` inside a zone makes when
 * it was given a checking prop the zone already owns. All three are loud in development and
 * stripped in a release build.
 *
 * Example:
 *   <FileDrop files={picked} extensions={['image/png', 'image/jpeg']} limit={4_000_000} />
 *   <FileDrop.Button label="Change photo" extensions={['image/*']} multiple={false} ready={photo} />
 */
export const FileDrop: FileDropComponent = Object.assign(zone, { Button: openButton });
