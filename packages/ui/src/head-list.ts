// The head tag list one render owns: what a tag is, which one wins, what order they come out in,
// and how a page adopts the ones a server wrote (design 127).
//
// The components that make the tags are in `head.tsx`. This file has no components in it, so
// `render.ts` can hold the list without importing them and the two files do not depend on each
// other.

import { type ElementLike, type NodeLike, type ParentLike, createDocument, createElement, setAttribute, toHtml, watch } from '@aweftjs/dom';

import { assert } from './assert.ts';
import { type Registry, createRegistry } from './registry.ts';
import { isSource } from './source.ts';

/** The attribute every tag carries, naming the group it won, so a client can find it again. */
const HEAD_STAMP = 'data-aweft-head';

/** The elements a head component makes. */
export type HeadKind = 'title' | 'meta' | 'link' | 'script' | 'style';

/** One tag, as a head component declared it. */
export interface HeadTag {
	readonly kind: HeadKind;
	/** The group exactly one tag wins, or null for a tag that is additive. */
	readonly group: string | null;
	/** How many `Head` scopes it is inside. Deeper beats shallower. */
	readonly depth: number;
	/** The attributes, each a value or a cell. */
	readonly attrs: Readonly<Record<string, unknown>>;
	/** The inline text, a value or a cell, for `title`, `script` and `style`. */
	readonly text?: unknown;
}

/** A tag that won its group, with the stamp it is written and found by. */
interface HeadEntry {
	readonly stamp: string;
	readonly tag: HeadTag;
}

/** The render's head tags: a registry, plus the two questions something else asks of it. */
export interface HeadList extends Registry<HeadTag> {
	/** The tags that won, in the fixed order, as HTML. What a page being written puts in its head. */
	markup(): string;
	/** The title showing now, or null when the page declares none. */
	title(): string | null;
}

const valueOf = (value: unknown): unknown => (isSource(value) ? value.get() : value);

const textOf = (value: unknown): string | null => {
	const held = valueOf(value);
	return held === null || held === undefined || held === false ? null : String(held);
};

// The order tags come out in, by kind. `base` has no component yet; the row is here so the order
// does not have to be renumbered when one arrives.
const BUCKETS = ['charset', 'viewport', 'meta', 'base', 'title', 'fetch', 'style', 'link', 'script'];

/** The `rel` values that ask the browser to start work, so they go before what needs the work. */
const FETCHING = new Set(['preconnect', 'dns-prefetch', 'preload', 'modulepreload']);

const bucketOf = (tag: HeadTag): string => {
	if (tag.kind === 'meta') {
		if (tag.attrs['charset'] !== undefined) return 'charset';
		return textOf(tag.attrs['name']) === 'viewport' ? 'viewport' : 'meta';
	}
	if (tag.kind === 'link') return FETCHING.has(textOf(tag.attrs['rel']) ?? '') ? 'fetch' : 'link';
	return tag.kind;
};

/**
 * The tag that wins each group, in emission order.
 *
 * Deepest first, then latest: a page inside a layout overrides the layout's title without knowing
 * the layout is there, and two overrides at the same depth are decided by which mounted last.
 */
const winners = (items: readonly HeadTag[]): Map<string, HeadTag> => {
	const held = new Map<string, HeadTag>();
	for (const tag of items) {
		if (tag.group === null) continue;
		const standing = held.get(tag.group);
		if (standing === undefined || tag.depth >= standing.depth) held.set(tag.group, tag);
	}
	return held;
};

const resolveTags = (items: readonly HeadTag[]): HeadEntry[] => {
	const won = winners(items);
	const out: HeadEntry[] = [];
	let additive = 0;
	for (const tag of items) {
		if (tag.group === null) {
			out.push({ stamp: `#${additive}`, tag });
			additive += 1;
			continue;
		}
		if (won.get(tag.group) === tag) out.push({ stamp: tag.group, tag });
	}
	// Stable, so tags of one kind stay in the order they were added.
	return out.sort((a, b) => BUCKETS.indexOf(bucketOf(a.tag)) - BUCKETS.indexOf(bucketOf(b.tag)));
};

