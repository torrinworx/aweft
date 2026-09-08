// The light tree: enough of a document to render into with no browser, and to parse a page
// back into so it can be hydrated where there is none. Serialization and parsing live here
// too, because they are what the tree is for.
//
// Only what the mounter and a page need: nodes with a parent and siblings, attributes, a
// style map, class list, properties, listeners that are kept and never fired. Nothing here
// enforces HTML's tree-construction rules; markup round-trips only if it was written so the
// browser's parser produces the same tree, and design 078 says what that asks of a page.

import { codecError } from '@aweftjs/codec';

import { setFallbackDocument } from './ambient.ts';
import type { CommentLike, DocumentLike, ElementLike, NodeLike, ParentLike, TextLike } from './types.ts';
import { COMMENT, ELEMENT, TEXT } from './types.ts';

const HTML = 'http://www.w3.org/1999/xhtml';
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style']);

// How Node prints a light node. Without this, a failed assertion on two nodes renders them
// with every getter fired through parent and sibling links, which is unbounded: one such
// message reached tens of gigabytes. A node prints as its own markup, cut short.
const INSPECT = Symbol.for('nodejs.util.inspect.custom');
const LIMIT = 200;
const short = (markup: string): string => (markup.length > LIMIT ? `${markup.slice(0, LIMIT)}...` : markup);

/** Own but not enumerable: what links a node to the tree is not part of how it prints. */
const link = (target: object, names: readonly string[]): void => {
	for (const name of names) Object.defineProperty(target, name, { value: null, writable: true, enumerable: false });
};

export class LightNode implements NodeLike {
	readonly nodeType: number;
	readonly nodeName: string;
	declare readonly ownerDocument: LightDocument;
	declare parentNode: LightNode | null;
	declare nextSibling: LightNode | null;
	declare previousSibling: LightNode | null;
	declare firstChild: LightNode | null;
	declare lastChild: LightNode | null;

	constructor(nodeType: number, nodeName: string, ownerDocument: LightDocument) {
		this.nodeType = nodeType;
		this.nodeName = nodeName;
		// Node's assertion messages print every enumerable property to depth 1000, and a tree
		// whose links are enumerable prints itself once per path through them. A failed
		// comparison of two nodes once produced a message of tens of gigabytes that way.
		link(this, ['ownerDocument', 'parentNode', 'nextSibling', 'previousSibling', 'firstChild', 'lastChild']);
		(this as { ownerDocument: LightDocument }).ownerDocument = ownerDocument;
	}

	get childNodes(): LightNode[] {
		const out: LightNode[] = [];
		for (let n = this.firstChild; n !== null; n = n.nextSibling) out.push(n);
		return out;
	}

	get children(): LightElement[] {
		return this.childNodes.filter((n): n is LightElement => n.nodeType === ELEMENT);
	}

	get isConnected(): boolean {
		let n: LightNode | null = this;
		while (n !== null) {
			if (n.nodeType === 9) return true;
			n = n.parentNode;
		}
		return false;
	}

	appendChild(node: LightNode): LightNode {
		return this.insertBefore(node, null);
	}

	/**
	 * Put a node in front of one of this node's children, or at the end when `before` is null.
	 *
	 * Throws: `not-a-child` when the reference node belongs to someone else, as a browser
	 * throws rather than guessing where the node was meant to go.
	 */
	insertBefore(node: LightNode, before: LightNode | null): LightNode {
		if (before !== null && before.parentNode !== this) {
			throw codecError('not-a-child', 'the reference node is not a child of this node',
				'Pass one of this node\'s children as the reference, or null to append.');
		}
		if (node === before) return node;
		if (node.parentNode !== null) unlink(node.parentNode, node);
		node.parentNode = this;
		node.nextSibling = before;
		node.previousSibling = before === null ? this.lastChild : before.previousSibling;
		if (node.previousSibling !== null) node.previousSibling.nextSibling = node;
		else this.firstChild = node;
		if (before !== null) before.previousSibling = node;
		else this.lastChild = node;
		return node;
	}

	/**
	 * Take one of this node's children back out.
	 *
	 * Throws: `not-a-child` when the node is somewhere else in the tree.
	 */
	removeChild(node: LightNode): LightNode {
		if (node.parentNode !== this) {
			throw codecError('not-a-child', 'the node is not a child of this node',
				'Call removeChild on the node\'s own parent, which parentNode names.');
		}
		unlink(this, node);
		return node;
	}

