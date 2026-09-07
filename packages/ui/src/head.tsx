// The six head components (design 127).
//
// Each renders nothing where it is written and puts a tag in the render's head list instead. The
// list decides which tag of a group wins and what order they come out in; this file decides what
// group a tag is in and what attributes it carries.

import { type Mounter, mount } from '@aweftjs/dom';

import { createContext } from './contexts.ts';
import type { HeadKind, HeadTag } from './head-list.ts';
import { use } from './render.ts';
import { isSource } from './source.ts';

/** How many `Head` scopes deep the subtree is. `Head` is this context's provider. */
const Depth = createContext<number>(0, (_raw, parent) => parent + 1);

/**
 * A deeper override scope for the head.
 *
 * Everything inside is one level deeper than everything outside, and within a group the deepest
 * tag wins. A layout writes its defaults outside a `Head` and a page overrides them from inside
 * one; two pages that both override are decided by which mounted last.
 *
 * Params:
 *   children: the subtree whose head tags are one level deeper
 *
 * Example:
 *   <Head><Title>{post.title}</Title></Head>
 */
export const Head = (props: { children?: unknown[] }): unknown => Depth(props);

const textOf = (children: unknown[] | undefined): unknown => {
	const items = (children ?? []).filter((child) => child !== null && child !== undefined);
	if (items.length === 0) return undefined;
	if (items.length === 1) return items[0];
	// More than one child, so a cell among them cannot be followed and the text is what it reads
	// as now. One child is the normal case and the one that stays live.
	return items.map((child) => String(isSource(child) ? child.get() : child)).join('');
};

const nameOf = (value: unknown): string | null => {
	if (value === null || value === undefined || value === false) return null;
	return String(isSource(value) ? (value as { get(): unknown }).get() : value);
};

/**
 * The group a tag competes in: the `key` prop, or the identity the format already gives it.
 *
 * A tag with no identity of its own and no `key` is additive, so every one of them is emitted.
 */
const groupOf = (kind: HeadKind, attrs: Record<string, unknown>, key: unknown): string | null => {
	const named = nameOf(key);
	if (named !== null) return named;

	if (kind === 'title') return 'title';
	if (kind === 'style') return `style:${nameOf(attrs['media']) ?? 'all'}`;
	if (kind === 'meta') {
		if (attrs['charset'] !== undefined) return 'meta:charset';
		for (const field of ['http-equiv', 'name', 'property']) {
			const found = nameOf(attrs[field]);
			if (found !== null) return `meta:${field}=${found}`;
		}
		return null;
	}
	if (kind === 'link') {
		const rel = nameOf(attrs['rel']);
		if (rel === null) return null;
		// One canonical per page whatever it points at, which is the whole point of a canonical.
		if (rel === 'canonical') return 'link:canonical';
		const href = nameOf(attrs['href']);
		return href === null ? null : `link:${rel}|${href}`;
	}
	const type = nameOf(attrs['type']) ?? '';
	const src = nameOf(attrs['src']);
	return src === null ? `script:inline|${type}` : `script:${src}|${type}`;
};

/** A component that adds one tag and renders nothing. */
const declare = (kind: HeadKind, attrs: Record<string, unknown>, key: unknown, text?: unknown): Mounter =>
	(elem, _item, before, context) => {
		const tag: HeadTag = {
			kind,
			group: groupOf(kind, attrs, key),
			depth: Depth.read(context),
			attrs,
			...(text === undefined ? {} : { text }),
		};
		const forget = use(context).head.add(tag);
		const remove = mount(elem, null, before, context);
		return (arg) => {
			if (arg !== undefined) return remove(arg);
			forget();
			return remove();
		};
	};

/** Everything a head component takes beyond its own named props: attributes, and a `key`. */
export interface TagProps {
	/** The group this tag competes in, when the format gives it none or you want a second one. */
	readonly key?: string;
	readonly children?: unknown[];
	readonly [attribute: string]: unknown;
}

const attributesOf = (props: TagProps, rename: Readonly<Record<string, string>> = {}): Record<string, unknown> => {
	const attrs: Record<string, unknown> = {};
	for (const [name, value] of Object.entries(props)) {
		if (name === 'key' || name === 'children' || value === undefined) continue;
		attrs[rename[name] ?? name] = value;
	}
	return attrs;
};

/**
 * The page's title.
 *
 * Params:
 *   children: the text, a string or a cell. A cell rewrites the tag in place
 *   key: a group of your own, for the rare page that wants two titles in the list
 *
 * Returns: nothing where it is written. The tag goes in the render's head list.
 *
 * Example:
 *   <Head><Title>{post.title}</Title></Head>
 */
export const Title = (props: TagProps): unknown =>
	declare('title', attributesOf(props), props.key, textOf(props.children));

/**
 * One `<meta>`.
 *
 * Params:
 *   charset, httpEquiv, name, property, content, and any other attribute, each a value or a cell.
 *          `httpEquiv` is written out as `http-equiv`
 *   key: a group of your own
 *
 * Returns: nothing where it is written. Its group is its `charset`, `http-equiv`, `name` or
 * `property`, in that order; a `<meta>` with none of those is additive and every one is emitted.
 *
 * Example:
 *   <Meta name="description" content={summary} />
 */
export const Meta = (props: TagProps): unknown => {
	const attrs = attributesOf(props, { httpEquiv: 'http-equiv' });
	return declare('meta', attrs, props.key);
};

/**
 * One `<link>`.
 *
 * Params:
 *   rel, href, and any other attribute, each a value or a cell
 *   key: a group of your own
 *
 * Returns: nothing where it is written. Its group is `rel` and `href` together, except
 * `rel="canonical"`, which is one per page whatever it points at. A `<link>` with no `rel` is
 * additive.
 *
 * Example:
 *   <Link rel="canonical" href={`https://example.com${path}`} />
 */
export const Link = (props: TagProps): unknown => declare('link', attributesOf(props), props.key);

/**
 * One `<script>`.
 *
 * Params:
 *   src, type, async, defer, and any other attribute, each a value or a cell
 *   children: the inline source, when there is no `src`
 *   key: a group of your own
 *
 * Returns: nothing where it is written. Its group is its `src` and `type`, or, with no `src`,
 * that it is inline and its `type`. **Two inline scripts of one type are therefore one group and
 * only the winner is emitted**; give each a `key` to keep both.
 *
 * Throws: an assert naming the fix when the inline source contains `</script`, which would end
 * the element early and cannot be escaped inside JavaScript.
 *
 * Example:
 *   <Script src="https://example.com/a.js" async />
 */
export const Script = (props: TagProps): unknown =>
	declare('script', attributesOf(props), props.key, textOf(props.children));

/**
 * One `<style>`.
 *
 * Params:
 *   media, and any other attribute, each a value or a cell
 *   children: the CSS
 *   key: a group of your own
 *
 * Returns: nothing where it is written. Its group is its `media`, so a page overrides a layout's
 * styles for one media query and leaves the others alone.
 *
 * Throws: an assert naming the fix when the CSS contains `</style`.
 *
 * Example:
 *   <Style media="print">{'@page { margin: 2cm; }'}</Style>
 */
export const Style = (props: TagProps): unknown =>
	declare('style', attributesOf(props), props.key, textOf(props.children));
