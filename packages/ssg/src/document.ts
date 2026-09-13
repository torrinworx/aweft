// The finished page: a bundler's shell with one render put into it (design 149).
//
// The shell is read as text, not parsed. Four positions are wanted, all of them written by every
// bundler in the same shape: the `<head>` open tag, a leading `<meta charset>`, the shell's own
// `<title>`, and the `<body>` open tag. Parsing the shell would mean serializing it again, which
// means deciding how to write every tag the bundler put there.

import { codecError } from '@aweftjs/codec';
import type { HeadList, HeadTag } from '@aweftjs/ui';

import { STAMP } from './stamp.ts';

/** The attribute `ui` finds its stylesheet by, so a hydration adopts the one written here. */
const SHEET = 'data-aweft';

/** One language a page is also in, for the `hreflang` alternates. */
export interface Alternate {
	/** The tag, or `x-default` for the URL a reader with no matching language gets. */
	readonly hreflang: string;
	/** The page's absolute URL in that language. */
	readonly href: string;
}

/** What one render of a page hands the document. */
export interface DocumentParts {
	/** The markup the page rendered to. */
	readonly body: string;
	/** The theme's stylesheet for this render. */
	readonly css: string;
	/** The page's head tags, as `head.markup()` wrote them. */
	readonly head: string;
	/** The page's own title, or null when it declares none. */
	readonly title: string | null;
	/** The page's language, written on `<html lang>`; left off, the shell's own `lang` stands (design 279). */
	readonly lang?: string;
	/** Whether the language runs right to left, which writes `dir="rtl"` on `<html>`. */
	readonly rtl?: boolean;
	/** Every language the page is in, written as `<link rel="alternate" hreflang>` in the head. */
	readonly alternates?: readonly Alternate[];
}

interface Tag {
	/** Where the tag starts. */
	readonly at: number;
	/** Where it ends, one past its `>`. */
	readonly end: number;
	/** The tag itself. */
	readonly text: string;
}

const openTag = (shell: string, name: string): Tag | null => {
	const found = new RegExp(`<${name}(\\s[^>]*)?>`, 'i').exec(shell);
	return found === null ? null : { at: found.index, end: found.index + found[0].length, text: found[0] };
};

const closeTag = (shell: string, name: string): Tag | null => {
	const found = new RegExp(`</${name}\\s*>`, 'i').exec(shell);
	return found === null ? null : { at: found.index, end: found.index + found[0].length, text: found[0] };
};

/** The leading `<meta charset>` a shell wrote as the head's first child, or nothing. */
const LEADING_CHARSET = /^(\s*)(<meta\s[^>]*charset\s*=[^>]*>)/i;

// Global, because a shell with two titles ships two titles otherwise, and only the first one a
// crawler reads is the page's.
const SHELL_TITLE = /<title(\s[^>]*)?>[\s\S]*?<\/title\s*>/gi;

