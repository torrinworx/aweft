// A markdown string as themed blocks, the inline syntax as modifiers (design 288), a figure and a
// nested list among the blocks (design 296).
//
// The blocks are `markdown-blocks.ts`; this file turns each one into elements and runs the text
// through `Typography`, under a `TextModifiers` list that is the application's own modifiers
// followed by the five markdown ones. What a modifier returns is rendered with no modifiers
// below it (design 181), so the three that hold text run the list again over their own text.

import { type Mounter, mount } from '@aweftjs/dom';
import { mutable } from '@aweftjs/core';

import { assert } from './assert.ts';
import { Checkbox } from './checkbox.tsx';
import { elementFor } from './control.ts';
import { h } from './h.ts';
import { isSafeHref, parseBlocks, toggled } from './markdown-blocks.ts';
import type { Align, Block, FigureBlock, ListBlock, ListItem } from './markdown-blocks.ts';
import { isSource, isWritable, through } from './source.ts';
import { TextModifiers, Typography, splitByModifiers } from './typography.tsx';
import type { TextModifier } from './typography.tsx';

/** What `Markdown` takes. Everything not named here goes to the element. */
export interface MarkdownProps {
	/** The markdown, a string or a cell holding one. A cell re-renders on change. */
	readonly source?: unknown;
	/** Modifiers run ahead of the markdown's own, so an application's patterns work inside it. Absent, the render's `TextModifiers` list. A cell is read when the component mounts. */
	readonly modifiers?: unknown;
	/** What a fenced block's body becomes. Absent, the text as it stands. */
	readonly code?: (text: string, language: string | null) => unknown;
	/** Decorate this node instead of building one. */
	readonly element?: unknown;
	/** Extra theme segments, appended to this component's own. */
	readonly theme?: unknown;
	readonly [prop: string]: unknown;
}

