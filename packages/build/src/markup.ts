// Markup in a template literal, read at build time.
//
// The same dialect the runtime parser reads, over the pieces of the template rather than over a
// string: elements with attributes, `<tag ...>children</tag>`, `<tag />`, `</>` to close the
// innermost open element, a tag from an expression, an attribute value from an expression, a
// spread, and a quoted attribute that mixes text and expressions. Text follows the same
// whitespace rules.
//
// Every refusal the runtime parser makes and this can see in the source is made here instead, so
// a page that would have thrown when it rendered fails the build instead (design 096).

import type { Node } from './ast.ts';
import { type Child, type Element, type Property, childCode, collapseText, emitCall } from './element.ts';
import { transformError } from './error.ts';

export interface MarkupReader {
	/** The name to call for an element: always `dom`'s `h`, whatever else the file calls `h`.
	 * Asked for only when an element is printed as a call, so a file that hoisted every one of
	 * its elements does not import a name nothing uses. */
	h(): string;
	/** One value out of the pieces of a quoted attribute, as code. */
	joined(pieces: readonly string[]): string;
	/** The code for an expression in a hole, with anything nested already transformed. */
	code(node: Node): string;
	/** How an element becomes code, which is where hoisting happens. */
	emit(element: Element): string;
}

interface Cursor {
	readonly strings: readonly string[];
	readonly holes: readonly Node[];
	/** Where each string begins in the file, so a fault has a position. */
	readonly offsets: readonly number[];
	k: number;
	at: number;
}

interface Frame {
	readonly tag: string | null;
	readonly code: string;
	readonly properties: Property[];
	readonly children: Child[];
	readonly at: number;
}

const rest = (c: Cursor): string => c.strings[c.k]!.slice(c.at);
const atHole = (c: Cursor): boolean => c.at >= c.strings[c.k]!.length && c.k < c.holes.length;
const atEnd = (c: Cursor): boolean => c.at >= c.strings[c.k]!.length && c.k >= c.holes.length;
const here = (c: Cursor): number => c.offsets[c.k]! + c.at;

const takeHole = (c: Cursor): Node => {
	const node = c.holes[c.k]!;
	c.k += 1;
	c.at = 0;
	return node;
};

/** Skip whitespace inside the current string. Stops at a hole or the end of the piece. */
const skipSpace = (c: Cursor): void => {
	const gap = rest(c).search(/\S/);
	c.at = gap < 0 ? c.strings[c.k]!.length : c.at + gap;
};

const nameOf = (frame: Frame): string => frame.tag ?? 'an element';

