// What a screen reader cannot recover from, read off the page as it mounts (design 266).
//
// Each helper answers a value an `assert` compares, so the whole check is one statement a
// release build removes (design 097); the one that throws does so from an assert of its own.

import type { ElementLike, Mounted, NodeLike, ParentLike } from '@aweftjs/dom';

import { assert } from './assert.ts';

const NAMING = ['aria-label', 'aria-labelledby', 'title'] as const;

const carries = (element: ElementLike, names: readonly string[]): boolean =>
	names.some((name) => {
		const value = element.getAttribute(name);
		return value !== null && value.trim() !== '';
	});

/** Whether any element below carries a name of its own: a labelled `Icon`, an `img` with an `alt`. */
const namedInside = (node: NodeLike): boolean => {
	for (let child = node.firstChild; child !== null; child = child.nextSibling) {
		if (child.nodeType !== 1) continue;
		if (carries(child as ElementLike, [...NAMING, 'alt']) || namedInside(child)) return true;
	}
	return false;
};

/**
 * Whether anything names the element to a screen reader: text inside it, `aria-label`,
 * `aria-labelledby` or `title` on it, or a descendant carrying one of those or an `alt`.
 *
 * Params:
 *   element: the element on the page, or null when the mount put nothing there
 *
 * Returns: true when something names it, or when there is no element to read.
 *
 * Example:
 *   assert(named(element), 'a Button has to say what it does');
 */
export const named = (element: ElementLike | null): boolean => {
	if (element === null) return true;
	if ((element.textContent ?? '').trim() !== '') return true;
	return carries(element, NAMING) || namedInside(element);
};

const NAMELESS = 'a Button has nothing a screen reader can say: give it a label or an aria-label, or a label on the Icon inside it';

/**
 * Have a control's name read once it and everything inside it are on the page.
 *
 * A control's children are components the mount runs from its queue, so the element has nothing
 * inside it when the mounter returns; `mounted` is the point where it does, and under a hydration
 * `element` answers the server's node rather than the one the component built.
 *
 * Params:
 *   mounted: the component's own `mounted`
 *   element: how to reach the element on the page
 *
 * Returns: true, always: the check throws from `mounted`, not from here, so the whole statement
 * that registers it can sit inside an `assert` a release build removes.
 *
 * Example:
 *   assert(checkNamed(mounted, () => mountedElement(remove, before)()), 'the name check never refuses on its own');
 */
export const checkNamed = (mounted: Mounted, element: () => ElementLike | null): boolean => {
	mounted(() => { assert(named(element()), NAMELESS); });
	return true;
};

interface PageDocument {
	readonly nodeType: number;
	readonly documentElement?: { readonly lang?: unknown };
	readonly title?: unknown;
	readonly defaultView?: { readonly top: unknown } | null;
}

// Each fact is read once per document, and marked read before it is answered, so a fault that
// throws is reported on the first mount and not on every one after it.
const languageRead = new WeakSet<object>();
const titleRead = new WeakSet<object>();

/**
 * The document a mount target sits in, when it is a browser page: the top document of its
 * window, with a `lang` on its root and a `title` of its own. A light document, a server render
 * and a document inside a frame answer null.
 */
const pageOf = (target: ParentLike): PageDocument | null => {
	const own = target as unknown as { readonly ownerDocument?: PageDocument | null; readonly nodeType?: number };
	const document = own.nodeType === 9 ? (own as unknown as PageDocument) : own.ownerDocument ?? null;
	if (document === null || document === undefined) return null;
	const view = document.defaultView;
	if (view === null || view === undefined || view.top !== view) return null;
	if (typeof document.documentElement?.lang !== 'string' || typeof document.title !== 'string') return null;
	return document;
};

/**
 * The language the page declares on its root element, read once per document.
 *
 * Returns: the `lang` of the target's document, or `-` when the target is not in a browser page
 * or the page's language was already read, so a caller asserting it is not empty passes there.
 *
 * Example:
 *   assert(pageLanguage(target) !== '', 'the page declares no language');
 */
export const pageLanguage = (target: ParentLike): string => {
	const page = pageOf(target);
	if (page === null || languageRead.has(page)) return '-';
	languageRead.add(page);
	return String(page.documentElement!.lang).trim();
};

/**
 * The page's title, read once per document.
 *
 * Returns: the document's title, or `-` when the target is not in a browser page or the page's
 * title was already read.
 *
 * Example:
 *   assert(pageTitle(target) !== '', 'the page has no title');
 */
export const pageTitle = (target: ParentLike): string => {
	const page = pageOf(target);
	if (page === null || titleRead.has(page)) return '-';
	titleRead.add(page);
	return String(page.title).trim();
};
