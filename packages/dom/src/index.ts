export { mount, getFirst } from './mount.ts';
export type { Cleanup, Component, Mounted, Mounter, Pending, Remove } from './mount.ts';
export { h } from './h.ts';
export { htm } from './htm.ts';
export type { H } from './htm.ts';
export { hydrate, render } from './render.ts';
export { createDocument, parseHtml, toHtml } from './light.ts';
export type { LightComment, LightDocument, LightElement, LightNode, LightText } from './light.ts';
export { createElement, createTextNode, setAttribute, watch } from './host.ts';
export type { CommentLike, DocumentLike, ElementLike, NodeLike, ParentLike, TextLike } from './types.ts';

import { h } from './h.ts';
import { htm } from './htm.ts';

/**
 * Markup in a template literal, bound to `h`.
 *
 * Example:
 *   mount(document.body, html`<button $onclick=${add}>clicked ${count} times</button>`);
 */
export const html = htm(h);
