// `Markdown`, in the light tree (design 288): every block and inline form the corpus uses, the
// corpus itself against a second implementation, a cell source followed, a task toggle written
// back, the code hook, an application's modifier inside markdown, what stays text, and a page
// rendered on a server taken over in place; and the figure, the nested list and the exported
// slugger a post needs (design 296).
//
// The expected block stream comes from `marked`, a second implementation this package never
// ships: the corpus test reads its lexer and compares kind, depth and text, so no expected value
// here was copied from the parser under test.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { marked } from 'marked';
import type { Token, Tokens } from 'marked';

import { mutable } from '@aweftjs/core';
import { createDocument, parseHtml, toHtml } from '@aweftjs/dom';
import type { ElementLike, LightElement, NodeLike } from '@aweftjs/dom';
import { Markdown, TextModifiers, context, h, hydrate, mount, render, slugger } from '@aweftjs/ui';
import type { Render } from '@aweftjs/ui';

// The parser is not on the surface; the corpus test reads it through the file, as an
// `internal.*` file would, because the blocks are what the oracle can be compared with.
import { parseBlocks, toggled } from '../src/markdown-blocks.ts';
import type { Block } from '../src/markdown-blocks.ts';

const root = fileURLToPath(new URL('../../..', import.meta.url));

const elements = (node: NodeLike | null): LightElement[] => {
	const found: LightElement[] = [];
	for (let n = node; n !== null; n = n.nextSibling) {
		if (n.nodeType === 1) found.push(n as unknown as LightElement);
		found.push(...elements(n.firstChild));
	}
	return found;
};

/** Mount into a fresh light document on a render of its own. */
const page = (item: unknown): { body: ElementLike; ui: Render; root: LightElement; stop(): void } => {
	const ui = context();
	const document = createDocument();
	const stop = mount(document.body, item, undefined, ui);
	return { body: document.body, ui, root: document.body.firstChild as unknown as LightElement, stop: () => { stop(); } };
};

const tags = (root: NodeLike | null): string[] => elements(root).map((element) => element.localName);

const fire = (element: LightElement, type: string): void => {
	(element as unknown as { dispatchEvent(event: unknown): boolean }).dispatchEvent({ type, target: element });
};
const setProp = (element: LightElement, name: string, value: unknown): void => {
	(element as unknown as Record<string, unknown>)[name] = value;
};

// --- the corpus, against the second implementation -----------------------------------------------

/** What both sides are reduced to: the kind, the depth or language, and the text with its whitespace folded. */
interface Plain {
	readonly kind: string;
	readonly depth?: number;
	readonly language?: string | null;
	readonly ordered?: boolean;
	readonly start?: number;
	readonly items?: readonly PlainItem[];
	readonly header?: readonly string[];
	readonly rows?: readonly (readonly string[])[];
	readonly text?: string;
	readonly src?: string;
	readonly alt?: string;
}
interface PlainItem { readonly text: string; readonly task: string | null; readonly children: readonly Plain[] }

const fold = (text: string): string => text.replace(/\s+/g, ' ').trim();

const ours = (block: Block): Plain => {
	switch (block.kind) {
		case 'heading': return { kind: 'heading', depth: block.level, text: fold(block.text) };
		case 'paragraph': return { kind: 'paragraph', text: fold(block.text) };
		case 'code': return { kind: 'code', language: block.language, text: block.text };
		case 'list': return {
			kind: 'list', ordered: block.ordered, start: block.ordered ? block.start : 0,
			items: block.items.map((item) => ({ text: fold(item.text), task: item.task, children: item.children.map(ours) })),
		};
		case 'table': return { kind: 'table', header: block.header.map(fold), rows: block.rows.map((row) => row.map(fold)) };
		case 'quote': return { kind: 'quote', text: fold(block.text) };
		case 'rule': return { kind: 'rule' };
		// The size is not compared: the second implementation reads the suffix as text.
		case 'figure': return { kind: 'figure', src: block.src, alt: fold(block.alt) };
	}
};

/** Whether a link's target is one the design lets the page follow (design 288), for the oracle's images. */
const safe = (href: string): boolean => {
	const scheme = /^\s*([a-z][a-z0-9+.-]*):/i.exec(href)?.[1]?.toLowerCase();
	return scheme === undefined || ['http', 'https', 'mailto', 'tel'].includes(scheme);
};

/**
 * The second implementation's list token as the same shape. An item's text is what its own text
 * tokens say, so a nested list is read as `children` and not as part of the text above it.
 */
const theirList = (list: Tokens.List): Plain => ({
	kind: 'list', ordered: list.ordered, start: list.ordered ? Number(list.start) : 0,
	items: list.items.map((item) => ({
		text: fold(item.tokens.filter((held) => held.type === 'text' || held.type === 'paragraph').map((held) => (held as Tokens.Text).text).join(' ')),
		task: item.task ? (item.checked ? 'done' : 'open') : null,
		children: item.tokens.filter((held): held is Tokens.List => held.type === 'list').map(theirList),
	})),
});

/**
 * `marked`'s token as the same shape. Two of its kinds are folded on purpose and the design says
 * why: a raw HTML block is a paragraph here, because HTML is text; and the text of a list item is
 * what the item's own tokens say, since a loose item wraps its text in a paragraph.
 */