const RAW = new Set<HeadKind>(['script', 'style']);

/** Inline text is written raw, so a closing tag inside it would end the element early. */
const checkRaw = (kind: HeadKind, text: string): void => {
	if (!RAW.has(kind)) return;
	assert(!text.toLowerCase().includes(`</${kind}`),
		`a <${kind}> cannot hold the text "</${kind}"; move it out of the page or split the string, because raw text has no escape that is right in both CSS and JavaScript`);
};

/** Write a tag's attributes and text onto an element, skipping what is already right. */
const dress = (element: ElementLike, tag: HeadTag, stamp: string): (() => void)[] => {
	const stops: (() => void)[] = [];
	for (const [name, value] of Object.entries(tag.attrs)) {
		stops.push(watch(value, (held) => {
			const wanted = held === null || held === undefined || held === false ? null : held === true ? '' : String(held);
			if (element.getAttribute(name) !== wanted) setAttribute(element, name, held);
		}));
	}
	if (element.getAttribute(HEAD_STAMP) !== stamp) element.setAttribute(HEAD_STAMP, stamp);
	if (tag.text !== undefined) {
		stops.push(watch(tag.text, (held) => {
			const text = held === null || held === undefined ? '' : String(held);
			checkRaw(tag.kind, text);
			if (element.textContent !== text) element.textContent = text;
		}));
	}
	return stops;
};

/**
 * Keep a list's tags even after the page that declared them is taken down.
 *
 * A static render mounts the page, serializes it and unmounts it, so by the time the caller reads
 * `markup()` every head component has already been removed. `render` holds the list before it
 * starts, which is why the tags are still there afterwards. An internal seam behind a symbol
 * rather than a name on `HeadList`: only this package's `render` may do it, and a page that mounts
 * has to keep removing tags as it navigates.
 */
export const holdHead = (list: HeadList): void => {
	(list as unknown as Record<symbol, (() => void) | undefined>)[HOLD]?.();
};

const HOLD: unique symbol = Symbol('aweft.ui.head.hold');

/**
 * Make the head list one render owns.
 *
 * Example:
 *   const stop = use(context).head.add({ kind: 'title', group: 'title', depth: 0, attrs: {}, text: 'Home' });
 */
export const createHeadList = (): HeadList => {
	const registry = createRegistry<HeadTag>();
	let holding = false;
	const list = {
		...registry,
		add: (tag: HeadTag) => {
			const drop = registry.add(tag);
			return () => {
				if (!holding) drop();
			};
		},
		[HOLD]: () => { holding = true; },
		title: () => {
			const found = resolveTags(registry.items).find((entry) => entry.tag.kind === 'title');
			return found === undefined ? null : textOf(found.tag.text);
		},
		markup: () => {
			// A document of its own, so serializing a page never touches the one a mount is using.
			const document = createDocument();
			const nodes: NodeLike[] = [];
			for (const { stamp, tag } of resolveTags(registry.items)) {
				const element = document.createElement(tag.kind);
				for (const [name, value] of Object.entries(tag.attrs)) setAttribute(element, name, valueOf(value));
				element.setAttribute(HEAD_STAMP, stamp);
				const text = tag.text === undefined ? null : textOf(tag.text);
				if (text !== null) {
					checkRaw(tag.kind, text);
					element.appendChild(document.createTextNode(text));
				}
				nodes.push(element as unknown as NodeLike);
			}
			return toHtml(nodes);
		},
	};
	return list as HeadList;
};

// --- writing the list into a page ---------------------------------------------------------------

interface Held {
	element: ElementLike;
	tag: HeadTag;
	stops: (() => void)[];
}

/** Made through the head's own document, so a test counting a document's factories sees it. */
const makeIn = (head: ParentLike, kind: HeadKind): ElementLike => {
	const document = (head as { ownerDocument?: { createElement(tag: string): ElementLike } | null }).ownerDocument;
	return document === null || document === undefined ? createElement(kind) : document.createElement(kind);
};

