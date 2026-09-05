// The recording host: a light document that writes down every node operation, so a test can
// assert exactly what a mount did to the tree and not only what the tree looks like after.

import { createDocument } from '@aweftjs/dom';
import type { DocumentLike, ElementLike, NodeLike } from '@aweftjs/dom';

export interface Recording {
	readonly document: DocumentLike & { readonly body: ElementLike; readonly head: ElementLike };
	/** One line per operation, in order. Clear it between the steps of a test. */
	readonly ops: string[];
}

const dataOf = (node: NodeLike): string => (node as unknown as { data: string }).data;

const label = (node: NodeLike | null): string => {
	if (node === null) return 'end';
	if (node.nodeType === 1) return `<${(node as ElementLike).localName}>`;
	if (node.nodeType === 3) return JSON.stringify(dataOf(node));
	if (node.nodeType === 8) return `<!--${dataOf(node)}-->`;
	return node.nodeName;
};

type Ops = string[];
const observed = new WeakSet<object>();

/** Record a node and everything under it. Nodes made elsewhere join when they are inserted. */
const observe = (node: NodeLike, ops: Ops): void => {
	if (observed.has(node)) return;
	observed.add(node);
	for (let n = node.firstChild; n !== null; n = n.nextSibling) observe(n, ops);

	const target = node as unknown as Record<string, unknown>;
	const proto = Object.getPrototypeOf(node) as Record<string, (...args: unknown[]) => unknown>;

	target['insertBefore'] = function (this: NodeLike, child: NodeLike, before: NodeLike | null) {
		observe(child, ops);
		ops.push(`insert ${label(child)} into ${label(this)} before ${label(before)}`);
		return proto['insertBefore']!.call(this, child, before);
	};
	target['removeChild'] = function (this: NodeLike, child: NodeLike) {
		ops.push(`remove ${label(child)} from ${label(this)}`);
		return proto['removeChild']!.call(this, child);
	};
	target['replaceChild'] = function (this: NodeLike, child: NodeLike, old: NodeLike) {
		ops.push(`replace ${label(old)} with ${label(child)} in ${label(this)}`);
		return proto['replaceChild']!.call(this, child, old);
	};

	const text = Object.getOwnPropertyDescriptor(proto, 'textContent')
		?? Object.getOwnPropertyDescriptor(Object.getPrototypeOf(proto) as object, 'textContent');
	if (text?.set !== undefined && text.get !== undefined) {
		const { get, set } = text;
		Object.defineProperty(node, 'textContent', {
			get,
			set(this: NodeLike, value: string) {
				ops.push(`clear ${label(this)}${value === '' ? '' : ` to ${JSON.stringify(value)}`}`);
				set.call(this, value);
			},
			configurable: true,
		});
	}

	if (node.nodeType === 3 || node.nodeType === 8) {
		let data = dataOf(node);
		Object.defineProperty(node, 'data', {
			get: () => data,
			set: (value: string) => {
				ops.push(`text ${JSON.stringify(data)} -> ${JSON.stringify(value)}`);
				data = value;
			},
			configurable: true,
		});
	}

	if (node.nodeType === 1) {
		const element = node as ElementLike;
		const setAttribute = element.setAttribute.bind(element);
		const removeAttribute = element.removeAttribute.bind(element);
		target['setAttribute'] = (name: string, value: string) => {
			ops.push(`attr ${name}=${JSON.stringify(String(value))} on ${label(element)}`);
			setAttribute(name, value);
		};
		target['removeAttribute'] = (name: string) => {
			ops.push(`unattr ${name} on ${label(element)}`);
			removeAttribute(name);
		};
	}
};

/**
 * A light document that records what is done to it.
 *
 * Returns: the document and its `ops`, one line per operation: `insert <li> into <ul> before
 * end`, `remove <li> from <ul>`, `text "a" -> "b"`, `attr class="x" on <div>`, `unattr class
 * on <div>`, `clear <ul>`. Nodes made through the document's factories are recorded; nodes
 * from elsewhere are not.
 *
 * Example:
 *   const { document, ops } = recordingDocument();
 *   mount(document.body, h('p', {}, 'hi'));
 *   assert.deepEqual(ops, ['insert "hi" into <p> before end', 'insert <p> into <body> before end']);
 */
export const recordingDocument = (): Recording => {
	const ops: Ops = [];
	const document = createDocument();
	const doc = document as unknown as Record<string, (...args: unknown[]) => NodeLike>;
	for (const factory of ['createElement', 'createElementNS', 'createTextNode', 'createComment']) {
		const make = doc[factory]!.bind(document);
		doc[factory] = (...args: unknown[]) => {
			const node = make(...args);
			observe(node, ops);
			return node;
		};
	}
	observe(document.body, ops);
	observe(document.head, ops);
	return { document, ops };
};
