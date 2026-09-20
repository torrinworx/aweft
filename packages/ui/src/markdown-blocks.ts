// Markdown as blocks, line by line, for the subset the documentation corpus uses (design 288),
// with a figure and a nested list for a post (design 296).
//
// A heading, a paragraph, a fenced block, a list three levels deep, a table, a blockquote, a rule
// and a figure. Anything else is the characters written, inside a paragraph: a fourth level joins
// the item above it, an indented block is a paragraph, a setext underline is a rule or a
// paragraph line. The inline syntax is not read here; it is the modifiers' job (`markdown.tsx`).

export type Align = 'left' | 'center' | 'right' | null;

export interface HeadingBlock {
	readonly kind: 'heading';
	readonly level: number;
	readonly text: string;
	/** GitHub's id for the heading: lowercased, marks and punctuation dropped, spaces to hyphens, a repeat suffixed. */
	readonly id: string;
}
export interface ParagraphBlock { readonly kind: 'paragraph'; readonly text: string; }
export interface CodeBlock { readonly kind: 'code'; readonly language: string | null; readonly text: string; }
export interface ListItem {
	readonly text: string;
	/** `open` or `done` for a task item, null for a plain one. */
	readonly task: 'open' | 'done' | null;
	/** The line the item starts on, so a toggle can rewrite it. */
	readonly line: number;
	/** The lists nested under this item, in order; a change of kind starts another. */
	readonly children: readonly ListBlock[];
}
export interface ListBlock {
	readonly kind: 'list';
	readonly ordered: boolean;
	/** The first item's number, for an ordered list. */
	readonly start: number;
	readonly items: readonly ListItem[];
}
export interface FigureBlock {
	readonly kind: 'figure';
	readonly media: 'image' | 'video';
	readonly src: string;
	/** The alt text as written, with its marks; the caption when it is not empty. */
	readonly alt: string;
	/** From the `=WxH` suffix; both or neither. */
	readonly width: number | null;
	readonly height: number | null;
}
export interface TableBlock {
	readonly kind: 'table';
	readonly header: readonly string[];
	readonly align: readonly Align[];
	readonly rows: readonly (readonly string[])[];
}
export interface QuoteBlock { readonly kind: 'quote'; readonly text: string; }
export interface RuleBlock { readonly kind: 'rule'; }