/**
 * Where this render's run starts: after a page shell's `<meta charset>` when that is the first
 * thing in the head, and at the very front otherwise.
 *
 * A charset has to be in the first bytes of the document to be read at all, so the one tag that
 * cannot go behind the run is that one.
 */
const runStart = (head: ParentLike): NodeLike | null => {
	const first = head.firstChild ?? null;
	if (first === null || first.nodeType !== 1) return first;
	const element = first as unknown as ElementLike;
	return element.localName === 'meta' && element.getAttribute('charset') !== null
		? first.nextSibling ?? null
		: first;
};

/** A stamped tag in the head that no render has taken yet. */
const unclaimed = (head: ParentLike, stamp: string, claimed: Set<unknown>): ElementLike | null => {
	for (let node = head.firstChild ?? null; node !== null; node = node.nextSibling) {
		if (node.nodeType !== 1) continue;
		const element = node as ElementLike;
		if (claimed.has(element)) continue;
		if (element.getAttribute(HEAD_STAMP) === stamp) return element;
	}
	return null;
};

/**
 * Keep a page's `<head>` holding this render's tags.
 *
 * Params:
 *   head: the document's head element
 *   list: the render's head list
 *   adopt: whether a stamped tag already in the head may be taken over rather than replaced.
 *          True for a hydration, false for a fresh mount
 *   claimed: the elements other renders in this document have taken, so two renders in one page
 *            neither adopt nor remove each other's tags
 *
 * Returns: the detach. It takes this render's tags back out, adopted ones included.
 */
export const attachHead = (head: ParentLike, list: HeadList, adopt: boolean, claimed: Set<unknown>): (() => void) => {
	const owned = new Map<string, Held>();

	const release = (held: Held): void => {
		for (const stop of held.stops) stop();
		claimed.delete(held.element);
		held.element.parentNode?.removeChild(held.element as unknown as NodeLike);
	};

	const sync = (): void => {
		const wanted = resolveTags(list.items);
		const seen = new Set<string>();
		let previous: ElementLike | null = null;

		for (const { stamp, tag } of wanted) {
			seen.add(stamp);
			let held = owned.get(stamp);
			if (held === undefined) {
				const found = adopt ? unclaimed(head, stamp, claimed) : null;
				const element = found ?? makeIn(head, tag.kind);
				claimed.add(element);
				held = { element, tag, stops: dress(element, tag, stamp) };
				owned.set(stamp, held);
			} else if (held.tag !== tag) {
				// The same group, won by a different declaration. The element stays and is rewritten,
				// which is what keeps a stylesheet from being fetched twice on an act change.
				for (const stop of held.stops) stop();
				for (const name of held.element.getAttributeNames()) {
					if (name !== HEAD_STAMP && tag.attrs[name] === undefined) held.element.removeAttribute(name);
				}
				held.tag = tag;
				held.stops = dress(held.element, tag, stamp);
			}

			// The run of this render's tags stays contiguous and in order, and it starts at the front
			// of the head. The front, because a `<title>` in the page shell would otherwise win:
			// `document.title` is the first title element there is, so a tag appended after one does
			// nothing at all and does it silently. A shell's leading charset stays in front of the
			// run, because a charset read late is a charset not read. On a hydration the server
			// wrote the run already, so an adopted tag stays where it is and nothing moves.
			const element = held.element;
			if (previous === null) {
				if (element.parentNode !== head) head.insertBefore(element as unknown as NodeLike, runStart(head));
			} else if (previous.nextSibling !== (element as unknown as NodeLike)) {
				head.insertBefore(element as unknown as NodeLike, previous.nextSibling);
			}
			previous = element;
		}

		for (const [stamp, held] of [...owned]) {
			if (seen.has(stamp)) continue;
			release(held);
			owned.delete(stamp);
		}
	};

	const stop = list.items.watch(() => { sync(); });
	sync();

	return () => {
		stop();
		for (const held of owned.values()) release(held);
		owned.clear();
	};
};