	/**
	 * Swap one of this node's children for another.
	 *
	 * Throws: `not-a-child` when `old` belongs to someone else.
	 */
	replaceChild(node: LightNode, old: LightNode): LightNode {
		this.insertBefore(node, old);
		return this.removeChild(old);
	}

	remove(): void {
		this.parentNode?.removeChild(this);
	}

	/** A copy of this node alone. Every kind that carries anything overrides it. */
	protected cloneSelf(): LightNode {
		return new LightNode(this.nodeType, this.nodeName, this.ownerDocument);
	}

	/**
	 * A copy of this node, with its subtree when `deep`. As in a browser, only what the markup
	 * carries comes along: attributes do, properties and listeners do not.
	 */
	cloneNode(deep = false): LightNode {
		const copy = this.cloneSelf();
		if (deep) for (let n = this.firstChild; n !== null; n = n.nextSibling) copy.appendChild(n.cloneNode(true));
		return copy;
	}

	contains(node: LightNode | null): boolean {
		for (let n = node; n !== null; n = n.parentNode) if (n === this) return true;
		return false;
	}

	get textContent(): string | null {
		let out = '';
		for (let n = this.firstChild; n !== null; n = n.nextSibling) {
			if (n.nodeType !== COMMENT) out += n.textContent ?? '';
		}
		return out;
	}

	[INSPECT](): string {
		return `${this.constructor.name} ${short(toHtml(this))}`;
	}

	set textContent(value: string | null) {
		// One operation, as in a browser: the children are let go together.
		while (this.firstChild !== null) unlink(this, this.firstChild);
		const text = value ?? '';
		if (text !== '') this.appendChild(this.ownerDocument.createTextNode(text));
	}
}

export class LightText extends LightNode implements TextLike {
	data: string;

	constructor(data: string, ownerDocument: LightDocument) {
		super(TEXT, '#text', ownerDocument);
		this.data = data;
	}

	override get textContent(): string {
		return this.data;
	}

	override set textContent(value: string | null) {
		this.data = value ?? '';
	}

	get length(): number {
		return this.data.length;
	}

	protected override cloneSelf(): LightText {
		return new LightText(this.data, this.ownerDocument);
	}

	splitText(offset: number): LightText {
		const rest = new LightText(this.data.slice(offset), this.ownerDocument);
		this.data = this.data.slice(0, offset);
		this.parentNode?.insertBefore(rest, this.nextSibling);
		return rest;
	}
}

export class LightComment extends LightNode implements CommentLike {
	data: string;

	constructor(data: string, ownerDocument: LightDocument) {
		super(COMMENT, '#comment', ownerDocument);
		this.data = data;
	}

	protected override cloneSelf(): LightComment {
		return new LightComment(this.data, this.ownerDocument);
	}

	override get textContent(): string {
		return this.data;
	}

	override set textContent(value: string | null) {
		this.data = value ?? '';
	}
}

/** Take a node out of its parent's chain. The one place the links are undone. */
const unlink = (parent: LightNode, node: LightNode): void => {
	if (node.previousSibling !== null) node.previousSibling.nextSibling = node.nextSibling;
	else parent.firstChild = node.nextSibling;
	if (node.nextSibling !== null) node.nextSibling.previousSibling = node.previousSibling;
	else parent.lastChild = node.previousSibling;
	node.parentNode = node.nextSibling = node.previousSibling = null;
};

const kebab = (name: string): string => name.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);

/** A style map that reads and writes like `element.style`, and prints as `cssText`. */
export class LightStyle {
	private readonly declared = new Map<string, string>();
	[property: string]: unknown;

	constructor() {
		return new Proxy(this, {
			get: (target, key, receiver) => {
				if (typeof key !== 'string' || key in target) return Reflect.get(target, key, receiver) as unknown;
				return target.declared.get(kebab(key)) ?? '';
			},
			set: (target, key, value) => {
				if (typeof key !== 'string' || key in target) return Reflect.set(target, key, value);
				target.setProperty(kebab(key), value === null || value === undefined ? '' : String(value));
				return true;
			},
		});
	}

	setProperty(name: string, value: string): void {
		if (value === '') this.declared.delete(name);
		else this.declared.set(name, value);
	}

	removeProperty(name: string): void {
		this.declared.delete(name);
	}