/** A `<body>` open tag with the stamp on it, unless it is already there. */
const stamp = (tag: string): string =>
	new RegExp(`\\s${STAMP}(\\s|=|>)`, 'i').test(tag) ? tag : `${tag.slice(0, tag.length - 1)} ${STAMP}="">`;

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const attribute = (value: string): string => value.replace(/[&<>"]/g, (found) => ESCAPES[found]!);

/** An open tag with one attribute set, replacing the one it carried under that name. */
const withAttribute = (tag: string, name: string, value: string): string => {
	const dropped = tag.replace(new RegExp(`\\s${name}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]*)`, 'i'), '');
	return `${dropped.slice(0, dropped.length - 1)} ${name}="${attribute(value)}">`;
};

/**
 * The shell with the page's language on its `<html>` tag: `lang` always, and `dir="rtl"` for a
 * script that runs right to left (design 279).
 *
 * Params:
 *   shell: the page shell as the bundler built it
 *   parts: `lang` and `rtl`; the rest is not read
 *
 * Returns: the shell with the tag rewritten, or as it was when `lang` is left off or the shell
 * has no `<html>` tag. This is also what a language's own `shell.html` is: the shell, its
 * language, and nothing else.
 *
 * Example:
 *   writeFileSync('dist/fr/shell.html', languageOn(shell, { lang: 'fr' }));
 */
export const languageOn = (shell: string, parts: Pick<DocumentParts, 'lang' | 'rtl'>): string => {
	if (parts.lang === undefined) return shell;
	const html = openTag(shell, 'html');
	if (html === null) return shell;
	let tag = withAttribute(html.text, 'lang', parts.lang);
	if (parts.rtl === true) tag = withAttribute(tag, 'dir', 'rtl');
	return shell.slice(0, html.at) + tag + shell.slice(html.end);
};

/** The alternates as head markup, one link per language. */
const alternatesOf = (alternates: readonly Alternate[] | undefined): string =>
	(alternates ?? []).map((one) => `<link rel="alternate" hreflang="${attribute(one.hreflang)}" href="${attribute(one.href)}">`).join('');

/**
 * Build one finished HTML document.
 *
 * Params:
 *   shell: the page shell the bundler built, `dist/index.html` as it stands
 *   parts: one render of one page
 *
 * Returns: the whole document, ready to write to disk. The theme's stylesheet and the page's head
 * tags go at the front of `<head>`, behind a `<meta charset>` the shell wrote as the head's first
 * child (design 127), and the alternates after them. The shell's own `<title>` is dropped when
 * the page declares one. The markup goes inside `<body>`, and the body tag gains `data-aweft-ssg`.
 * With a `lang`, the `<html>` tag carries it, and `dir="rtl"` beside it for a right-to-left
 * script (design 279).
 *
 * Throws: `shell-head` and `shell-body` when the shell has no such element, and
 * `shell-body-content` when the shell's body already holds markup, because the page's markup is
 * what goes there and a hydration refuses anything else it finds.
 *
 * Example:
 *   const html = buildDocument(readFileSync('dist/index.html', 'utf8'), parts);
 */
export const buildDocument = (given: string, parts: DocumentParts): string => {
	const shell = languageOn(given, parts);
	const headOpen = openTag(shell, 'head');
	const headClose = closeTag(shell, 'head');
	if (headOpen === null || headClose === null || headClose.at < headOpen.end) {
		throw codecError('shell-head', 'the page shell has no <head> ... </head>',
			'Give the page shell a head element; the stylesheet and the page\'s head tags go at the front of it.');
	}

	const bodyOpen = openTag(shell, 'body');
	const bodyClose = closeTag(shell, 'body');
	// After the head as well as present: the four positions are cut out of the shell in order, and
	// a body in front of the head would have this splicing the document into nonsense.
	if (bodyOpen === null || bodyClose === null || bodyClose.at < bodyOpen.end || bodyOpen.at < headClose.end) {
		throw codecError('shell-body', 'the page shell has no <body> ... </body> after its head',
			'Give the page shell a body element after its head; the page\'s markup goes inside it.');
	}

	const inside = shell.slice(bodyOpen.end, bodyClose.at);
	if (inside.trim() !== '') {
		throw codecError('shell-body-content', `the page shell's body already holds ${JSON.stringify(inside.trim().slice(0, 60))}`,
			'Move it into the head or into a component; the generated body holds the page\'s markup and a hydration refuses anything else.');
	}

	// The charset is read off the head as the shell wrote it, before the title is taken out, so a
	// charset that was second stays second and is not promoted by the removal.
	const head = shell.slice(headOpen.end, headClose.at);
	const found = LEADING_CHARSET.exec(head);
	const lead = found === null ? '' : found[1]! + found[2]!;
	const after = found === null ? head : head.slice(found[0].length);
	const kept = parts.title === null ? after : after.replace(SHELL_TITLE, '');
	const run = `<style ${SHEET}>${parts.css}</style>${parts.head}${alternatesOf(parts.alternates)}`;

	// Every HTML parser moves character data found after `</body>` back into the body, so a newline
	// between `</body>` and `</html>` arrives as a text node at the end of the page and a hydration
	// reports it as markup the client did not render. The shell's tail therefore loses its
	// whitespace, and the markup goes in with none around it.
	const tail = shell.slice(bodyClose.at).replace(/>\s+</g, '><').replace(/\s+$/, '');

	return shell.slice(0, headOpen.end)
		+ lead + run + kept
		+ shell.slice(headClose.at, bodyOpen.at)
		+ stamp(bodyOpen.text)
		+ parts.body
		+ tail;
};

/** A head attribute's value, read through the cell it may be behind. */
const read = (value: unknown): unknown => {
	const held = value as { get?: () => unknown } | null;
	return held !== null && typeof held === 'object' && typeof held.get === 'function' ? held.get() : value;
};

const isRobots = (tag: HeadTag): boolean =>
	tag.kind === 'meta' && String(read(tag.attrs['name']) ?? '').toLowerCase() === 'robots';

/**
 * Whether a page asked search engines to leave it out.
 *
 * Params:
 *   head: the render's head list, after the page has rendered
 *
 * Returns: true when the winning `robots` meta names `noindex`. The winner is the deepest and then
 * the latest, which is the rule the emitted markup follows (design 127), so a page inside a layout
 * that says `index` wins over the layout.
 *
 * Read off the list rather than out of the HTML, because a regular expression over a document
 * cannot tell the tag the page won with from one that lost its group and was never emitted.
 *
 * Example:
 *   if (!noindexOf(own.head)) sitemap.push(url);
 */
export const noindexOf = (head: HeadList): boolean => {
	let winner: HeadTag | null = null;
	for (const tag of head.items) {
		if (isRobots(tag) && (winner === null || tag.depth >= winner.depth)) winner = tag;
	}
	if (winner === null) return false;
	return String(read(winner.attrs['content']) ?? '').toLowerCase().includes('noindex');
};
