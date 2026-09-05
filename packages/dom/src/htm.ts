// The `html` tag: markup in a template literal, turned into `h` calls at runtime, so a page
// needs no build step.
//
// Grammar: elements with attributes, `<tag ...>children</tag>`, `<tag />`, and `</>` to close
// the innermost open element; a tag can be an expression (`<${Component}>`), and so can an
// attribute value (`$onclick=${fn}`), a spread (`=${props}`), or a child (`${cell}`). A quoted
// attribute may mix text and expressions. Text follows the JSX whitespace rules: a line is
// trimmed, a blank line goes, and a line break inside text becomes one space.

import { all } from '@aweftjs/core';

import { assert } from './assert.ts';
import { isSource } from './types.ts';

export type H = (tag: unknown, props: Record<string, unknown> | null, ...children: unknown[]) => unknown;

interface Frame {
	tag: unknown;
	props: Record<string, unknown>;
	children: unknown[];
}

const collapse = (text: string): string => {
	if (!text.includes('\n')) return text;
	const lines = text.split('\n');
	const kept: string[] = [];
	for (let i = 0; i < lines.length; i++) {
		let line = lines[i]!;
		if (i > 0) line = line.replace(/^[ \t\r]+/, '');
		if (i < lines.length - 1) line = line.replace(/[ \t\r]+$/, '');
		if (line !== '') kept.push(line);
	}
	return kept.join(' ');
};

/** A cursor over the template: string k at offset `at`, with a hole between each pair. */
interface Reader {
	readonly strings: readonly string[];
	readonly values: readonly unknown[];
	k: number;
	at: number;
}

const rest = (r: Reader): string => r.strings[r.k]!.slice(r.at);
const atHole = (r: Reader): boolean => r.at >= r.strings[r.k]!.length && r.k < r.values.length;
const atEnd = (r: Reader): boolean => r.at >= r.strings[r.k]!.length && r.k >= r.values.length;
const takeHole = (r: Reader): unknown => {
	const value = r.values[r.k];
	r.k += 1;
	r.at = 0;
	return value;
};
/** Skip whitespace inside the current string. Stops at a hole or the end of the segment. */
const skipSpace = (r: Reader): void => {
	const gap = rest(r).search(/\S/);
	r.at = gap < 0 ? r.strings[r.k]!.length : r.at + gap;
};

/**
 * One attribute value out of several parts.
 *
 * A quoted attribute in markup may mix text and expressions, and this is what the pieces become.
 * `build` emits a call to it for a compiled template, so markup that was parsed and markup that
 * was compiled make the same value out of the same pieces.
 *
 * Params:
 *   parts: the pieces in order, each a plain value or a scope, cell or derived value
 *
 * Returns: the pieces joined as text when all of them are plain, and otherwise a derived value
 * that joins them again whenever one of them changes.
 *
 * Example:
 *   setAttribute(el, 'class', joined(['note ', tone]));
 */
export const joined = (parts: unknown[]): unknown =>
	(parts.some(isSource) ? all(parts).map((values) => values.join('')) : parts.join(''));

/**
 * Bind the template parser to an `h`.
 *
 * Params:
 *   h: the element factory the markup calls
 *   options: `join`, how a quoted attribute of several parts becomes one value; by default
 *            plain parts concatenate and a part that is a scope or cell makes the whole
 *            value derived
 *
 * Returns: a tag function for template literals.
 *
 * Example:
 *   const html = htm(myH);
 *   html`<p class="note ${tone}">${text}</p>`
 */
