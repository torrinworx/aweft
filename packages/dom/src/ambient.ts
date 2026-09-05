// The document nodes are made in, while a mount runs user code.
//
// `h` runs inside component bodies and has no argument for where a node should come from, so
// the mount that runs the body says. Outside any mount the page's document is used, and where
// there is no page, one light document made on first use.
//
// The light tree is not imported here. It registers itself when it is loaded (the bottom of
// `light.ts`), so a page that only mounts into a browser document never reaches this file and
// a bundler can leave the whole tree out of it.

import { assert } from './assert.ts';
import type { DocumentLike } from './types.ts';

let active: DocumentLike | null = null;
let make: (() => DocumentLike) | null = null;
let fallback: DocumentLike | null = null;

export const setActiveDocument = (document: DocumentLike | null): void => {
	active = document;
};

/** Where `h` makes a node outside any mount, on a machine with no page. The light tree
 * registers itself here when it is loaded; nothing else calls this. */
export const setFallbackDocument = (factory: () => DocumentLike): void => {
	make = factory;
};

export const activeDocument = (): DocumentLike => {
	if (active !== null) return active;

	const page = (globalThis as { document?: DocumentLike }).document;
	if (page !== undefined) return page;

	assert(make !== null, 'no document to make nodes in: mount or render into one');
	fallback ??= make!();
	return fallback;
};