const theirs = (token: Token): Plain | null => {
	switch (token.type) {
		case 'space': return null;
		case 'heading': return { kind: 'heading', depth: (token as Tokens.Heading).depth, text: fold((token as Tokens.Heading).text) };
		case 'paragraph': {
			// A paragraph that is one image, and nothing but whitespace beside it, is a figure
			// (design 296), unless the design keeps its source as text.
			const inline = ((token as Tokens.Paragraph).tokens ?? []).filter((held) => !(held.type === 'text' && (held as Tokens.Text).text.trim() === ''));
			const image = inline.length === 1 && inline[0]!.type === 'image' ? inline[0] as Tokens.Image : null;
			if (image !== null && safe(image.href)) return { kind: 'figure', src: image.href, alt: fold(image.text) };
			return { kind: 'paragraph', text: fold((token as Tokens.Paragraph).text) };
		}
		case 'html': return { kind: 'paragraph', text: fold((token as Tokens.HTML).text) };
		case 'code': {
			const code = token as Tokens.Code;
			return { kind: 'code', language: code.lang === undefined || code.lang === '' ? null : code.lang, text: code.text };
		}
		case 'list': return theirList(token as Tokens.List);
		case 'table': {
			const table = token as Tokens.Table;
			return { kind: 'table', header: table.header.map((cell) => fold(cell.text)), rows: table.rows.map((row) => row.map((cell) => fold(cell.text))) };
		}
		case 'blockquote': return { kind: 'quote', text: fold((token as Tokens.Blockquote).text) };
		case 'hr': return { kind: 'rule' };
		default: return { kind: token.type, text: fold('text' in token ? String(token.text) : '') };
	}
};

const corpus = (): string[] => {
	const packages = readdirSync(join(root, 'packages')).map((name) => join(root, 'packages', name, 'README.md'));
	const recipes = readdirSync(join(root, 'recipes')).map((name) => join(root, 'recipes', name, 'README.md'));
	const spec = readdirSync(join(root, 'spec')).filter((name) => name.endsWith('.md')).map((name) => join(root, 'spec', name));
	return [...packages, ...recipes, join(root, 'README.md'), join(root, 'docs', 'security.md'), ...spec]
		.filter((path) => { try { readFileSync(path); return true; } catch { return false; } });
};

test('every README, the security page and the spec parse to the blocks the second implementation reads', () => {
	const files = corpus();
	assert.ok(files.length >= 30, `the corpus is ${String(files.length)} files`);
	const counts = { heading: 0, code: 0, list: 0, table: 0, quote: 0, rule: 0, html: 0 };
	for (const path of files) {
		const text = readFileSync(path, 'utf8');
		const expected = marked.lexer(text).map(theirs).filter((plain): plain is Plain => plain !== null);
		const actual = parseBlocks(text).map(ours);
		assert.deepEqual(actual, expected, path.slice(root.length));
		for (const token of marked.lexer(text)) {
			if (token.type in counts) counts[token.type as keyof typeof counts] += 1;
		}
	}
	// The corpus is what design 288 measured, so the comparison above ran over every construct
	// it uses; the quote and the rule it does not, and the case list below covers those.
	assert.ok(counts.heading >= 300 && counts.code >= 200 && counts.table >= 40 && counts.list >= 30, JSON.stringify(counts));
});

/**
 * The inline forms of one block as a list of kinds: `text`, `code`, `strong`, `em`, `link`,
 * with neighbouring text folded into one, which is the shape both sides reduce to.
 */
const fold_kinds = (kinds: readonly string[]): string[] => kinds.reduce<string[]>((out, kind) => {
	if (kind === 'text' && out[out.length - 1] === 'text') return out;
	out.push(kind);
	return out;
}, []);

const INLINE = new Set(['code', 'strong', 'em', 'a']);

/** A rendered block's inline kinds, from its child nodes; anything but the four forms is text. */
const rendered_kinds = (element: LightElement): string[] => {
	const kinds: string[] = [];
	for (let n = (element as unknown as NodeLike).firstChild; n !== null; n = n.nextSibling) {
		if (n.nodeType === 8) continue;
		const tag = n.nodeType === 1 ? (n as unknown as LightElement).localName : 'text';
		kinds.push(tag === 'a' ? 'link' : INLINE.has(tag) ? tag : 'text');
	}
	return fold_kinds(kinds);
};

/**
 * The second implementation's inline kinds. Where the design says text, its token is read as
 * text: an image, raw HTML, an escape, a line break, a strikethrough, and a link it found on its
 * own (an autolink or a bare URL, whose raw text does not start with `[`).
 */
const oracle_kinds = (tokens: readonly Token[] | undefined): string[] => fold_kinds((tokens ?? []).map((token) => {
	switch (token.type) {
		case 'codespan': return 'code';
		case 'strong': return 'strong';
		case 'em': return 'em';
		case 'link': return (token as Tokens.Link).raw.startsWith('[') ? 'link' : 'text';
		default: return 'text';
	}
}));