	getPropertyValue(name: string): string {
		return this.declared.get(name) ?? '';
	}

	get cssText(): string {
		return [...this.declared].map(([k, v]) => `${k}: ${v};`).join(' ');
	}

	[INSPECT](): string {
		return `LightStyle { ${this.cssText} }`;
	}

	set cssText(text: string) {
		this.declared.clear();
		for (const part of text.split(';')) {
			const at = part.indexOf(':');
			if (at < 0) continue;
			this.setProperty(part.slice(0, at).trim(), part.slice(at + 1).trim());
		}
	}
}

/** A class list over the `class` attribute. */
export class LightClassList {
	private declare readonly element: LightElement;

	constructor(element: LightElement) {
		link(this, ['element']);
		(this as unknown as { element: LightElement }).element = element;
	}

	private read(): string[] {
		return (this.element.getAttribute('class') ?? '').split(/\s+/).filter((c) => c !== '');
	}

	private write(classes: string[]): void {
		if (classes.length === 0) this.element.removeAttribute('class');
		else this.element.setAttribute('class', classes.join(' '));
	}

	add(...names: string[]): void {
		const classes = this.read();
		for (const name of names) if (!classes.includes(name)) classes.push(name);
		this.write(classes);
	}

	remove(...names: string[]): void {
		this.write(this.read().filter((c) => !names.includes(c)));
	}

	toggle(name: string, force?: boolean): boolean {
		const on = force ?? !this.contains(name);
		if (on) this.add(name);
		else this.remove(name);
		return on;
	}

	contains(name: string): boolean {
		return this.read().includes(name);
	}

	get length(): number {
		return this.read().length;
	}

	[Symbol.iterator](): Iterator<string> {
		return this.read()[Symbol.iterator]();
	}

	[INSPECT](): string {
		return `LightClassList [ ${this.read().join(' ')} ]`;
	}
}

/**
 * An element in the light tree, named the way a browser names one: `tagName` and `nodeName` are
 * the uppercase name for an HTML element and `localName` is the lowercase one, while an element
 * in another namespace keeps the case it was made with in all three. Match on `localName`.
 */
export class LightElement extends LightNode implements ElementLike {
	readonly localName: string;
	readonly tagName: string;
	readonly namespaceURI: string;
	readonly attributes = new Map<string, string>();
	readonly style: LightStyle = new LightStyle();
	readonly classList: LightClassList;
	readonly listeners = new Map<string, Set<(event: unknown) => void>>();
	[property: string]: unknown;

	constructor(localName: string, namespaceURI: string, ownerDocument: LightDocument) {
		super(ELEMENT, namespaceURI === HTML ? localName.toUpperCase() : localName, ownerDocument);
		this.localName = localName;
		this.tagName = this.nodeName;
		this.namespaceURI = namespaceURI;
		this.classList = new LightClassList(this);
	}

	protected override cloneSelf(): LightElement {
		const copy = new LightElement(this.localName, this.namespaceURI, this.ownerDocument);
		for (const [name, value] of this.attributes) copy.attributes.set(name, value);
		copy.style.cssText = this.style.cssText;
		return copy;
	}

	setAttribute(name: string, value: string): void {
		this.attributes.set(name, String(value));
	}

	getAttribute(name: string): string | null {
		return this.attributes.get(name) ?? null;
	}

	hasAttribute(name: string): boolean {
		return this.attributes.has(name);
	}

	removeAttribute(name: string): void {
		this.attributes.delete(name);
	}

	toggleAttribute(name: string, force?: boolean): boolean {
		const on = force ?? !this.attributes.has(name);
		if (on) this.attributes.set(name, '');
		else this.attributes.delete(name);
		return on;
	}

	getAttributeNames(): string[] {
		return [...this.attributes.keys()];
	}

	get id(): string {
		return this.getAttribute('id') ?? '';
	}

	set id(value: string) {
		this.setAttribute('id', value);
	}

	get className(): string {
		return this.getAttribute('class') ?? '';
	}

	set className(value: string) {
		this.setAttribute('class', value);
	}

	get innerHTML(): string {
		return toHtml(this.childNodes);
	}

	set innerHTML(markup: string) {
		while (this.firstChild !== null) this.removeChild(this.firstChild);
		for (const node of parseHtml(markup, this.ownerDocument)) this.appendChild(node);
	}

	get outerHTML(): string {
		return toHtml(this);
	}