export type Block = HeadingBlock | ParagraphBlock | CodeBlock | ListBlock | TableBlock | QuoteBlock | RuleBlock | FigureBlock;

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)/;
const HEADING = /^ {0,3}(#{1,6})(?:\s+(.*?))?\s*$/;
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^ {0,3}>\s?(.*)$/;
const ITEM = /^(\s*)([-+*]|\d{1,9}[.)])(\s+)(.*)$/;
const TASK = /^\[([ xX])\]\s+(.*)$/;
const DELIMITER = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
// A whole line that is one image: the alt, which may hold one level of brackets so a link can
// sit in a caption; a source that may hold one level of parentheses, as a link's may; a title,
// read and dropped as a link's is; and the size suffix.
const FIGURE = /^!\[((?:[^[\]\n]|\[[^[\]\n]*\])*)\]\(((?:[^()\s]|\([^()\s]*\))+)(?:\s+"[^"]*")?(?:\s+=(\d+)x(\d+))?\)$/;
const VIDEO = /\.(?:mp4|webm|mov)(?:[?#]|$)/i;
// Lists nest three deep; a fourth level is text, as every indented item once was.
const DEPTH = 3;

// A link goes where it says, and a figure shows what it names, unless the scheme is one that runs
// something: then the characters written stay text, because a markdown string is not trusted to
// run script on a click. A path with no scheme, relative or root-relative, is a site's own.
const SCHEME = /^\s*([a-z][a-z0-9+.-]*):/i;
const SAFE_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);

/** Whether a link's `href` or a figure's `src` is one the page may follow. */
export const isSafeHref = (href: string): boolean => {
	const scheme = SCHEME.exec(href)?.[1]?.toLowerCase();
	return scheme === undefined || SAFE_SCHEMES.has(scheme);
};

/** The columns a line's leading whitespace covers: a tab is four, as a reader of markdown counts it. */
const columns = (indent: string): number => indent.replace(/\t/g, '    ').length;

/** The marks a heading's text carries, dropped for its id. */
const plain = (text: string): string => text
	.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
	.replace(/`([^`]*)`/g, '$1')
	.replace(/\*\*([^*]*)\*\*/g, '$1')
	.replace(/\*([^*]*)\*/g, '$1');

/**
 * GitHub's heading ids, unique over the calls of the function returned.
 *
 * Params: none. Each call starts a fresh count, so one slugger serves one document.
 *
 * Returns: a function from a heading's text to its id: the marks dropped, lowercased, anything
 * but letters, numbers, spaces and hyphens dropped, spaces to hyphens; a repeat suffixed `-1`, the
 * next `-2`. `Markdown` gives a heading the id this function gives its text, in document order,
 * so a table of contents built from the same headings in the same order carries the same ids.
 *
 * Example:
 *   const id = slugger();
 *   id('The theme');      // 'the-theme'
 *   id('The theme');      // 'the-theme-1'
 *   id('`h`, `svg` and `html`');  // 'h-svg-and-html'
 */
export const slugger = (): ((text: string) => string) => {
	const seen = new Map<string, number>();
	return (text: string): string => {
		const base = plain(text).toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-');
		const count = seen.get(base) ?? 0;
		seen.set(base, count + 1);
		return count === 0 ? base : `${base}-${String(count)}`;
	};
};

/** A table row's cells: split at each pipe not escaped, the outer pipes dropped, `\|` unescaped. */
const cells = (line: string): string[] => {
	const found: string[] = [];
	let held = '';
	const trimmed = line.trim();
	const inner = trimmed.startsWith('|') ? trimmed.slice(1) : trimmed;
	const body = inner.endsWith('|') && !inner.endsWith('\\|') ? inner.slice(0, -1) : inner;
	for (let at = 0; at < body.length; at += 1) {
		const char = body[at]!;
		if (char === '\\' && body[at + 1] === '|') { held += '|'; at += 1; continue; }
		if (char === '|') { found.push(held.trim()); held = ''; continue; }
		held += char;
	}
	found.push(held.trim());
	return found;
};

const alignOf = (cell: string): Align => {
	const left = cell.startsWith(':');
	const right = cell.endsWith(':');
	return left && right ? 'center' : right ? 'right' : left ? 'left' : null;
};

/** Whether a line starts a block other than a paragraph, which ends the paragraph above it. */
const opens = (line: string, next: string | undefined): boolean =>
	FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || ITEM.test(line)
	|| (line.includes('|') && next !== undefined && DELIMITER.test(next) && next.includes('-'));

/**
 * One list, from the item on `from`, and the line after it.
 *
 * An item indented to the content column of the item above it, or further, starts a child list of
 * that item; one indented less than `floor` belongs to a list above this one and ends it. A change
 * of kind at this list's own level ends it too, and the caller starts the next.
 */
const parseList = (lines: readonly string[], from: number, floor: number, depth: number): { block: ListBlock; at: number } => {
	const first = ITEM.exec(lines[from]!)!;
	const ordered = /\d/.test(first[2]!);
	const start = ordered ? Number.parseInt(first[2]!, 10) : 1;
	const items: ListItem[] = [];
	// The last item's state: where its text begins, so the next line can be read against it, and
	// the array its `children` is, so a child list lands on it.
	let content = 0;
	let children: ListBlock[] = [];
	let at = from;
	while (at < lines.length && lines[at]!.trim() !== '') {
		const own = ITEM.exec(lines[at]!);
		const last = items[items.length - 1];
		if (own !== null) {
			const indent = columns(own[1]!);
			if (indent < floor) break;
			if (last !== undefined && indent >= content) {
				if (depth < DEPTH) {
					const child = parseList(lines, at, content, depth + 1);
					children.push(child.block);
					at = child.at;
					continue;
				}
				// A level too deep: the characters written, on a line of their own.
				items[items.length - 1] = { ...last, text: `${last.text}\n${lines[at]!}` };
				at += 1;
				continue;
			}
			if (/\d/.test(own[2]!) !== ordered) break;
			const task = TASK.exec(own[4]!);
			children = [];
			items.push(task === null
				? { text: own[4]!, task: null, line: at, children }
				: { text: task[2]!, task: task[1] === ' ' ? 'open' : 'done', line: at, children });
			content = indent + own[2]!.length + own[3]!.length;
		} else if (last !== undefined) {
			// A line carrying the item on: prose, joined by a space.
			items[items.length - 1] = { ...last, text: `${last.text} ${lines[at]!.trim()}` };
		}
		at += 1;
	}
	return { block: { kind: 'list', ordered, start, items }, at };
};

/**
 * The blocks of a markdown string.
 *
 * Params:
 *   source: the text
 *
 * Returns: the blocks in order. A heading carries its id, a list item the line it starts on and
 * the lists nested under it, a figure its source, alt text and size.
 *
 * Example:
 *   parseBlocks('# Title\n\nA paragraph.');
 *   // [{ kind: 'heading', level: 1, text: 'Title', id: 'title' }, { kind: 'paragraph', text: 'A paragraph.' }]
 */
export const parseBlocks = (source: string): Block[] => {
	const lines = source.replace(/\r\n?/g, '\n').split('\n');
	const blocks: Block[] = [];
	const id = slugger();
	let at = 0;

	while (at < lines.length) {
		const line = lines[at]!;

		if (line.trim() === '') { at += 1; continue; }

		const fence = FENCE.exec(line);
		if (fence !== null) {
			const mark = fence[1]!;
			const held: string[] = [];
			at += 1;
			while (at < lines.length) {
				const candidate = lines[at]!.trim();
				if (candidate.startsWith(mark[0]!) && /^(`{3,}|~{3,})$/.test(candidate) && candidate.length >= mark.length) break;
				held.push(lines[at]!);
				at += 1;
			}
			at += 1;
			blocks.push({ kind: 'code', language: fence[2] === '' ? null : fence[2]!, text: held.join('\n') });
			continue;
		}

		const heading = HEADING.exec(line);
		if (heading !== null) {
			const text = (heading[2] ?? '').replace(/\s+#+$/, '').trim();
			blocks.push({ kind: 'heading', level: heading[1]!.length, text, id: id(text) });
			at += 1;
			continue;
		}

		if (RULE.test(line)) {
			blocks.push({ kind: 'rule' });
			at += 1;
			continue;
		}

		if (QUOTE.test(line)) {
			const held: string[] = [];
			// A quoted line, or a plain line carrying the paragraph on; a line that opens another
			// block ends the quote, as it ends a paragraph.
			while (at < lines.length && lines[at]!.trim() !== '' && (held.length === 0 || QUOTE.test(lines[at]!) || !opens(lines[at]!, lines[at + 1]))) {
				const quoted = QUOTE.exec(lines[at]!);
				held.push(quoted === null ? lines[at]!.trim() : quoted[1]!.trim());
				at += 1;
			}
			blocks.push({ kind: 'quote', text: held.join(' ').trim() });
			continue;
		}

		const item = ITEM.exec(line);
		if (item !== null && item[1]!.length < 4) {
			const list = parseList(lines, at, 0, 1);
			blocks.push(list.block);
			at = list.at;
			continue;
		}

		if (line.includes('|') && at + 1 < lines.length && DELIMITER.test(lines[at + 1]!) && lines[at + 1]!.includes('-')) {
			const header = cells(line);
			const align = cells(lines[at + 1]!).map(alignOf);
			const rows: string[][] = [];
			at += 2;
			while (at < lines.length && lines[at]!.includes('|') && lines[at]!.trim() !== '') {
				const row = cells(lines[at]!);
				// A short row is padded and a long one cut, so every row has the header's width.
				rows.push(header.map((_, column) => row[column] ?? ''));
				at += 1;
			}
			blocks.push({ kind: 'table', header, align, rows });
			continue;
		}

		const held: string[] = [];
		while (at < lines.length && lines[at]!.trim() !== '' && (held.length === 0 || !opens(lines[at]!, lines[at + 1]))) {
			held.push(lines[at]!);
			at += 1;
		}
		// One line that is only an image is a figure, unless its source is one that runs something.
		const figure = held.length === 1 ? FIGURE.exec(held[0]!.trim()) : null;
		if (figure !== null && isSafeHref(figure[2]!)) {
			blocks.push({
				kind: 'figure',
				media: VIDEO.test(figure[2]!) ? 'video' : 'image',
				src: figure[2]!,
				alt: figure[1]!.trim(),
				width: figure[3] === undefined ? null : Number.parseInt(figure[3], 10),
				height: figure[4] === undefined ? null : Number.parseInt(figure[4], 10),
			});
			continue;
		}
		// Two trailing spaces are a line break; a bare newline is a space.
		let text = '';
		for (let index = 0; index < held.length; index += 1) {
			const own = held[index]!.trim();
			const hard = /\s{2,}$/.test(held[index]!);
			text += own;
			if (index < held.length - 1) text += hard ? '\n' : ' ';
		}
		blocks.push({ kind: 'paragraph', text });
	}

	return blocks;
};

/**
 * The source with one task item's box rewritten.
 *
 * Params:
 *   source: the markdown
 *   line: the line the item starts on, as `parseBlocks` reported it
 *   done: whether the box is now ticked
 *
 * Returns: the same text with `[ ]` or `[x]` on that line, and the text unchanged when the line
 * is not a task item.
 *
 * Example:
 *   toggled('- [ ] a\n- [x] b', 0, true);  // '- [x] a\n- [x] b'
 */
export const toggled = (source: string, line: number, done: boolean): string => {
	const lines = source.replace(/\r\n?/g, '\n').split('\n');
	const own = lines[line];
	if (own === undefined) return source;
	lines[line] = own.replace(/^(\s*(?:[-+*]|\d{1,9}[.)])\s+)\[[ xX]\]/, `$1[${done ? 'x' : ' '}]`);
	return lines.join('\n');
};
