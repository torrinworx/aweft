// The text a page shows, looked up where it mounts (design 278).
//
// `text('Save')` answers a token: a component call `dom` mounts, carrying its source on a
// symbol so code with no mount context can still read what it was. The lookup runs in the four
// places that have the context: this component for a child, `ui`'s `h` for a prop, `Typography`
// for a label, and a head component for a tag. Nothing here holds state at module scope but the
// parse cache in `message.ts`, which is data written once per source string.

import { type Mounter, h as domH, mount } from '@aweftjs/dom';
import { mutable } from '@aweftjs/core';

import { assert } from './assert.ts';
import { type Piece, type Read, formatMessage, joinPieces, mountPieces, parseMessage } from './message.ts';
import { recordText, renderOf } from './render.ts';
import { type Source, isSource } from './source.ts';

const TEXT: unique symbol = Symbol('aweft.ui.text');

/** What a text token was made from. */
export interface TextSource {
	/** The message as written. */
	readonly source: string;
	/** What the catalog is asked for: the source, or `source|context` when the call named one. */
	readonly key: string;
	readonly values: TextValues | undefined;
}

/**
 * The values a message names: a hole's value, a plural's number, a select's word, a tag's
 * function. A cell among them is followed. `context` is not a value: it disambiguates the key.
 */
export interface TextValues {
	/** One word telling two meanings of the same source apart: `text('Close', { context: 'dialog' })`. */
	readonly context?: string;
	readonly [name: string]: unknown;
}

/** A text token: mountable as a child, and readable through `isText` and `textOf`. */
export interface TextToken {
	(...args: never[]): unknown;
	readonly [TEXT]: TextSource;
}

/** The key a source and its values name. */
const keyOf = (source: string, values: TextValues | undefined): string => {
	const context = values?.context;
	return typeof context === 'string' && context !== '' ? `${source}|${context}` : source;
};

/** The values with `context` taken out, so a message hole cannot be named after it by accident. */
const holesOf = (values: TextValues | undefined): Readonly<Record<string, unknown>> | undefined => {
	if (values === undefined) return undefined;
	const { context: _, ...rest } = values;
	return rest;
};

/** The message a token shows in a render: the catalog's entry for its key, or its source. */
const messageIn = (context: unknown, held: TextSource): { message: string; locale: string | undefined } => {
	const render = renderOf(context);
	if (render === null) return { message: held.source, locale: undefined };
	recordText(render, held.key);
	const catalog = render.catalog;
	// An own entry only: a key like `constructor` must not read `Object.prototype`.
	const entry = catalog !== undefined && Object.hasOwn(catalog, held.key) ? catalog[held.key] : undefined;
	if (entry === undefined) return { message: held.source, locale: render.locale };
	assert(typeof entry === 'string',
		`the catalog entry for ${JSON.stringify(held.key)} is ${JSON.stringify(entry)} and a translation is a string; fix the catalog`);
	return { message: typeof entry === 'string' ? entry : held.source, locale: render.locale };
};

const now: Read = (value) => (isSource(value) ? value.get() : value);

/** The token's message, formatted, with `read` following whatever cells its values hold. */
const piecesIn = (context: unknown, held: TextSource, read: Read): Piece[] => {
	const { message, locale } = messageIn(context, held);
	return formatMessage(parseMessage(message), holesOf(held.values), locale, read);
};

/**
 * The cells among a token's values, so a consumer can follow them.
 *
 * Params:
 *   token: a text token
 *
 * Returns: the sources, or an empty list for a token whose values are all plain, which is the
 * case a consumer keeps free of any subscription.
 */
export const cellsOf = (token: TextToken): Source[] => cellsIn(token[TEXT]);

const cellsIn = (held: TextSource): Source[] => {
	const out: Source[] = [];
	const values = held.values;
	if (values === undefined) return out;
	for (const name of Object.keys(values)) {
		const value = values[name];
		if (isSource(value)) out.push(value);
	}
	return out;
};

