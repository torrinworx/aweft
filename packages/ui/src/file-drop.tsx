// A place to drop files, with a real file input in it (design 137).
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
// No upload happens here and none ever will. An entry carries the platform `File` and
// the application takes it from there.

import { type ElementLike, type Mounter, createElement, mount } from '@aweftjs/dom';
import { type MutableArray, isMutableArray, mutable, mutableArray } from '@aweftjs/core';

import { Button, type ButtonProps } from './button.tsx';
import { Icon } from './icon.tsx';
import { assert } from './assert.ts';
import { controlStates, elementFor } from './control.ts';
import { findFrom, under, within } from './tree.ts';
import { h } from './h.ts';
import { isWritable, through } from './source.ts';
import { slotOf, use, withSlot } from './render.ts';

/** One file the zone was given, as the application reads it. */
export interface FileDropEntry {
	/** The file's own name. */
	readonly name: string;
	/** The platform `File`. Upload it however you like. */
	readonly file: unknown;
	/** `ready` for one the zone accepted, `error` for one it refused, `loading` while you upload. */
	readonly status: 'ready' | 'loading' | 'error';
	/** Why it was refused, on an entry that was. */
	readonly error?: string;
}

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

const nameOf = (file: unknown): string => String((file as { name?: unknown }).name ?? '');
const sizeOf = (file: unknown): number => Number((file as { size?: unknown }).size ?? 0);
const typeOf = (file: unknown): string => String((file as { type?: unknown }).type ?? '').toLowerCase();

/** Whether one of the declared extensions or MIME types covers this file. */
const covers = (wanted: readonly string[], file: unknown): boolean => {
	if (wanted.length === 0) return true;
	const name = nameOf(file).toLowerCase();
	const mime = typeOf(file);
	return wanted.some((raw) => {
		const want = raw.trim().toLowerCase();
		if (want === '') return false;
		if (want.startsWith('.')) return name.endsWith(want);
		if (want.endsWith('/*')) return mime.startsWith(want.slice(0, -1));
		return mime === want;
	});
};

