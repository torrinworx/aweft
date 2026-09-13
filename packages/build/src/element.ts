// One element, read out of whichever notation wrote it.
//
// JSX, markup in a template literal and a hand-written `h` call all describe the same thing: a
// tag, some properties, some children. Each notation has its own reader; all three produce this,
// and the hoisting pass sees only this. What an element cannot be hoisted into a template is
// written back out by its own `fallback`, because the three notations differ there: two have to
// be printed as an `h` call and the third is already one and is left where it is.

/** One property or attribute. `static` is a literal in the source, so it can go in a template. */
export type Property =
	| { readonly kind: 'static'; readonly name: string; readonly value: string | number | boolean | null }
	| { readonly kind: 'expr'; readonly name: string; readonly code: string }
	| { readonly kind: 'spread'; readonly code: string };

/** What sits inside an element. */
export type Child =
	| { readonly kind: 'text'; readonly text: string }
	| { readonly kind: 'code'; readonly code: string }
	| { readonly kind: 'element'; readonly element: Element };

export interface Element {
	/** The tag when it is a literal name, and null when the tag is an expression. */
	readonly tag: string | null;
	readonly properties: readonly Property[];
	readonly children: readonly Child[];
	/** The offset in the source the element opens at, for a refusal to point at. */
	readonly at: number;
	/** The code for this element when it is not hoisted into a template. */
	fallback(): string;
}

/** Text in markup: a line is trimmed, a blank line goes, and a line break becomes one space. */
export const collapseText = (text: string): string => {
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

const PLAIN_KEY = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** A property name as it goes in an object literal: bare when it can be, quoted when it cannot. */
export const propertyKey = (name: string): string =>
	(PLAIN_KEY.test(name) ? name : JSON.stringify(name));

/** The properties of an element as one object literal, or `null` when there are none. */
export const propertiesCode = (properties: readonly Property[]): string => {
	if (properties.length === 0) return 'null';
	const parts = properties.map((property) => {
		if (property.kind === 'spread') return `...${property.code}`;
		if (property.kind === 'static') return `${propertyKey(property.name)}: ${JSON.stringify(property.value)}`;
		return `${propertyKey(property.name)}: ${property.code}`;
	});
	return `{ ${parts.join(', ')} }`;
};

/** One child as an argument to `h`. A nested element goes through `emit`, so a subtree inside an
 * element that cannot be hoisted still gets its own template. */
export const childCode = (child: Child, emit: (element: Element) => string): string => {
	if (child.kind === 'text') return JSON.stringify(child.text);
	if (child.kind === 'code') return child.code;
	return emit(child.element);
};

/**
 * Print an element as a call to `h`.
 *
 * Params:
 *   h: the name to call
 *   tag: the tag as code, already a quoted string for a literal name
 *   element: the element to print
 *   emit: how a nested element becomes code
 *
 * Returns: the call, with `null` for properties when there are none.
 *
 * Example:
 *   emitCall('h', "'div'", element, hoister.emit);
 */
export const emitCall = (h: string, tag: string, element: Element, emit: (element: Element) => string): string => {
	const args = [tag, propertiesCode(element.properties), ...element.children.map((child) => childCode(child, emit))];
	return `${h}(${args.join(', ')})`;
};