/** The component a token is: mounts the message, and follows the cells among its values. */
const Text = (props: { held: TextSource }): Mounter => (elem, _item, before, context) => {
	const held = props.held;
	const sources = cellsIn(held);
	if (sources.length === 0) {
		return mount(elem, mountPieces(piecesIn(context, held, now)), before, context);
	}
	// A cell among the values moves the branch a plural or a select picks, so the whole message
	// is formatted again when any of them moves, into one cell `dom` replaces in place.
	const shown = mutable<unknown>(null);
	let building = true;
	const refresh = (): void => { shown.set(mountPieces(piecesIn(context, held, now))); };
	const stops = sources.map((source) => source.effect(() => { if (!building) refresh(); }));
	building = false;
	refresh();
	const remove = mount(elem, shown, before, context);
	return (arg) => {
		if (arg !== undefined) return remove(arg);
		for (const stop of stops) stop();
		return remove();
	};
};

/**
 * A piece of text a page shows, to be looked up in the render's catalog where it mounts.
 *
 * Params:
 *   source: the message as written, in the subset of ICU MessageFormat the package reads:
 *           `{name}` holes, `{n, plural, one {# item} other {# items}}`, `{kind, select, book
 *           {a book} other {a thing}}`, and `<link>the docs</link>` around part of it
 *   values: what the message names. A hole takes any value and a cell is followed; a plural
 *           takes a number; a select takes a word; a tag takes a function from the inner content
 *           to what to mount. `context` is one word that tells two meanings of the same source
 *           apart and becomes part of the key
 *
 * Returns: a token. As a child it mounts the message, translated when the render has a catalog
 * with its key and as written when it has none. In a prop, `ui`'s `h` writes the resolved string
 * on the element. `Typography` runs its modifiers over the resolved string, and a head component
 * writes it into its tag. `textOf` answers the string for code that needs characters.
 *
 * Throws: an assert, loud in development and stripped in a release build, for a source that is
 * not a string. A message that cannot be read asserts where it is first formatted, naming the
 * offset.
 *
 * Example:
 *   <p>{text('Hello {name}', { name })}</p>
 *   <Button label={text('Save')} />
 *   <p>{text('Read <link>the docs</link>', { link: (inner) => <a href="/docs">{inner}</a> })}</p>
 */
export const text = (source: string, values?: TextValues): TextToken => {
	assert(typeof source === 'string', 'text takes the message as a string; write the words, and put a value in a {hole}');
	const held: TextSource = { source: String(source), key: keyOf(String(source), values), values };
	const call = domH(Text, { held }) as (...args: never[]) => unknown;
	return Object.assign(call, { [TEXT]: held }) as TextToken;
};

/**
 * Whether a value is a text token.
 *
 * Params:
 *   value: anything
 *
 * Returns: true for what `text()` answered.
 *
 * Example:
 *   if (isText(label)) label = textOf(context, label);
 */
export const isText = (value: unknown): value is TextToken =>
	typeof value === 'function' && (value as Partial<TextToken>)[TEXT] !== undefined;

/** What a token was made from. */
export const sourceOf = (token: TextToken): TextSource => token[TEXT];

/**
 * The string a value shows in a render, read through `read`, which is how a consumer that
 * follows the cells among a token's values subscribes to them.
 */
export const textIn = (context: unknown, value: unknown, read: Read): string => {
	const held = read(value);
	if (isText(held)) return joinPieces(piecesIn(context, held[TEXT], read), read);
	if (held === null || held === undefined) return '';
	return String(held);
};

/**
 * The string a value shows, resolved in a render.
 *
 * Params:
 *   context: the opaque context `dom` handed a mounter, or the render `context()` made, so code
 *            outside any mount, a server module building a title, resolves against a render of
 *            its own
 *   value: a text token, a string, a number, or a cell holding one
 *
 * Returns: for a token, its message in the render's language with its values as they are now
 * written in and a tag reduced to what is inside it; for a string or a number, that; for null
 * or undefined, the empty string. A context with no `ui` systems shows a token's source.
 *
 * Example:
 *   document.title = textOf(context, text('Inbox'));
 */
export const textOf = (context: unknown, value: unknown): string => textIn(context, value, now);

/**
 * The language a render shows.
 *
 * Params:
 *   context: the opaque context `dom` handed a mounter, or the render `context()` made
 *
 * Returns: the BCP 47 tag the page gave `context()`, or undefined for a page that named none,
 * which is what `Intl` takes for the host's own language.
 *
 * Example:
 *   new Intl.DateTimeFormat(localeOf(context)).format(when);
 */
export const localeOf = (context: unknown): string | undefined => renderOf(context)?.locale;