/** What `FileDrop` takes. Everything not named here goes to the zone. */
export interface FileDropProps {
	/** The entries, a `mutableArray`. Absent, the component keeps its own. */
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

/** `FileDrop`, with the button that opens its dialog from inside its own children. */
export interface FileDropComponent {
	(props: FileDropProps): Mounter;
	/** A `Button` that opens the file dialog. Only inside a `FileDrop`. */
	Button(props: ButtonProps): Mounter;
}

const openButton = (props: ButtonProps): Mounter => (elem, _item, before, context) => {
	const opener = slotOf(context, OPENER) as Opener | undefined;
	assert(opener !== undefined,
		'a FileDrop.Button needs a FileDrop above it; write it inside the children of a FileDrop');
	if (opener === undefined) return () => undefined;

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

	// A state prop is a cell or absent. A plain value looks as though it was honoured and is not,
	// so it is a loud assert rather than a silent fallback, as `Validate`'s `value` already was.
	assert(files === undefined || isMutableArray(files),
		'FileDrop files takes a cell, not a value; pass files={mutableArray()}, or leave it out and '
		+ 'the component keeps its own');
	const list = (isMutableArray(files) ? files : mutableArray<FileDropEntry>()) as MutableArray<FileDropEntry>;
	const wanted = Array.isArray(extensions) ? extensions.map((one) => String(one)) : [];
	const many = multiple !== false;
	const cap = limit === undefined || limit === null ? null : Number(limit);
	const states = controlStates(disabled, props);
	const dragging = mutable(false);
	const id = use(context).ids.next('filedrop');

	const input = createElement('input') as ElementLike;
	const prompt = createElement('label') as ElementLike;

	const attributeOf = (element: unknown, name: string): string | null =>
		(element as { getAttribute?(name: string): string | null }).getAttribute?.(name) ?? null;

	// The two nodes above are what a fresh mount puts on the page, and a hydration adopts the
	// server's markup and drops both (design 133). So every path that needs one finds it from the
	// event instead, by the id this render minted, which both copies carry.
	const inputFrom = (target: unknown): { click?(): void } | null =>
		findFrom(target, (element) => attributeOf(element, 'id') === id) as { click?(): void } | null;
	const promptFrom = (target: unknown): unknown =>
		findFrom(target, (element) => attributeOf(element, 'for') === id);

	const settle = (): void => {
		if (!isWritable(ready)) return;
		const rows = [...list];
		if (rows.some((row) => row.status === 'loading')) {
			ready.set(null);
			return;
		}
		const kept = rows.filter((row) => row.status !== 'error').map((row) => row.file);
		ready.set(many ? kept : kept[0] ?? null);
	};

	const refusal = (file: unknown): string | null => {
		if (!covers(wanted, file)) return `${nameOf(file)} is not one of the accepted types`;
		if (cap !== null && sizeOf(file) > cap) return `${nameOf(file)} is over the ${String(cap)} byte limit`;
		return null;
	};

	const add = (given: readonly unknown[]): void => {
		if (given.length === 0 || states.isDisabled()) return;
		const rows: FileDropEntry[] = [];
		const taken: unknown[] = [];
		for (const file of given) {
			const why = refusal(file);
			if (why !== null) {
				rows.push({ name: nameOf(file), file, status: 'error', error: why });
				continue;
			}
			if (!many && taken.length > 0) {
				// A refused file stays in the list with its reason, so a person who dragged eight of
				// them can see which ones did not land (design 137).
				rows.push({ name: nameOf(file), file, status: 'error', error: 'only one file is accepted' });
				continue;
			}
			rows.push({ name: nameOf(file), file, status: 'ready' });
			taken.push(file);
		}
		if (many) list.push(...rows);
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

	// A counter rather than a flag: a `dragleave` fires at the zone every time the pointer crosses
	// onto one of its own children, and a flag turns the highlight off there.
	let depth = 0;
	const stopDragging = (): void => {
		depth = 0;
		dragging.set(false);
	};

	const Row = (row: { each?: unknown }): unknown => {
		const entry = row.each as FileDropEntry;
		return h('li', { theme: ['filedrop_entry', entry.status] },
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

	const promptText = wanted.length === 0
		? (many ? 'Drop files here, or choose them' : 'Drop a file here, or choose one')
		: `${many ? 'Drop files here, or choose them' : 'Drop a file here, or choose one'}: ${wanted.join(', ')}`;

	const replaced = children !== undefined && children.length > 0;

	const inside = [
		h(prompt, { for: id, theme: ['filedrop_prompt', replaced ? 'offscreen' : null] },
			replaced ? null : h(Icon, { name: 'upload' }), promptText),
		h(input, {
			id,
			type: 'file',
			theme: ['filedrop_picker'],
			accept: wanted.length === 0 ? null : wanted.join(','),
			multiple: many ? '' : null,
			$multiple: many,
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

	const stop = list.watch(() => { settle(); });
	settle();

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
 * An entry is `{ name, file, status, error }`. A file the zone accepted starts as `ready` and one it
 * refused as `error`, with `error` saying why: the wrong type, over `limit`, or a second file while
 * `multiple` is false. Move `status` to `loading` while you upload by writing the entry back into
 * the list (`files[0] = { ...files[0], status: 'loading' }`), which is the edit the list can hear.
 *
 * `ready` is written null while any entry is loading, and otherwise the file, or the array of files
 * when `multiple` is true, counting every entry that is not in error.
 *
 * `FileDrop.Button` is a `Button` that opens the dialog, for use inside your own children. It
 * asserts, loud in development and stripped in a release build, when it is not inside a `FileDrop`.
 *
 * There is no upload here: the entry carries the platform `File` and the rest is yours.
 *
 * Throws: the assert `elementFor` makes for an `element` that is not a `<div>`.
 *
 * Example:
 *   <FileDrop files={picked} extensions={['image/png', 'image/jpeg']} limit={4_000_000} />
 */
export const FileDrop: FileDropComponent = Object.assign(zone, { Button: openButton });
