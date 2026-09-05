// The document nodes are made in, while a mount runs user code.
//
// `h` runs inside component bodies and has no argument for where a node should come from, so
// the mount that runs the body says. Outside any mount the page's document is used, and where
// there is no page, one light document made on first use.

import type { DocumentLike } from './types.ts';
import { createDocument } from './light.ts';

let active: DocumentLike | null = null;
let fallback: DocumentLike | null = null;

export const setActiveDocument = (document: DocumentLike | null): void => {
	active = document;
};

export const activeDocument = (): DocumentLike => {
	if (active !== null) return active;
	const page = (globalThis as { document?: DocumentLike }).document;
	if (page !== undefined) return page;
	fallback ??= createDocument();
	return fallback;
};
