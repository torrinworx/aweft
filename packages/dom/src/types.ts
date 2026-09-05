// What the mounter needs from a node. Structural on purpose: a browser node, a node of the
// light tree and a duck-typed target the application made all fit, and the package typechecks
// with no DOM library.

export interface NodeLike {
	readonly nodeType: number;
	readonly nodeName: string;
	parentNode: ParentLike | null;
	readonly nextSibling: NodeLike | null;
	readonly previousSibling: NodeLike | null;
	readonly firstChild: NodeLike | null;
	readonly lastChild: NodeLike | null;
	readonly ownerDocument?: DocumentLike | null;
	textContent: string | null;
}

/** What a mount target must offer: the three operations the mounter uses on a parent. */
export interface ParentLike {
	insertBefore(node: NodeLike, before: NodeLike | null): unknown;
	removeChild(node: NodeLike): unknown;
	replaceChild(node: NodeLike, old: NodeLike): unknown;
	readonly firstChild?: NodeLike | null;
	textContent?: string | null;
	readonly ownerDocument?: DocumentLike | null;
}

export interface ElementLike extends NodeLike, ParentLike {
	readonly localName: string;
	readonly namespaceURI: string | null;
	setAttribute(name: string, value: string): void;
	getAttribute(name: string): string | null;
	hasAttribute(name: string): boolean;
	removeAttribute(name: string): void;
	getAttributeNames(): string[];
	readonly firstChild: NodeLike | null;
	textContent: string | null;
	[property: string]: unknown;
}

export interface TextLike extends NodeLike {
	data: string;
	splitText(offset: number): TextLike;
}

export interface CommentLike extends NodeLike {
	data: string;
}

/** Where nodes come from. The page's `document`, or the light tree. */
export interface DocumentLike {
	createElement(tag: string): ElementLike;
	createElementNS(namespace: string, tag: string): ElementLike;
	createTextNode(data: string): TextLike;
	createComment(data: string): CommentLike;
}

export const ELEMENT = 1;
export const TEXT = 3;
export const COMMENT = 8;

export const isNodeLike = (value: unknown): value is NodeLike =>
	typeof value === 'object' && value !== null && typeof (value as NodeLike).nodeType === 'number';

/** A scope, cell or derived value: anything with `get` and `effect`. Duck-typed, like a node. */
export const isSource = (value: unknown): value is { get(): unknown; effect(fn: (v: unknown) => void): () => void } =>
	(typeof value === 'object' || typeof value === 'function') && value !== null
	&& typeof (value as { effect?: unknown }).effect === 'function'
	&& typeof (value as { get?: unknown }).get === 'function';