test('every paragraph, heading and item of the corpus renders the inline forms the second implementation reads', () => {
	const problems: string[] = [];
	let compared = 0;
	for (const path of corpus()) {
		const text = readFileSync(path, 'utf8');
		const expected: { kind: string; kinds: string[]; raw: string }[] = [];
		for (const token of marked.lexer(text)) {
			if (token.type === 'heading' || token.type === 'paragraph') expected.push({ kind: token.type, kinds: oracle_kinds((token as Tokens.Paragraph).tokens), raw: token.raw });
			if (token.type === 'list') {
				for (const item of (token as Tokens.List).items) {
					const inner = item.tokens.flatMap((held) => (held.type === 'text' || held.type === 'paragraph' ? ((held as Tokens.Text).tokens ?? []) : []));
					expected.push({ kind: 'item', kinds: oracle_kinds(inner), raw: item.raw });
				}
			}
		}
		const own = page(h(Markdown, { source: text }));
		const actual = elements(own.root.firstChild)
			.filter((element) => /^(h[1-6]|p)$/.test(element.localName) && !['td', 'th', 'blockquote'].includes(((element as unknown as NodeLike).parentNode as unknown as LightElement).localName))
			.map((element) => ({ kind: element.localName === 'p' ? (((element as unknown as NodeLike).parentNode as unknown as LightElement).localName === 'li' ? 'item' : 'paragraph') : 'heading', kinds: rendered_kinds(element) }));
		own.stop();
		assert.equal(actual.length, expected.length, `${path.slice(root.length)}: ${String(actual.length)} blocks rendered, ${String(expected.length)} expected`);
		for (let at = 0; at < expected.length; at += 1) {
			compared += 1;
			if (actual[at]!.kinds.join(' ') !== expected[at]!.kinds.join(' ')) {
				problems.push(`${path.slice(root.length)}: ${JSON.stringify(expected[at]!.raw.slice(0, 80))}\n    rendered ${actual[at]!.kinds.join(' ')}\n    expected ${expected[at]!.kinds.join(' ')}`);
			}
		}
	}
	assert.ok(compared > 1500, `${String(compared)} blocks compared`);
	assert.deepEqual(problems, [], `${String(problems.length)} of ${String(compared)} differ:\n${problems.slice(0, 12).join('\n')}`);
});

