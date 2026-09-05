// Static render and hydration: the two other modes of the one mount (designs 077, 078).

import { assert } from './assert.ts';
import { Hydration } from './hydration.ts';
import { createDocument, toHtml } from './light.ts';
import { type Remove, createRoot, drainRoot, endHydration, getFirst, mountItem, pendingOf, runMount } from './mount.ts';
import type { DocumentLike, ParentLike } from './types.ts';

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
 *   item: the same item the server rendered
 *   context: the opaque value every mounter below receives
 *
 * Returns: the remove function, as `mount` does. Server nodes are adopted, not rebuilt: a
 * matching element keeps its identity and gains the properties and listeners the client
 * gives it. A mismatch asserts in development; in production the region that differs is
 * replaced with what the client built. One live hydration per target: a second call over the
 * same target asserts, because it would claim the first one's nodes.
 *
 * Example:
 *   hydrate(document.body, h(App, { url: location.pathname }));
 */
const hydrated = new WeakSet<ParentLike>();

export const hydrate = (target: ParentLike, item: unknown, context?: unknown): Remove => {
	assert(!hydrated.has(target), 'hydrate: the target already holds a live hydration; remove that one first');
	const own = target.ownerDocument;
	const page = (globalThis as { document?: DocumentLike }).document;
	const document = own ?? page;
	assert(document !== undefined && document !== null, 'hydrate needs a document: the target has none and there is no page');

	const hydration = new Hydration();
	const root = createRoot(document!, false, hydration);
	const scope = hydration.top(target);
	const handle = runMount(root, scope, () =>
		mountItem({ root, elem: target, scope, context, owner: null }, item, () => null));
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
