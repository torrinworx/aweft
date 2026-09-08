export { mount, getFirst, isComponentCall } from './mount.ts';
export type { Cleanup, Component, Mounted, Mounter, Pending, Remove } from './mount.ts';
export { h } from './h.ts';
export { htm, joined } from './htm.ts';
export type { H } from './htm.ts';
export { template } from './template.ts';
export type { Template, TemplateAttributes, TemplateChild, TemplateEdit, TemplateElement } from './template.ts';
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
 * Annotated pure so a bundler drops the binding, and the parser behind it, out of a page that
 * never writes `html`. Nothing else in the package reaches `htm`.
 *
 * Example:
 *   mount(document.body, html`<button $onclick=${add}>clicked ${count} times</button>`);
 */
export const html = /* @__PURE__ */ htm(h);