test('the constructs the corpus does not use are read the way the second implementation reads them, or as text where the design says so', () => {
	const cases: readonly [string, Plain[]][] = [
		['1. one\n2. two\n\n3) three', [
			{ kind: 'list', ordered: true, start: 1, items: [{ text: 'one', task: null, children: [] }, { text: 'two', task: null, children: [] }] },
			{ kind: 'list', ordered: true, start: 3, items: [{ text: 'three', task: null, children: [] }] },
		]],
		['- [ ] open\n- [x] done', [{ kind: 'list', ordered: false, start: 0, items: [{ text: 'open', task: 'open', children: [] }, { text: 'done', task: 'done', children: [] }] }]],
		['| a | b |\n|:--|--:|\n| 1 \\| 2 | 3 |\n| short |', [{ kind: 'table', header: ['a', 'b'], rows: [['1 | 2', '3'], ['short', '']] }]],
		['> one\n> two', [{ kind: 'quote', text: 'one two' }]],
		['a  \nb\nc', [{ kind: 'paragraph', text: 'a b c' }]],
		['# Title ##\n\n####### not a heading', [{ kind: 'heading', depth: 1, text: 'Title' }, { kind: 'paragraph', text: '####### not a heading' }]],
		['~~~ts\ncode\n~~~\n\n````\n```\n````', [{ kind: 'code', language: 'ts', text: 'code' }, { kind: 'code', language: null, text: '```' }]],
		['***\n\n- - -', [{ kind: 'rule' }, { kind: 'rule' }]],
		['<div>html block</div>', [{ kind: 'paragraph', text: '<div>html block</div>' }]],
		['- a\n- b\ncontinued', [{ kind: 'list', ordered: false, start: 0, items: [{ text: 'a', task: null, children: [] }, { text: 'b continued', task: null, children: [] }] }]],
		['> a quote\n# head', [{ kind: 'quote', text: 'a quote' }, { kind: 'heading', depth: 1, text: 'head' }]],
		['> a quote\n- item', [{ kind: 'quote', text: 'a quote' }, { kind: 'list', ordered: false, start: 0, items: [{ text: 'item', task: null, children: [] }] }]],
		['> a quote\n```\nx\n```', [{ kind: 'quote', text: 'a quote' }, { kind: 'code', language: null, text: 'x' }]],
		['> a quote\ncarried on', [{ kind: 'quote', text: 'a quote carried on' }]],
		// A heading, a list, a quote and a table each end the paragraph above them.
		['text\n# head', [{ kind: 'paragraph', text: 'text' }, { kind: 'heading', depth: 1, text: 'head' }]],
		['text\n- item', [{ kind: 'paragraph', text: 'text' }, { kind: 'list', ordered: false, start: 0, items: [{ text: 'item', task: null, children: [] }] }]],
		['text\n> quote', [{ kind: 'paragraph', text: 'text' }, { kind: 'quote', text: 'quote' }]],
		['text\n| a |\n|---|\n| 1 |', [{ kind: 'paragraph', text: 'text' }, { kind: 'table', header: ['a'], rows: [['1']] }]],
		// A row with no outer pipes keeps its last cell; a fence never closed runs to the end.
		['a | b\n--|--\n1 | 2', [{ kind: 'table', header: ['a', 'b'], rows: [['1', '2']] }]],
		['```\nx', [{ kind: 'code', language: null, text: 'x' }]],
		// A figure (design 296): one image line standing alone; its title read and dropped.
		['![A caption](a.png)', [{ kind: 'figure', src: 'a.png', alt: 'A caption' }]],
		['![](/media/a.png "a title")', [{ kind: 'figure', src: '/media/a.png', alt: '' }]],
		['![a](https://example.com/a_(b).png)', [{ kind: 'figure', src: 'https://example.com/a_(b).png', alt: 'a' }]],
		['![a [link](/x) in it](a.png)', [{ kind: 'figure', src: 'a.png', alt: 'a [link](/x) in it' }]],
		// And what is not one: a source that runs something, an image beside words, two image lines.
		['![run](javascript:alert(1))', [{ kind: 'paragraph', text: '![run](javascript:alert(1))' }]],
		['![data](data:image/png;base64,AA==)', [{ kind: 'paragraph', text: '![data](data:image/png;base64,AA==)' }]],
		['See ![alt](a.png) here', [{ kind: 'paragraph', text: 'See ![alt](a.png) here' }]],
		['![a](x.png)\n![b](y.png)', [{ kind: 'paragraph', text: '![a](x.png) ![b](y.png)' }]],
		// A nested list (design 296): an item at the content column of the one above nests under it.
		['- a\n  - b\n- c', [{ kind: 'list', ordered: false, start: 0, items: [
			{ text: 'a', task: null, children: [{ kind: 'list', ordered: false, start: 0, items: [{ text: 'b', task: null, children: [] }] }] },
			{ text: 'c', task: null, children: [] },
		] }]],
		['- a\n - b', [{ kind: 'list', ordered: false, start: 0, items: [{ text: 'a', task: null, children: [] }, { text: 'b', task: null, children: [] }] }]],
		['1. a\n   - b', [{ kind: 'list', ordered: true, start: 1, items: [
			{ text: 'a', task: null, children: [{ kind: 'list', ordered: false, start: 0, items: [{ text: 'b', task: null, children: [] }] }] },
		] }]],
		['1. a\n  - b', [
			{ kind: 'list', ordered: true, start: 1, items: [{ text: 'a', task: null, children: [] }] },
			{ kind: 'list', ordered: false, start: 0, items: [{ text: 'b', task: null, children: [] }] },
		]],
		['- a\n    - b\n  - c', [{ kind: 'list', ordered: false, start: 0, items: [
			{ text: 'a', task: null, children: [{ kind: 'list', ordered: false, start: 0, items: [{ text: 'b', task: null, children: [] }, { text: 'c', task: null, children: [] }] }] },
		] }]],
		['- a\n  1. b\n  2. c\n  - d', [{ kind: 'list', ordered: false, start: 0, items: [
			{ text: 'a', task: null, children: [
				{ kind: 'list', ordered: true, start: 1, items: [{ text: 'b', task: null, children: [] }, { text: 'c', task: null, children: [] }] },
				{ kind: 'list', ordered: false, start: 0, items: [{ text: 'd', task: null, children: [] }] },
			] },
		] }]],
		['- a\n\t- b', [{ kind: 'list', ordered: false, start: 0, items: [
			{ text: 'a', task: null, children: [{ kind: 'list', ordered: false, start: 0, items: [{ text: 'b', task: null, children: [] }] }] },
		] }]],
		['- [ ] a\n  - [x] b\n  carried', [{ kind: 'list', ordered: false, start: 0, items: [
			{ text: 'a', task: 'open', children: [{ kind: 'list', ordered: false, start: 0, items: [{ text: 'b carried', task: 'done', children: [] }] }] },
		] }]],
		['- a\n  - b\n    - c', [{ kind: 'list', ordered: false, start: 0, items: [
			{ text: 'a', task: null, children: [{ kind: 'list', ordered: false, start: 0, items: [
				{ text: 'b', task: null, children: [{ kind: 'list', ordered: false, start: 0, items: [{ text: 'c', task: null, children: [] }] }] },
			] }] },
		] }]],
	];
	for (const [source, expected] of cases) {
		assert.deepEqual(parseBlocks(source).map(ours), expected, source);
		assert.deepEqual(marked.lexer(source).map(theirs).filter((plain) => plain !== null), expected, `the second implementation agrees on ${source}`);
	}
	// The two places the two disagree by design: a size suffix, which the second implementation
	// reads as text, and a fourth level, which joins the item above it as written.
	const sized = parseBlocks('![alt](a.png =640x480)');
	assert.deepEqual(sized, [{ kind: 'figure', media: 'image', src: 'a.png', alt: 'alt', width: 640, height: 480 }]);
	assert.deepEqual(parseBlocks('![alt](a.mp4 "t" =640x480)')[0], { kind: 'figure', media: 'video', src: 'a.mp4', alt: 'alt', width: 640, height: 480 });
	const deep = parseBlocks('- a\n  - b\n    - c\n      - d\n    - e');
	const third = (deep[0] as Block & { kind: 'list' }).items[0]!.children[0]!.items[0]!.children[0]!;
	assert.deepEqual(third.items.map((item) => item.text), ['c\n      - d', 'e'], 'the fourth level is the characters written, on their own line');
	// And an item indented four spaces, which the second implementation reads as indented code.
	assert.deepEqual(parseBlocks('    - a').map(ours), [{ kind: 'paragraph', text: '- a' }]);
});

test('two trailing spaces are a line break, and a bare newline is a space', () => {
	assert.deepEqual(parseBlocks('a  \nb\nc').map((block) => (block.kind === 'paragraph' ? block.text : null)), ['a\nb c']);
});

test('a heading gets the id GitHub gives it, and a repeat is numbered', () => {
	const blocks = parseBlocks('# `@aweftjs/ssg`\n\n## The theme\n\n## The theme\n\n### `h`, `svg` and `html`');
	assert.deepEqual(blocks.map((block) => (block.kind === 'heading' ? block.id : null)), ['aweftjsssg', 'the-theme', 'the-theme-1', 'h-svg-and-html']);
});