	addEventListener(type: string, listener: (event: unknown) => void): void {
		let set = this.listeners.get(type);
		if (set === undefined) {
			set = new Set();
			this.listeners.set(type, set);
		}
		set.add(listener);
	}

	removeEventListener(type: string, listener: (event: unknown) => void): void {
		this.listeners.get(type)?.delete(listener);
	}

	/** Deliver an event to this element's listeners and its `on<type>` property. No bubbling. */
	dispatchEvent(event: { type: string }): boolean {
		const handler = this[`on${event.type}`];
		if (typeof handler === 'function') (handler as (e: unknown) => void).call(this, event);
		for (const listener of this.listeners.get(event.type) ?? []) listener(event);
		return true;
	}
}

export class LightDocument extends LightNode implements DocumentLike {
	declare readonly documentElement: LightElement;
	declare readonly head: LightElement;
	declare readonly body: LightElement;

	constructor() {
		super(9, '#document', undefined as unknown as LightDocument);
		(this as { ownerDocument: LightDocument }).ownerDocument = this;
		// The three roots are reached through the links, so they need not print either.
		link(this, ['documentElement', 'head', 'body']);
		const self = this as { documentElement: LightElement; head: LightElement; body: LightElement };
		self.documentElement = this.createElement('html');
		self.head = this.createElement('head');
		self.body = this.createElement('body');
		this.documentElement.appendChild(this.head);
		this.documentElement.appendChild(this.body);
		this.appendChild(this.documentElement);
	}

	createElement(tag: string): LightElement {
		return new LightElement(tag.toLowerCase(), HTML, this);
	}

	createElementNS(namespace: string, tag: string): LightElement {
		return new LightElement(tag, namespace, this);
	}

	createTextNode(data: string): LightText {
		return new LightText(String(data), this);
	}

	createComment(data: string): LightComment {
		return new LightComment(String(data), this);
	}
}

/**
 * A document with no browser behind it.
 *
 * Returns: a light document with `documentElement`, `head` and `body`, and the factories a
 * mount needs. Nodes made by different light documents mix freely.
 *
 * Example:
 *   const doc = createDocument();
 *   mount(doc.body, h('p', {}, 'hello'));
 *   toHtml(doc.body);  // '<body><p>hello</p></body>'
 */
export const createDocument = (): LightDocument => new LightDocument();

const escapeText = (text: string): string =>
	text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const escapeAttribute = (text: string): string =>
	text.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

const serialize = (node: NodeLike, out: string[]): void => {
	if (node.nodeType === TEXT) {
		out.push(escapeText((node as TextLike).data));
		return;
	}
	if (node.nodeType === COMMENT) {
		out.push(`<!--${(node as CommentLike).data}-->`);
		return;
	}
	if (node.nodeType !== ELEMENT) {
		for (let n = node.firstChild; n !== null; n = n.nextSibling) serialize(n, out);
		return;
	}

	const element = node as LightElement;
	const tag = element.localName;
	out.push('<', tag);
	for (const [name, value] of element.attributes) {
		out.push(' ', name);
		if (value !== '') out.push('="', escapeAttribute(value), '"');
	}
	const style = element.style.cssText;
	if (style !== '' && !element.attributes.has('style')) out.push(' style="', escapeAttribute(style), '"');
	out.push('>');
	if (VOID.has(tag)) return;

	if (RAW.has(tag)) {
		for (let n = element.firstChild; n !== null; n = n.nextSibling) {
			if (n.nodeType === TEXT) out.push((n as LightText).data);
		}
	} else {
		for (let n = element.firstChild; n !== null; n = n.nextSibling) serialize(n, out);
	}
	out.push('</', tag, '>');
};

/**
 * Markup for a light node, or for a list of them.
 *
 * Params:
 *   node: a light node, or an array of light nodes serialized in order
 *
 * Returns: the markup, with text and attribute values escaped, void elements unclosed and
 * `script` and `style` contents raw. No doctype; a page adds its own.
 *
 * Example:
 *   toHtml(doc.body.childNodes);
 */
export const toHtml = (node: NodeLike | readonly NodeLike[]): string => {
	const out: string[] = [];
	if (Array.isArray(node)) for (const n of node as readonly NodeLike[]) serialize(n, out);
	else serialize(node as NodeLike, out);
	return out.join('');
};

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

