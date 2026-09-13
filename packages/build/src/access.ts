// The access rules: an element the source says no one could read is refused where it was
// written (design 265).
//
// Every rule reads the tag, the literal attributes, the children and the ancestors inside the
// same tree, and nothing the page would only know at run time. An attribute given as an
// expression is present; a spread makes the element unknowable and the rules leave it alone.

import type { Element, Property } from './element.ts';
import { transformError } from './error.ts';

const INTERACTIVE = new Set(['a', 'button', 'input', 'select', 'textarea', 'summary', 'details', 'option', 'label', 'audio', 'video']);
const CONTROLS = new Set(['input', 'textarea', 'select']);
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
// An input of these types carries its own name, or is nothing a person reaches.
const SELF_NAMED_INPUTS = new Set(['hidden', 'submit', 'button', 'reset', 'image']);
const CLICKS = new Set(['$onclick', 'onclick', 'onClick']);

const has = (element: Element, ...names: readonly string[]): boolean =>
	element.properties.some((property) => property.kind !== 'spread' && names.includes(property.name));

const literal = (element: Element, name: string): string | number | boolean | null | undefined => {
	const found = element.properties.find((property): property is Extract<Property, { kind: 'static' }> =>
		property.kind === 'static' && property.name === name);
	return found?.value;
};

const spread = (element: Element): boolean => element.properties.some((property) => property.kind === 'spread');

/** Whether nothing is inside the element but whitespace. */
const emptyInside = (element: Element): boolean =>
	element.children.every((child) => child.kind === 'text' && child.text.trim() === '');

const check = (element: Element, ancestors: readonly string[]): void => {
	const tag = element.tag;
	// A component or a spread is not an element the rules can read, and the elements inside it
	// still are.
	if (tag !== null && !spread(element)) rules(element, tag, ancestors);
	const below = tag === 'label' ? [...ancestors, tag] : ancestors;
	for (const child of element.children) {
		if (child.kind === 'element') check(child.element, below);
	}
};

const rules = (element: Element, tag: string, ancestors: readonly string[]): void => {
	const empty = emptyInside(element);

	if (tag === 'img' && !has(element, 'alt')) {
		throw transformError('image-needs-alt', '<img> has no alt',
			'Give the image an alt that says what it shows, or alt="" for a decorative one.', element.at);
	}
	if (CONTROLS.has(tag) && !has(element, 'id', 'aria-label', 'aria-labelledby') && !ancestors.includes('label')) {
		const type = tag === 'input' ? literal(element, 'type') : undefined;
		if (!(typeof type === 'string' && SELF_NAMED_INPUTS.has(type.toLowerCase()))) {
			throw transformError('control-needs-label', `<${tag}> has no label`,
				'Give it an id and a <label for> naming it, wrap it in a <label>, or give it an aria-label.', element.at);
		}
	}
	if (tag === 'a' && !has(element, 'href')) {
		throw transformError('link-needs-href', '<a> has no href',
			'Give the link an href, or make it a <button> when it does something on the page.', element.at);
	}
	if (!INTERACTIVE.has(tag) && has(element, ...CLICKS) && !has(element, 'role', 'tabindex', 'tabIndex')) {
		throw transformError('click-needs-role', `<${tag}> takes a click and nothing else`,
			'Make it a <button>, or give it a role and a tabindex so the keyboard reaches it.', element.at);
	}
	const tabindex = literal(element, 'tabindex') ?? literal(element, 'tabIndex');
	if (tabindex !== undefined && tabindex !== null && Number(tabindex) > 0) {
		throw transformError('tabindex-positive', `tabindex="${String(tabindex)}" reorders the page`,
			'Use 0 to join the tab order where the element sits, or -1 to reach it from code only.', element.at);
	}
	if (tag === 'button' && empty && !has(element, 'aria-label', 'aria-labelledby', 'title')) {
		throw transformError('button-needs-name', '<button> has no name',
			'Put text inside the button, or give it an aria-label.', element.at);
	}
	if (HEADINGS.has(tag) && empty && !has(element, 'aria-label')) {
		throw transformError('heading-needs-text', `<${tag}> is empty`,
			'Put the heading\'s text inside it, or drop the heading.', element.at);
	}
	if (tag === 'iframe' && !has(element, 'title')) {
		throw transformError('frame-needs-title', '<iframe> has no title',
			'Give the frame a title that says what it holds.', element.at);
	}
};

const checked = new WeakSet<Element>();

/**
 * Refuse an element tree the access rules say no one could read.
 *
 * Params:
 *   element: the top of a tree a reader produced
 *
 * Throws: a `TransformError` at the element, with the reason and the fix, for the first fault
 * found. A tree already checked is not walked again, so an element emitted a second time on its
 * own, once its parent fell back to a call, keeps the ancestors it was first checked with.
 *
 * Example:
 *   checkAccess(readElement(node, reader));
 */
export const checkAccess = (element: Element): void => {
	if (checked.has(element)) return;
	const mark = (tree: Element): void => {
		checked.add(tree);
		for (const child of tree.children) if (child.kind === 'element') mark(child.element);
	};
	mark(element);
	check(element, []);
};