test('slugger is exported, gives a repeat its next suffix, and gives the ids the headings carry', () => {
	const id = slugger();
	assert.deepEqual(['The theme', 'The theme', 'The theme', 'the-theme'].map(id), ['the-theme', 'the-theme-1', 'the-theme-2', 'the-theme-3'],
		'a repeat counts from one, and a text that spells an earlier id is a repeat of it');
	assert.equal(slugger()('The theme'), 'the-theme', 'each call starts a fresh count');
	assert.equal(id('**Bold** and `code` and [a link](/x)'), 'bold-and-code-and-a-link', 'the marks are dropped');

	const own = slugger();
	const headings = ['Intro', 'Setup', 'Setup', 'Setup: again'];
	const page = h(Markdown, { source: headings.map((text) => `## ${text}`).join('\n\n') });
	const document = createDocument();
	const stop = mount(document.body, page, undefined, context());
	assert.deepEqual(elements(document.body.firstChild).filter((element) => element.localName === 'h2').map((element) => element.getAttribute('id')), headings.map(own),
		'a table of contents built from the same headings in the same order has the ids the page has');
	stop();
});

// --- what the blocks render as -------------------------------------------------------------------

const SAMPLE = [
	'# Title',
	'',
	'A paragraph with `code`, **bold**, *italic*, ***both***, a [link](/docs "the docs") and **bold with `code` in it**.',
	'',
	'```ts',
	'const x = 1;',
	'```',
	'',
	'- one',
	'- two',
	'',
	'3. three',
	'4. four',
	'',
	'| a | b |',
	'|---|--:|',
	'| `1` | 2 |',
	'',
	'> a quote',
	'',
	'---',
].join('\n');

test('every block is the element the design names, on its entry', () => {
	const own = page(h(Markdown, { source: SAMPLE }));
	const classes = (segments: string[]): string => own.ui.theme.classes(own.ui.theme.base(), segments);
	assert.equal(own.root.localName, 'div');
	assert.equal(own.root.getAttribute('class'), classes(['markdown']));

	const [heading, paragraph, pre, list, ordered, scroll, quote, rule] = elements(own.root.firstChild).filter((element) =>
		(element as unknown as { parentNode: unknown }).parentNode === (own.root as unknown));
	assert.equal(heading!.localName, 'h1');
	assert.equal(heading!.getAttribute('id'), 'title');
	assert.equal(heading!.getAttribute('class'), classes(['text', 'h1', 'markdown_heading']));
	assert.equal(paragraph!.localName, 'p');
	assert.equal(paragraph!.getAttribute('class'), classes(['text', 'p1', 'markdown_paragraph']));
	assert.equal(pre!.localName, 'pre');
	assert.equal(pre!.getAttribute('data-language'), 'ts');
	assert.equal(pre!.getAttribute('class'), classes(['markdown_code']));
	assert.equal(pre!.getAttribute('tabindex'), '0', 'a block that scrolls is reachable from the keyboard');
	assert.equal(toHtml(pre!), `<pre tabindex="0" data-language="ts" class="${pre!.getAttribute('class')!}"><code>const x = 1;</code></pre>`);
	assert.equal(list!.localName, 'ul');
	assert.equal(list!.getAttribute('class'), classes(['markdown_list']));
	assert.deepEqual(tags((list as unknown as NodeLike).firstChild), ['li', 'p', 'li', 'p']);
	assert.equal(ordered!.localName, 'ol');
	assert.equal(ordered!.getAttribute('start'), '3');
	assert.equal(ordered!.getAttribute('class'), classes(['markdown_list', 'ordered']));
	assert.equal(scroll!.getAttribute('class'), classes(['table_scroll']));
	assert.equal(scroll!.getAttribute('tabindex'), '0');
	assert.deepEqual(tags((scroll as unknown as NodeLike).firstChild), ['table', 'thead', 'tr', 'th', 'span', 'th', 'span', 'tbody', 'tr', 'td', 'span', 'code', 'td', 'span']);
	const cells = elements((scroll as unknown as NodeLike).firstChild).filter((element) => element.localName === 'th' || element.localName === 'td');
	assert.equal(cells[1]!.getAttribute('class'), classes(['table_heading', 'right']), 'the delimiter row aligns the column');
	assert.equal(cells[3]!.getAttribute('class'), classes(['table_cell', 'right']));
	assert.equal(quote!.localName, 'blockquote');
	assert.equal(quote!.getAttribute('class'), classes(['markdown_quote']));
	assert.equal(rule!.localName, 'hr');
	assert.equal(rule!.getAttribute('class'), classes(['markdown_rule']));
	own.stop();
});

test('a numbered list from 1 carries no start, and a delimiter row aligns a column left, centre or right', () => {
	const own = page(h(Markdown, { source: '1. a\n2. b\n\n| l | c | r | n |\n|:--|:-:|--:|---|\n| 1 | 2 | 3 | 4 |' }));
	const classes = (segments: string[]): string => own.ui.theme.classes(own.ui.theme.base(), segments);
	const list = elements(own.root.firstChild).find((element) => element.localName === 'ol')!;
	assert.equal(list.getAttribute('start'), null, 'the browser counts from 1 on its own');
	const cells = elements(own.root.firstChild).filter((element) => element.localName === 'td');
	assert.deepEqual(cells.map((cell) => cell.getAttribute('class')), [
		classes(['table_cell']), classes(['table_cell', 'center']), classes(['table_cell', 'right']), classes(['table_cell']),
	], 'left is the default and gets no segment');
	own.stop();
});

test('with no source at all the block holds nothing', () => {
	const own = page(h(Markdown, {}));
	assert.deepEqual(tags(own.root.firstChild), []);
	assert.equal(own.root.textContent, '');
	own.stop();
});