// The double form exists to hold a backtick, so one may sit inside it; the single form holds none.
const CODE_SPAN = /``(?:[^`\n]|`(?!`))+?``|`[^`\n]+`/g;
// A URL may hold one level of parentheses, as a wiki link does.
const LINK = /(?<!!)\[([^\]\n]+)\]\(((?:[^()\s]|\([^()\s]*\))+)(?:\s+"[^"]*")?\)/g;
const BOLD_ITALIC = /(?<!\\)\*\*\*(?!\s)[^*\n]+?(?<![\s\\])\*\*\*|(?<![\w\\])___(?!\s)[^_\n]+?(?<![\s\\])___(?!\w)/g;
const BOLD = /(?<!\\)\*\*(?!\s)[^\n]+?(?<![\s\\])\*\*|(?<![\w\\])__(?!\s)[^\n]+?(?<![\s\\])__(?!\w)/g;
const ITALIC = /(?<![\w*\\])\*(?!\s)[^*\n]+?(?<![\s\\])\*(?![\w*])|(?<![\w_\\])_(?!\s)[^_\n]+?(?<![\s\\])_(?![\w_])/g;

/**
 * The five markdown modifiers, over a list that already holds the application's own.
 *
 * Each one that holds text runs `list` again over it, which is the whole list including itself:
 * the outer match has consumed its own delimiters, so the inner text cannot match it again at
 * the same place.
 */
const withMarkdown = (own: readonly TextModifier[]): TextModifier[] => {
	const list: TextModifier[] = [...own];
	const inner = (text: string): unknown[] => splitByModifiers(text, list);
	list.push(
		{
			check: CODE_SPAN,
			return: (match) => {
				const twin = match.startsWith('``');
				const text = twin ? match.slice(2, -2) : match.slice(1, -1);
				return h('code', { theme: 'markdown_inline' }, twin ? text.replace(/^ (.*) $/, '$1') : text);
			},
		},
		{
			check: LINK,
			return: (match) => {
				const parts = /^\[([^\]\n]+)\]\(((?:[^()\s]|\([^()\s]*\))+)(?:\s+"[^"]*")?\)$/.exec(match)!;
				// Where it says, unless where it says is a scheme that runs something: then the
				// characters written, because a markdown string is not trusted to run script on a click.
				if (!isSafeHref(parts[2]!)) return match;
				return h('a', { theme: 'markdown_link', href: parts[2]! }, ...inner(parts[1]!));
			},
		},
		{
			check: BOLD_ITALIC,
			return: (match) => h('strong', { theme: 'markdown_bold' }, h('em', { theme: 'markdown_italic' }, ...inner(match.slice(3, -3)))),
		},
		{
			check: BOLD,
			return: (match) => h('strong', { theme: 'markdown_bold' }, ...inner(match.slice(2, -2))),
		},
		{
			check: ITALIC,
			return: (match) => h('em', { theme: 'markdown_italic' }, ...inner(match.slice(1, -1))),
		},
	);
	return list;
};

const alignSegment = (align: Align): string | null => (align === 'center' || align === 'right' ? align : null);

/** The words of an item with its marks dropped, for the box's name, and of a figure's alt text. */
const wordsOf = (text: string): string => text
	.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
	.replace(/[`*_]/g, '')
	.trim();

const defaultCode = (text: string): unknown => h('code', {}, text);

/**
 * A markdown string as themed blocks.
 *
 * Params:
 *   props: `source`, `modifiers`, `code`, `element`, `theme`, and anything else, which goes to
 *          the element
 *
 * Returns: a `<div>` on the `markdown` entry holding one element per block. A heading is a
 * `Typography` `h1` to `h6` on `markdown_heading` with an `id` in GitHub's scheme; a paragraph
 * is `p1` on `markdown_paragraph`; a fenced block is a `<pre>` on `markdown_code` with the
 * language on `data-language`, holding what `code` answers; a list is a `<ul>` or `<ol>` on
 * `markdown_list` of `<li>` on `markdown_item`, a task item with a `Checkbox` that follows the
 * source and writes it back when the source is a writable cell, an indented item a child list
 * inside the `<li>` with the `nested` segment, three levels deep; a table is a `<table>` on
 * `markdown_tabular` in the `table_scroll` box with the `table_*` parts; a blockquote is on
 * `markdown_quote`; a rule is an `<hr>` on `markdown_rule`; a paragraph that is one image line,
 * `![alt](src)` or `![alt](src =WxH)`, is a `<figure>` on `markdown_figure` holding an `<img>` on
 * `markdown_image`, or a `<video controls>` on `markdown_video` when the source ends in `.mp4`,
 * `.webm` or `.mov`, with `width` and `height` when written, and a `<figcaption>` holding `p2`
 * on `markdown_caption` when the alt text is not empty.
 *
 * Inline, a code span is `<code>` on `markdown_inline`, bold `<strong>` on `markdown_bold`,
 * italic `<em>` on `markdown_italic`, a link `<a>` on `markdown_link` with the `href` as
 * written, unless its scheme is not `http`, `https`, `mailto` or `tel`, in which case the link
 * is text. Each is a modifier in the render's `TextModifiers` shape, listed after `modifiers`,
 * so an application's own patterns run inside markdown. A fourth list level, an image inside a
 * sentence or whose source's scheme would run something, a footnote, an HTML tag, an autolink and
 * an escape are text, as written.
 *
 * Throws: the assert for a `source` that is neither a string, a number nor a cell holding one.
 *
 * Example:
 *   <Markdown source={readme} />
 *   <Markdown source={note} modifiers={[{ check: /@\w+/g, return: (who) => <Mention name={who} /> }]} />
 *   <Markdown source={doc} code={(text, language) => <Highlighted text={text} language={language} />} />
 */
export const Markdown = (props: MarkdownProps): Mounter => (elem, _item, before, context) => {
	const { source, modifiers, code, element, theme, ...rest } = props;
	const own = modifiers === undefined || modifiers === null
		? TextModifiers.read(context)
		: (isSource(modifiers) ? modifiers.get() : modifiers) as readonly TextModifier[];
	const list = withMarkdown(own);
	const renderCode = code ?? defaultCode;

	const listOf = (held: ListBlock, nested: boolean): unknown => h(held.ordered ? 'ol' : 'ul', {
		theme: ['markdown_list', held.ordered ? 'ordered' : null, nested ? 'nested' : null],
		start: held.ordered && held.start !== 1 ? held.start : undefined,
	}, ...held.items.map(item));

	const item = (held: ListItem): unknown => {
		const children = held.children.map((child) => listOf(child, true));
		if (held.task === null) {
			return h('li', { theme: 'markdown_item' }, h(Typography, { type: 'p1', label: held.text }), ...children);
		}
		const done = mutable(held.task === 'done');
		const writable = isWritable(source);
		return h('li', { theme: ['markdown_item', 'task'] },
			h(Checkbox, {
				value: done,
				disabled: !writable,
				'aria-label': wordsOf(held.text),
				onChange: (next: boolean) => {
					if (writable) source.set(toggled(String(source.get() ?? ''), held.line, next));
				},
			}),
			h(Typography, { type: 'p1', label: held.text }),
			...children);
	};

	const figure = (held: FigureBlock): unknown => {
		const size = { width: held.width ?? undefined, height: held.height ?? undefined };
		const media = held.media === 'video'
			? h('video', { theme: 'markdown_video', controls: true, src: held.src, ...size })
			: h('img', { theme: 'markdown_image', src: held.src, alt: wordsOf(held.alt), ...size });
		return h('figure', { theme: 'markdown_figure' },
			media,
			held.alt === '' ? null : h('figcaption', {}, h(Typography, { type: 'p2', theme: 'markdown_caption', label: held.alt })));
	};

	const block = (held: Block): unknown => {
		switch (held.kind) {
			case 'heading':
				return h(Typography, { type: `h${String(held.level)}`, theme: 'markdown_heading', id: held.id, label: held.text });
			case 'paragraph':
				return h(Typography, { type: 'p1', theme: 'markdown_paragraph', label: held.text });
			case 'code':
				// Focusable, because a block that scrolls sideways and cannot be focused is unreachable
				// from a keyboard, as the table's scroll box is.
				return h('pre', { theme: 'markdown_code', tabindex: '0', 'data-language': held.language ?? undefined }, renderCode(held.text, held.language));
			case 'list':
				return listOf(held, false);
			case 'figure':
				return figure(held);
			case 'table':
				return h('div', { theme: 'table_scroll', tabindex: '0' },
					h('table', { theme: ['table', 'markdown_tabular'] },
						h('thead', { theme: 'table_head' },
							h('tr', {}, ...held.header.map((cell, at) =>
								h('th', { theme: ['table_heading', alignSegment(held.align[at] ?? null)], scope: 'col' },
									h(Typography, { type: 'sm_inline', label: cell }))))),
						h('tbody', {}, ...held.rows.map((row) =>
							h('tr', { theme: 'table_line' }, ...row.map((cell, at) =>
								h('td', { theme: ['table_cell', alignSegment(held.align[at] ?? null)] },
									h(Typography, { type: 'sm_inline', label: cell }))))))));
			case 'quote':
				return h('blockquote', { theme: 'markdown_quote' }, h(Typography, { type: 'p1', label: held.text }));
			case 'rule':
				return h('hr', { theme: 'markdown_rule' });
		}
	};

	const node = h(
		element === null || element === undefined ? 'div' : elementFor(element),
		{ ...rest, theme: ['markdown', theme] },
		through(source, (text) => {
			assert(text === null || text === undefined || typeof text === 'string' || typeof text === 'number',
				`Markdown source must be a string, or a cell holding one, and this one is ${typeof text}; hand it the markdown text`);
			return h(TextModifiers, { value: list }, ...parseBlocks(String(text ?? '')).map(block));
		}),
	);
	return mount(elem, node, before, context);
};
