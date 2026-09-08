// Static render and hydration: the two other modes of the one mount (designs 077, 078).

import { assert } from './assert.ts';
import { h } from './h.ts';
import { Hydration, REMEDY } from './hydration.ts';
import { createDocument, toHtml } from './light.ts';
import { type Remove, createRoot, drainRoot, endHydration, getFirst, isComponentCall, mountItem, pendingOf, runMount } from './mount.ts';
import { isMade } from './props.ts';
import { type DocumentLike, type ParentLike, isNodeLike } from './types.ts';

/**
 * Render an item to markup, with no browser.
 *
 * Params:
 *   item: anything `mount` takes
 *   options: `context`, the opaque value every mounter below receives
 *
 * Returns: the markup, once nothing a component declared `pending` is still pending. Every
 * dynamic part (a scope, a component, each item of a list) is bracketed with `<!--[-->` and
 * `<!--]-->` so `hydrate` can find it. No doctype; the page adds its own.
 *
 * Throws: whatever mounting the item throws, which for a caller mistake is an assert, loud
 * in development and stripped in a release build.
 *
 * Example:
 *   const page = await render(h(App, { url }));
 */
export const render = async (item: unknown, options: { context?: unknown } = {}): Promise<string> => {
	const document = createDocument();
	const container = document.createElement('div');
	const root = createRoot(document, true, null);
	const handle = runMount(root, null, () =>
		mountItem({ root, elem: container, scope: null, context: options.context, owner: null }, item, () => null));

	const pending = pendingOf(root);
	while (pending.size > 0) await Promise.allSettled([...pending]);

	const markup = toHtml(container.childNodes);
	runMount(root, null, () => handle.remove());
	return markup;
};

/**
 * Take over markup `render` wrote, in place.
 *
 * Params:
 *   target: the element whose children are the server's markup
 *   item: what makes the same item the server rendered. A component call, `h(App, props)`, or
 *         a function that makes it, `() => h('main', {}, ...)`, which is mounted as a
 *         component with no props
 *   context: the opaque value every mounter below receives
 *
 * Returns: the remove function, as `mount` does. Server nodes are adopted, not rebuilt: a
 * matching element keeps its identity and gains the properties and listeners the client
 * gives it. A mismatch asserts in development; in production the region that differs is
 * replaced with what the client built. One live hydration per target: a second call over the
 * same target asserts, because it would claim the first one's nodes.
 *
 * An element built before the call is refused, and so is one a maker returns after building it
 * earlier: it was made outside every mount, where nothing records which nodes the binding made,
 * so nothing can claim the server's markup with it. Build it inside the maker (design 157).
 * Only the top-level item is checked; deeper in a component tree a node the application made
 * still goes in as it is and stands in for the server's node of the same tag.
 *
 * Throws: an assert, loud in development and stripped in a release build, for a second live
 * hydration over the same target, a target with no document, a top-level item that is a node
 * built before the mount, or markup that does not match what the client builds.
 *
 * Example:
 *   hydrate(document.body, h(App, { url: location.pathname }));
 *   hydrate(document.body, () => h('main', {}, 'ready'));
 */
const hydrated = new WeakSet<ParentLike>();

/**
 * Refuse a top-level item that is a node this hydration did not make. Nothing has been
 * inserted when this runs, so the target keeps the markup the server sent.
 */
const refuseUnmade = (item: unknown): void => {
	assert(!isNodeLike(item) || isMade(item),
		'hydrate cannot claim the server markup with a node it did not make' + REMEDY);
};

/** The maker, checked: it runs inside the hydration and its item is refused before it mounts. */
const guard = (maker: (...args: unknown[]) => unknown): ((...args: unknown[]) => unknown) => {
	const checked = (...args: unknown[]): unknown => {
		const built = maker(...args);
		refuseUnmade(built);
		return built;
	};
	// A component's failure names the component, so the wrapper answers to the maker's name.
	Object.defineProperty(checked, 'name', { value: maker.name });
	return checked;
};

export const hydrate = (target: ParentLike, item: unknown, context?: unknown): Remove => {
	assert(!hydrated.has(target), 'hydrate: the target already holds a live hydration; remove that one first');
	refuseUnmade(item);
	const own = target.ownerDocument;
	const page = (globalThis as { document?: DocumentLike }).document;
	const document = own ?? page;
	assert(document !== undefined && document !== null, 'hydrate needs a document: the target has none and there is no page; hydrate into a node from the page, or call render');

	const hydration = new Hydration();
	const root = createRoot(document!, false, hydration);
	const scope = hydration.top(target);
	// A maker is mounted as a component with no props, which is what `h` makes of a function,
	// so the item it returns is built inside the hydration rather than before it (design 157).
	// The wrapper is where a maker that returns an element it built earlier is caught, before
	// that element reaches the mount.
	const maker = typeof item === 'function' && !isComponentCall(item) ? item as (...args: unknown[]) => unknown : null;
	const mounted = maker === null ? item : h(guard(maker));
	const handle = runMount(root, scope, () =>
		mountItem({ root, elem: target, scope, context, owner: null }, mounted, () => null));
	drainRoot(root);
	endHydration(root);
	hydrated.add(target);

	return (arg) => {
		if (arg === getFirst) return handle.first();
		hydrated.delete(target);
		runMount(root, null, () => handle.remove());
		return undefined;
	};
};