test('the inline forms are the elements the design names, and a bold run renders the code span inside it', () => {
	const own = page(h(Markdown, { source: SAMPLE }));
	const paragraph = elements(own.root.firstChild).find((element) => element.localName === 'p')!;
	assert.equal(toHtml(paragraph).replace(/ class="aw\d+"/g, ''), [
		'<p>A paragraph with <code>code</code>, <strong>bold</strong>, <em>italic</em>, <strong><em>both</em></strong>, ',
		'a <a href="/docs">link</a> and <strong>bold with <code>code</code> in it</strong>.</p>',
	].join(''));
	const classes = (segments: string[]): string => own.ui.theme.classes(own.ui.theme.base(), segments);
	const inline = elements((paragraph as unknown as NodeLike).firstChild);
	assert.equal(inline.find((element) => element.localName === 'code')!.getAttribute('class'), classes(['markdown_inline']));
	assert.equal(inline.find((element) => element.localName === 'strong')!.getAttribute('class'), classes(['markdown_bold']));
	assert.equal(inline.find((element) => element.localName === 'em')!.getAttribute('class'), classes(['markdown_italic']));
	assert.equal(inline.find((element) => element.localName === 'a')!.getAttribute('class'), classes(['markdown_link']));
	own.stop();
});

test('a two-backtick span holds a backtick, a link holds a parenthesis, and a link that would run something is text', () => {
	const own = page(h(Markdown, { source: 'A `` html`...` `` tag, [a (b)](https://example.com/A_(b)) and [run](javascript:alert(1)) and [data](data:text/html,x) and [mail](mailto:a@b.c).' }));
	const paragraph = elements(own.root.firstChild).find((element) => element.localName === 'p')!;
	assert.equal(toHtml(paragraph).replace(/ class="aw\d+"/g, ''), [
		'<p>A <code>html`...`</code> tag, <a href="https://example.com/A_(b)">a (b)</a> and [run](javascript:alert(1)) and [data](data:text/html,x) ',
		'and <a href="mailto:a@b.c">mail</a>.</p>',
	].join(''));
	own.stop();
});

test('a source that is not text is refused, and the message says what it was', () => {
	assert.throws(() => { const own = page(h(Markdown, { source: { a: 1 } })); own.stop(); }, /Markdown source must be a string.*and this one is object/);
	const numbered = page(h(Markdown, { source: 42 }));
	assert.equal(numbered.root.textContent, '42');
	numbered.stop();
});

test('what the design leaves as text is text: an image inside a sentence, a footnote, an HTML tag, an autolink, an escape, an underscore in a word', () => {
	const source = 'See ![alt](a.png) and [^1] and <b>tag</b> and <https://example.com> and \\*not italic\\* and snake_case_name.';
	const own = page(h(Markdown, { source }));
	const paragraph = elements(own.root.firstChild).find((element) => element.localName === 'p')!;
	assert.deepEqual(tags((paragraph as unknown as NodeLike).firstChild), [], 'no element was made for any of them');
	assert.equal(paragraph.textContent, source);
	own.stop();
});

test('a figure is the elements the design names, with and without a caption and a size, and a video by its extension', () => {
	const own = page(h(Markdown, { source: [
		'![A **bold** caption with a [link](/x)](/media/a.png)',
		'',
		'![](/media/b.png =640x480)',
		'',
		'![A clip](/media/c.webm?v=2 =320x240)',
		'',
		'![A clip](/media/D.MP4)',
	].join('\n') }));
	const classes = (segments: string[]): string => own.ui.theme.classes(own.ui.theme.base(), segments);
	const figures = elements(own.root.firstChild).filter((element) => element.localName === 'figure');
	assert.equal(figures.length, 4);
	assert.deepEqual(figures.map((figure) => figure.getAttribute('class')), Array.from({ length: 4 }, () => classes(['markdown_figure'])));

	assert.deepEqual(tags((figures[0] as unknown as NodeLike).firstChild), ['img', 'figcaption', 'p', 'strong', 'a']);
	const [image, caption, text] = elements((figures[0] as unknown as NodeLike).firstChild);
	assert.equal(image!.getAttribute('src'), '/media/a.png');
	assert.equal(image!.getAttribute('alt'), 'A bold caption with a link', 'the alt is the words, marks dropped');
	assert.equal(image!.getAttribute('class'), classes(['markdown_image']));
	assert.equal(image!.getAttribute('width'), null);
	assert.equal(image!.getAttribute('height'), null);
	assert.equal(caption!.getAttribute('class'), null, 'the entry is on the caption\'s text, where a colour reaches it');
	assert.equal(text!.getAttribute('class'), classes(['text', 'p2', 'markdown_caption']));
	assert.equal(toHtml(text!).replace(/ class="aw\d+"/g, ''), '<p>A <strong>bold</strong> caption with a <a href="/x">link</a></p>', 'the modifiers run over a caption');

	assert.deepEqual(tags((figures[1] as unknown as NodeLike).firstChild), ['img'], 'an empty alt is no caption');
	const sized = elements((figures[1] as unknown as NodeLike).firstChild)[0]!;
	assert.equal(sized.getAttribute('alt'), '', 'and the alt attribute is still there');
	assert.equal(sized.getAttribute('width'), '640');
	assert.equal(sized.getAttribute('height'), '480');

	assert.deepEqual(tags((figures[2] as unknown as NodeLike).firstChild), ['video', 'figcaption', 'p']);
	const video = elements((figures[2] as unknown as NodeLike).firstChild)[0]!;
	assert.equal(video.getAttribute('class'), classes(['markdown_video']));
	assert.equal(video.getAttribute('controls'), '', 'a video has its controls');
	assert.equal(video.getAttribute('src'), '/media/c.webm?v=2', 'the query is not part of the extension');
	assert.equal(video.getAttribute('width'), '320');
	assert.equal(video.getAttribute('alt'), null);
	assert.equal(elements((figures[3] as unknown as NodeLike).firstChild)[0]!.localName, 'video', 'whatever the case of the extension');
	own.stop();
});