export const htm = (h: H, options: { join?: (parts: unknown[]) => unknown } = {}) => {
	const join = options.join ?? joined;

	const readAttributes = (r: Reader, frame: Frame): boolean => {
		for (;;) {
			if (atHole(r)) {
				const spread = takeHole(r);
				assert(typeof spread === 'object' && spread !== null, 'a spread in a tag must be an object');
				Object.assign(frame.props, spread as Record<string, unknown>);
				continue;
			}
			skipSpace(r);
			if (atHole(r)) continue;
			assert(!atEnd(r), `unterminated <${String(frame.tag)}>`);

			const here = rest(r);
			if (here.startsWith('/>')) {
				r.at += 2;
				return true;
			}
			if (here[0] === '>') {
				r.at += 1;
				return false;
			}
			if (here[0] === '=') {
				r.at += 1;
				skipSpace(r);
				assert(atHole(r), 'a spread is written =${object}');
				const spread = takeHole(r);
				assert(typeof spread === 'object' && spread !== null, 'a spread in a tag must be an object');
				Object.assign(frame.props, spread as Record<string, unknown>);
				continue;
			}

			const nameMatch = /^[^\s"'>/=]+/.exec(here);
			assert(nameMatch !== null, `unexpected ${JSON.stringify(here[0])} in <${String(frame.tag)}>`);
			const name = nameMatch![0];
			r.at += name.length;

			skipSpace(r);
			if (atHole(r) || atEnd(r) || rest(r)[0] !== '=') {
				frame.props[name] = true;
				continue;
			}
			r.at += 1;
			skipSpace(r);

			if (atHole(r)) {
				frame.props[name] = takeHole(r);
				continue;
			}
			assert(!atEnd(r), `${name} needs a value`);

			const quote = rest(r)[0];
			if (quote === '"' || quote === "'") {
				r.at += 1;
				const parts: unknown[] = [];
				let piece = '';
				for (;;) {
					if (atHole(r)) {
						if (piece !== '') parts.push(piece);
						piece = '';
						parts.push(takeHole(r));
						continue;
					}
					assert(!atEnd(r), `unterminated attribute ${name}`);
					const close = rest(r).indexOf(quote);
					if (close < 0) {
						piece += rest(r);
						r.at = r.strings[r.k]!.length;
						continue;
					}
					piece += rest(r).slice(0, close);
					r.at += close + 1;
					break;
				}
				if (piece !== '' || parts.length === 0) parts.push(piece);
				frame.props[name] = parts.length === 1 ? parts[0] : join(parts);
				continue;
			}

			const bare = /^[^\s>]+/.exec(rest(r));
			assert(bare !== null, `${name} needs a value`);
			const value = bare![0];
			frame.props[name] = value;
			r.at += value.length;
		}
	};

	return (strings: TemplateStringsArray, ...values: unknown[]): unknown => {
		const r: Reader = { strings, values, k: 0, at: 0 };
		const root: Frame = { tag: null, props: {}, children: [] };
		const stack: Frame[] = [root];
		const top = (): Frame => stack[stack.length - 1]!;

		let text = '';
		const flushText = (): void => {
			const collapsed = collapse(text);
			if (collapsed !== '') top().children.push(collapsed);
			text = '';
		};
		const close = (frame: Frame): void => {
			top().children.push(h(frame.tag, frame.props, ...frame.children));
		};

		for (;;) {
			if (atHole(r)) {
				flushText();
				top().children.push(takeHole(r));
				continue;
			}
			if (atEnd(r)) break;

			const here = rest(r);
			const open = here.indexOf('<');
			if (open < 0) {
				text += here;
				r.at += here.length;
				continue;
			}
			text += here.slice(0, open);
			r.at += open;

			if (here.startsWith('<!--', open)) {
				flushText();
				const end = here.indexOf('-->', open);
				assert(end >= 0, 'a comment must end in the same template segment');
				r.at += end - open + 3;
				continue;
			}

			flushText();
			if (here.startsWith('</', open)) {
				r.at += 2;
				let name = '';
				for (;;) {
					if (atHole(r)) {
						takeHole(r);
						continue;
					}
					assert(!atEnd(r), 'unterminated closing tag');
					const end = rest(r).indexOf('>');
					if (end < 0) {
						name += rest(r);
						r.at = r.strings[r.k]!.length;
						continue;
					}
					name += rest(r).slice(0, end);
					r.at += end + 1;
					break;
				}
				name = name.trim();
				const frame = stack.pop();
				assert(frame !== undefined && frame !== root, 'a closing tag with nothing open');
				assert(name === '' || typeof frame!.tag !== 'string' || frame!.tag === name,
					`</${name}> closes <${String(frame!.tag)}>`);
				close(frame!);
				continue;
			}

			r.at += 1;
			let tag: unknown;
			if (atHole(r)) {
				tag = takeHole(r);
			} else {
				const nameMatch = /^[^\s/>]+/.exec(rest(r));
				assert(nameMatch !== null, 'a tag needs a name');
				tag = nameMatch![0];
				r.at += nameMatch![0].length;
			}
			const frame: Frame = { tag, props: {}, children: [] };
			if (readAttributes(r, frame)) close(frame);
			else stack.push(frame);
		}
		flushText();
		assert(stack.length === 1, `unclosed <${String(top().tag)}>`);

		const out = root.children;
		if (out.length === 0) return null;
		if (out.length === 1) return out[0];
		return out;
	};
};