const decode = (text: string): string =>
	text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, body: string) => {
		if (body[0] === '#') {
			const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
			return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
		}
		return ENTITIES[body] ?? whole;
	});

/**
 * Parse markup into light nodes.
 *
 * Params:
 *   markup: what `toHtml` wrote, or any markup in that shape
 *   document: the light document the nodes belong to; a fresh one when omitted
 *
 * Returns: the top-level nodes in order. Tags, attributes, comments and entities are read;
 * the browser's implied elements and auto-closing rules are not applied, so give it markup
 * that needs neither.
 *
 * Example:
 *   const [page] = parseHtml(html);
 *   hydrate(doc.body, App);
 */
export const parseHtml = (markup: string, document: LightDocument = createDocument()): LightNode[] => {
	const roots: LightNode[] = [];
	const stack: LightElement[] = [];
	const append = (node: LightNode): void => {
		const parent = stack[stack.length - 1];
		if (parent === undefined) roots.push(node);
		else parent.appendChild(node);
	};

	let at = 0;
	while (at < markup.length) {
		const open = markup.indexOf('<', at);
		if (open < 0) {
			append(document.createTextNode(decode(markup.slice(at))));
			break;
		}
		if (open > at) append(document.createTextNode(decode(markup.slice(at, open))));

		if (markup.startsWith('<!--', open)) {
			const end = markup.indexOf('-->', open + 4);
			const close = end < 0 ? markup.length : end;
			append(document.createComment(markup.slice(open + 4, close)));
			at = close + 3;
			continue;
		}
		if (markup.startsWith('<!', open) || markup.startsWith('<?', open)) {
			const end = markup.indexOf('>', open);
			at = end < 0 ? markup.length : end + 1;
			continue;
		}
		if (markup.startsWith('</', open)) {
			const end = markup.indexOf('>', open);
			const name = markup.slice(open + 2, end < 0 ? markup.length : end).trim().toLowerCase();
			for (let i = stack.length - 1; i >= 0; i--) {
				if (stack[i]!.localName === name) {
					stack.length = i;
					break;
				}
			}
			at = end < 0 ? markup.length : end + 1;
			continue;
		}

		// An opening tag: the name, then attributes until `>` or `/>`.
		const nameEnd = markup.slice(open + 1).search(/[\s/>]/);
		const name = (nameEnd < 0 ? markup.slice(open + 1) : markup.slice(open + 1, open + 1 + nameEnd)).toLowerCase();
		const element = document.createElement(name);
		let cursor = nameEnd < 0 ? markup.length : open + 1 + nameEnd;
		let selfClosing = false;
		for (;;) {
			const rest = markup.slice(cursor);
			const skip = rest.search(/\S/);
			if (skip < 0) {
				cursor = markup.length;
				break;
			}
			cursor += skip;
			if (markup.startsWith('/>', cursor)) {
				selfClosing = true;
				cursor += 2;
				break;
			}
			if (markup[cursor] === '>') {
				cursor += 1;
				break;
			}
			const attr = /^([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/.exec(markup.slice(cursor));
			if (attr === null) {
				cursor += 1;
				continue;
			}
			const value = attr[2] ?? attr[3] ?? attr[4] ?? '';
			element.setAttribute(attr[1]!, decode(value));
			cursor += attr[0].length;
		}
		append(element);
		at = cursor;

		if (selfClosing || VOID.has(name)) continue;
		if (RAW.has(name)) {
			const close = markup.toLowerCase().indexOf(`</${name}`, at);
			const end = close < 0 ? markup.length : close;
			if (end > at) element.appendChild(document.createTextNode(markup.slice(at, end)));
			const tagEnd = markup.indexOf('>', end);
			at = tagEnd < 0 ? markup.length : tagEnd + 1;
			continue;
		}
		stack.push(element);
	}

	return roots;
};

export type { ParentLike };

// `h` outside any mount, on a machine with no page, makes its nodes here. The registration
// lives at this end rather than in `ambient.ts` so that a page which mounts into a browser
// document never reaches this file, and marked pure so that a bundler may drop this file
// entirely: without the annotation one call here keeps the whole tree in every page.
//
// A bundle that does keep this file loses the registration with it, and `h` outside a mount
// then says so rather than guessing. Both other modes already know their document: `mount`
// takes the target's, and `render` makes one.
/* @__PURE__ */ setFallbackDocument(createDocument);