test('an image whose source would run something, or that shares its paragraph, is text', () => {
	const own = page(h(Markdown, { source: '![run](javascript:alert(1))\n\n![a](x.png)\ntext after' }));
	assert.deepEqual(tags(own.root.firstChild), ['p', 'p'], 'no figure, no image');
	const [first, second] = elements(own.root.firstChild);
	assert.equal(first!.textContent, '![run](javascript:alert(1))');
	assert.equal(second!.textContent, '![a](x.png) text after');
	own.stop();
});

test('an indented item is a child list inside its item, three levels deep, and a task item nests too', () => {
	const source = mutable([
		'- one',
		'  1. one one',
		'  2. one two',
		'     - one two one',
		'- two',
		'',
		'- [ ] open',
		'  - [ ] under it',
		'  - [x] done under it',
	].join('\n'));
	const own = page(h(Markdown, { source }));
	const classes = (segments: string[]): string => own.ui.theme.classes(own.ui.theme.base(), segments);
	assert.deepEqual(tags(own.root.firstChild), [
		'ul', 'li', 'p', 'ol', 'li', 'p', 'li', 'p', 'ul', 'li', 'p', 'li', 'p',
		'ul', 'li', 'input', 'p', 'ul', 'li', 'input', 'p', 'li', 'input', 'p',
	]);
	const lists = elements(own.root.firstChild).filter((element) => element.localName === 'ul' || element.localName === 'ol');
	assert.equal(lists[0]!.getAttribute('class'), classes(['markdown_list']), 'the outer list is as it was');
	assert.equal(lists[1]!.getAttribute('class'), classes(['markdown_list', 'ordered', 'nested']), 'a child list carries the nested segment');
	assert.equal(lists[2]!.getAttribute('class'), classes(['markdown_list', 'nested']));
	assert.equal(((lists[1] as unknown as NodeLike).parentNode as unknown as LightElement).localName, 'li', 'inside the item');
	assert.equal(((lists[2] as unknown as NodeLike).parentNode as unknown as LightElement).localName, 'li');
	assert.equal(lists[4]!.getAttribute('class'), classes(['markdown_list', 'nested']), 'under a task item');

	const boxes = elements(own.root.firstChild).filter((element) => element.getAttribute('type') === 'checkbox');
	assert.deepEqual(boxes.map((box) => box.getAttribute('aria-label')), ['open', 'under it', 'done under it']);
	assert.deepEqual(boxes.map((box) => box.getAttribute('checked')), [null, null, '']);
	setProp(boxes[1]!, 'checked', true);
	fire(boxes[1]!, 'change');
	assert.equal(source.get().split('\n')[7], '  - [x] under it', 'the toggle rewrote the nested item\'s own line');
	own.stop();
});

test('a page with a figure and a nested list rendered on a server is taken over in place with nothing replaced', async () => {
	const source = '# Post\n\n![A caption](/media/a.png =640x480)\n\n![A clip](/media/b.mp4)\n\n- one\n  - [ ] one one\n    - one one one\n- two';
	const make = (): unknown => h(Markdown, { source });
	const server = context();
	const markup = await render(h(make as never), { context: server });
	// The comments between elements are the regions a hydration claims (design 157).
	const region = '(?:<!--[^>]*-->)*';
	assert.match(markup, new RegExp(`<figure [^>]*><img [^>]*src="/media/a.png"[^>]*width="640"[^>]*><figcaption>${region}<p `), 'the server wrote the figure');
	assert.match(markup, /<video [^>]*controls[^>]*src="\/media\/b.mp4"/, 'and the video');
	assert.match(markup, new RegExp(`<li [^>]*>${region}<p [^>]*>one</p>${region}<ul `), 'and the child list inside the item');

	const document = createDocument();
	for (const node of parseHtml(markup, document)) document.body.appendChild(node);
	const before = elements(document.body.firstChild);
	assert.ok(before.length > 15, `the page has ${String(before.length)} elements`);
	const stop = hydrate(document.body, make);
	const after = elements(document.body.firstChild);
	assert.equal(after.length, before.length, 'the page has the elements it had');
	assert.deepEqual(before.filter((element, at) => after[at] !== element).map((element) => element.localName), [],
		'a hydration that swaps a node has replaced something it should have adopted');
	assert.equal(toHtml(document.body.childNodes), markup, 'and the page is the page the server sent');
	stop();
});

test('a cell source re-renders the blocks, and the element count follows', () => {
	const source = mutable('# a\n\none');
	const own = page(h(Markdown, { source }));
	assert.deepEqual(tags(own.root.firstChild), ['h1', 'p']);
	source.set('- x\n- y\n- z');
	assert.deepEqual(tags(own.root.firstChild), ['ul', 'li', 'p', 'li', 'p', 'li', 'p']);
	source.set('');
	assert.deepEqual(tags(own.root.firstChild), []);
	own.stop();
});