/** Attributes until the tag closes. Answers whether the tag closed itself. */
const readAttributes = (c: Cursor, frame: Frame, reader: MarkupReader): boolean => {
	for (;;) {
		if (atHole(c)) {
			frame.properties.push({ kind: 'spread', code: reader.code(takeHole(c)) });
			continue;
		}
		skipSpace(c);
		if (atHole(c)) continue;
		if (atEnd(c)) {
			throw transformError('unterminated-tag', `unterminated <${nameOf(frame)}>`,
				'Close the opening tag with > or />.', frame.at);
		}

		const text = rest(c);
		if (text.startsWith('/>')) {
			c.at += 2;
			return true;
		}
		if (text[0] === '>') {
			c.at += 1;
			return false;
		}
		if (text[0] === '=') {
			c.at += 1;
			skipSpace(c);
			if (!atHole(c)) {
				throw transformError('spread-needs-hole', 'a spread is written =${object}',
					'Put the object in a hole, written as =${object}.', here(c));
			}
			frame.properties.push({ kind: 'spread', code: reader.code(takeHole(c)) });
			continue;
		}

		const match = /^[^\s"'>/=]+/.exec(text);
		if (match === null) {
			throw transformError('bad-attribute-name',
				`unexpected ${JSON.stringify(text[0])} in <${nameOf(frame)}>`,
				'Start the attribute with a name, or close the tag.', here(c));
		}
		const name = match[0];
		c.at += name.length;

		skipSpace(c);
		if (atHole(c) || atEnd(c) || rest(c)[0] !== '=') {
			frame.properties.push({ kind: 'static', name, value: true });
			continue;
		}
		c.at += 1;
		skipSpace(c);

		if (atHole(c)) {
			frame.properties.push({ kind: 'expr', name, code: reader.code(takeHole(c)) });
			continue;
		}
		if (atEnd(c)) {
			throw transformError('attribute-needs-value', `${name} needs a value`,
				'Give the attribute a value, or drop the = to make it true.', here(c));
		}

		const quote = rest(c)[0];
		if (quote === '"' || quote === "'") {
			c.at += 1;
			frame.properties.push(quoted(c, name, quote, reader));
			continue;
		}

		const bare = /^[^\s>]+/.exec(rest(c));
		if (bare === null) {
			throw transformError('attribute-needs-value', `${name} needs a value`,
				'Give the attribute a value, or drop the = to make it true.', here(c));
		}
		frame.properties.push({ kind: 'static', name, value: bare[0] });
		c.at += bare[0].length;
	}
};

/** A quoted value: one piece stays as it is, several become one value through `joined`. */
const quoted = (c: Cursor, name: string, quote: string, reader: MarkupReader): Property => {
	const parts: { readonly text: string | null; readonly code: string | null }[] = [];
	let piece = '';
	for (;;) {
		if (atHole(c)) {
			if (piece !== '') parts.push({ text: piece, code: null });
			piece = '';
			parts.push({ text: null, code: reader.code(takeHole(c)) });
			continue;
		}
		if (atEnd(c)) {
			throw transformError('unterminated-attribute', `unterminated attribute ${name}`,
				'Close the value with the same quote it opened with.', here(c));
		}
		const close = rest(c).indexOf(quote);
		if (close < 0) {
			piece += rest(c);
			c.at = c.strings[c.k]!.length;
			continue;
		}
		piece += rest(c).slice(0, close);
		c.at += close + 1;
		break;
	}
	if (piece !== '' || parts.length === 0) parts.push({ text: piece, code: null });

	if (parts.length === 1) {
		const only = parts[0]!;
		return only.code === null
			? { kind: 'static', name, value: only.text! }
			: { kind: 'expr', name, code: only.code };
	}
	const pieces = parts.map((part) => (part.code === null ? JSON.stringify(part.text) : part.code));
	return { kind: 'expr', name, code: reader.joined(pieces) };
};

/**
 * Read markup in a template literal.
 *
 * Params:
 *   node: the TaggedTemplateExpression whose tag is `dom`'s `html`
 *   reader: the names to call, how to write an expression, and how to emit an element
 *
 * Returns: the code that replaces the template. `null` when the markup is empty, one item when
 * it holds one, and an array when it holds several, which is what the runtime parser answers.
 *
 * Example:
 *   magic.overwrite(node.start, node.end, readMarkup(node, reader));
 */
export const readMarkup = (node: Node, reader: MarkupReader): string => {
	const quasi = node['quasi'] as Node;
	const pieces = quasi['quasis'] as Node[];
	const strings: string[] = [];
	const offsets: number[] = [];
	for (const piece of pieces) {
		const cooked = (piece['value'] as { cooked?: string | null })['cooked'];
		if (cooked === null || cooked === undefined) {
			throw transformError('invalid-escape', 'markup cannot hold an invalid escape sequence',
				'Use an escape the template accepts, or write the character itself.', piece.start);
		}
		strings.push(cooked);
		offsets.push(piece.start);
	}

	const c: Cursor = { strings, holes: quasi['expressions'] as Node[], offsets, k: 0, at: 0 };
	const root: Frame = { tag: null, code: 'null', properties: [], children: [], at: node.start };
	const stack: Frame[] = [root];
	const top = (): Frame => stack[stack.length - 1]!;

	let text = '';
	const flushText = (): void => {
		const collapsed = collapseText(text);
		if (collapsed !== '') top().children.push({ kind: 'text', text: collapsed });
		text = '';
	};
	const close = (frame: Frame): void => {
		const element: Element = {
			tag: frame.tag,
			properties: frame.properties,
			children: frame.children,
			fallback: () => emitCall(reader.h(), frame.code, element, reader.emit),
		};
		top().children.push({ kind: 'element', element });
	};

	for (;;) {
		if (atHole(c)) {
			flushText();
			top().children.push({ kind: 'code', code: reader.code(takeHole(c)) });
			continue;
		}
		if (atEnd(c)) break;

		const text0 = rest(c);
		const open = text0.indexOf('<');
		if (open < 0) {
			text += text0;
			c.at += text0.length;
			continue;
		}
		text += text0.slice(0, open);
		c.at += open;

		if (text0.startsWith('<!--', open)) {
			flushText();
			const end = text0.indexOf('-->', open);
			if (end < 0) {
				throw transformError('unterminated-comment', 'a comment must end in the same template piece',
					'Close the comment with --> before the next hole.', here(c));
			}
			c.at += end - open + 3;
			continue;
		}

		flushText();
		if (text0.startsWith('</', open)) {
			c.at += 2;
			const closingAt = here(c);
			let name = '';
			for (;;) {
				if (atHole(c)) {
					takeHole(c);
					continue;
				}
				if (atEnd(c)) {
					throw transformError('unterminated-closing-tag', 'unterminated closing tag',
						'End the closing tag with >.', closingAt);
				}
				const end = rest(c).indexOf('>');
				if (end < 0) {
					name += rest(c);
					c.at = c.strings[c.k]!.length;
					continue;
				}
				name += rest(c).slice(0, end);
				c.at += end + 1;
				break;
			}
			name = name.trim();
			const frame = stack.pop();
			if (frame === undefined || frame === root) {
				throw transformError('nothing-to-close', 'a closing tag with nothing open',
					'Remove the closing tag, or open the element it closes.', closingAt);
			}
			if (name !== '' && frame.tag !== null && frame.tag !== name) {
				throw transformError('mismatched-closing-tag', `</${name}> closes <${frame.tag}>`,
					'Name the element being closed, or write </> for the innermost one.', closingAt);
			}
			close(frame);
			continue;
		}

		const openAt = here(c);
		c.at += 1;
		let tag: string | null = null;
		let code: string;
		if (atHole(c)) {
			code = reader.code(takeHole(c));
		} else {
			const match = /^[^\s/>]+/.exec(rest(c));
			if (match === null) {
				throw transformError('tag-needs-name', 'a tag needs a name',
					'Put a tag name after the <, or write the tag as a hole.', openAt);
			}
			tag = match[0];
			code = JSON.stringify(tag);
			c.at += tag.length;
		}
		const frame: Frame = { tag, code, properties: [], children: [], at: openAt };
		if (readAttributes(c, frame, reader)) close(frame);
		else stack.push(frame);
	}
	flushText();
	if (stack.length !== 1) {
		throw transformError('unclosed-element', `unclosed <${nameOf(top())}>`,
			'Close the element, or write it as <tag /> if it has no children.', top().at);
	}

	const out = root.children;
	if (out.length === 0) return 'null';
	if (out.length === 1) return childCode(out[0]!, reader.emit);
	return `[${out.map((child) => childCode(child, reader.emit)).join(', ')}]`;
};