test('a task item is a checkbox that follows the source and writes it back when the source is a cell', () => {
	const source = mutable('- [ ] open\n- [x] done');
	const own = page(h(Markdown, { source }));
	const boxes = elements(own.root.firstChild).filter((element) => element.getAttribute('type') === 'checkbox');
	assert.equal(boxes.length, 2);
	assert.equal(boxes[0]!.getAttribute('checked'), null);
	assert.equal(boxes[1]!.getAttribute('checked'), '');
	assert.equal(boxes[0]!.getAttribute('aria-label'), 'open', 'the box is named by the item');
	assert.equal(boxes[0]!.getAttribute('disabled'), null, 'a writable source makes the box live');

	setProp(boxes[0]!, 'checked', true);
	fire(boxes[0]!, 'change');
	assert.equal(source.get(), '- [x] open\n- [x] done', 'the toggle rewrote the source');
	const after = elements(own.root.firstChild).filter((element) => element.getAttribute('type') === 'checkbox');
	assert.equal(after[0]!.getAttribute('checked'), '', 'and the re-render shows it ticked');
	own.stop();

	const fixed = page(h(Markdown, { source: '- [ ] open' }));
	const box = elements(fixed.root.firstChild).find((element) => element.getAttribute('type') === 'checkbox')!;
	assert.equal(box.getAttribute('disabled'), '', 'a plain string is read only');
	fixed.stop();

	assert.equal(toggled('- [ ] a\n- [x] b', 1, false), '- [ ] a\n- [ ] b');
	assert.equal(toggled('plain\n- [ ] a', 0, true), 'plain\n- [ ] a', 'a line that is not a task is left alone');
});

test('the code hook is handed the text and the language, and its answer is what the block holds', () => {
	const seen: [string, string | null][] = [];
	const own = page(h(Markdown, {
		source: '```tsx\n<b />\n```\n\n```\nplain\n```',
		code: (text: string, language: string | null) => { seen.push([text, language]); return h('span', { 'data-length': String(text.length) }, 'hooked'); },
	}));
	assert.deepEqual(seen, [['<b />', 'tsx'], ['plain', null]]);
	const pres = elements(own.root.firstChild).filter((element) => element.localName === 'pre');
	assert.equal(toHtml(pres[0]!).replace(/ class="aw\d+"/, ''), '<pre tabindex="0" data-language="tsx"><span data-length="5">hooked</span></pre>');
	assert.equal(pres[1]!.getAttribute('data-language'), null);
	own.stop();
});

test('an application modifier runs inside a paragraph and inside a bold run, ahead of the markdown ones', () => {
	const modifiers = [{ check: /@\w+/g, return: (who: string) => h('b', { 'data-who': who }, who) }];
	const own = page(h(Markdown, { source: 'hi @ada\n\n**bold @grace** and `@code`', modifiers }));
	const [first, second] = elements(own.root.firstChild).filter((element) => element.localName === 'p');
	assert.equal(toHtml(first!).replace(/ class="aw\d+"/g, ''), '<p>hi <b data-who="@ada">@ada</b></p>');
	assert.equal(toHtml(second!).replace(/ class="aw\d+"/g, ''), '<p><strong>bold <b data-who="@grace">@grace</b></strong> and <code>@code</code></p>',
		'the code span started first, so its text is not a mention');
	own.stop();
});

test('with no modifiers prop the render\'s TextModifiers list is the one run ahead of the markdown ones', () => {
	const own = page(h(TextModifiers as never, { value: [{ check: 'TODO', return: (word: string) => h('b', {}, word) }] },
		h(Markdown, { source: 'a TODO here' })));
	const paragraph = elements(own.body.firstChild).find((element) => element.localName === 'p')!;
	assert.equal(toHtml(paragraph).replace(/ class="aw\d+"/g, ''), '<p>a <b>TODO</b> here</p>');
	own.stop();
});

test('a README rendered on a server is taken over in place with nothing replaced', async () => {
	const source = readFileSync(join(root, 'packages', 'ssg', 'README.md'), 'utf8');
	const make = (): unknown => h(Markdown, { source });
	const server = context();
	// Both sides go through a maker, so the server writes the regions the hydration claims
	// (design 157).
	const markup = await render(h(make as never), { context: server });
	assert.match(markup, /<h1 [^>]*id="aweftjsssg"/, 'the server wrote the heading with its id');
	assert.match(markup, /<pre tabindex="0" data-language="ts"/, 'and a fenced block');

	const document = createDocument();
	for (const node of parseHtml(markup, document)) document.body.appendChild(node);
	for (const node of parseHtml(`<style data-aweft>${server.theme.markup()}</style>`, document)) document.head.appendChild(node);

	const before = elements(document.body.firstChild);
	assert.ok(before.length > 200, `the page has ${String(before.length)} elements`);
	const stop = hydrate(document.body, make);
	const after = elements(document.body.firstChild);
	assert.equal(after.length, before.length, 'the page has the elements it had');
	assert.deepEqual(before.filter((element, at) => after[at] !== element).map((element) => element.localName), [],
		'a hydration that swaps a node has replaced something it should have adopted');
	assert.equal(toHtml(document.body.childNodes), markup, 'and the page is the page the server sent');
	stop();
});

test('element decorates the node it was handed, and theme appends to the entry', () => {
	const document = createDocument();
	const given = document.createElement('article') as unknown as ElementLike;
	const ui = context();
	const stop = mount(document.body, h(Markdown, { element: given, theme: 'docs', source: 'x' }), undefined, ui);
	const found = elements(document.body.firstChild)[0]!;
	assert.equal(found, given);
	assert.equal(found.getAttribute('class'), ui.theme.classes(ui.theme.base(), ['markdown', 'docs']));
	stop();
});
