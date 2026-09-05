// Static hoisting: a subtree whose shape is known becomes a template made once and instanced
// per use (designs 089, 093, 094, 095).
//
// What goes in the template is what the source fixed: element names, attributes whose value is a
// literal, and text. Everything else becomes an edit, and an edit's value is a piece of the
// original expression, emitted in the order the `h` calls this replaces would have run in: for
// each element its own varying children, then its nested elements, then its own properties.

import { type Child, type Element, type Property, propertiesCode } from './element.ts';

export interface Hoister {
	/** The code for one element: a template instance where that is sound, else its own fallback. */
	emit(element: Element): string;
	/** The template declarations to put at the top of the file, in the order they were made. */
	readonly declarations: readonly string[];
}

/**
 * Whether an element's shape is fixed enough to sit in a template.
 *
 * A spread may carry `children` at runtime, which `h` mounts and a template would drop, and
 * `children` written out is the same case. A tag that is not a literal name has no element to
 * put in a prototype (design 095).
 */
const fixed = (element: Element): boolean =>
	element.tag !== null
	&& !element.properties.some((property) => property.kind === 'spread' || property.name === 'children');

/** An attribute the prototype can carry: a literal value, under a name that is not a property. */
const isPrototypeAttribute = (property: Property): property is Property & { kind: 'static' } =>
	property.kind === 'static' && property.name[0] !== '$';

/**
 * Make a hoister for one file.
 *
 * Params:
 *   enabled: false leaves every element as its own fallback, which is what a file whose `h` is
 *            not provably `dom`'s gets (design 092)
 *   template: the local name of `dom`'s `template`
 *   prefix: the base for each generated declaration's name
 *
 * Returns: the hoister. Read `declarations` after every element has been emitted.
 *
 * Example:
 *   const hoister = createHoister(true, '_template', '_t');
 *   const code = hoister.emit(element);
 */
export const createHoister = (enabled: boolean, template: string, prefix: string): Hoister => {
	const declarations: string[] = [];

	const emit = (element: Element): string => {
		if (!enabled || !fixed(element)) return element.fallback();

		const edits: unknown[] = [];
		const values: string[] = [];
		const spec = visit(element, [], edits, values);

		const name = `${prefix}${declarations.length}`;
		declarations.push(`const ${name} = ${template}(${JSON.stringify(spec)}, ${JSON.stringify(edits)});`);
		return `${name}([${values.join(', ')}])`;
	};

	const visit = (element: Element, path: readonly number[], edits: unknown[], values: string[]): unknown[] => {
		const attributes: Record<string, string | number | boolean> = {};
		const varying: Property[] = [];
		for (const property of element.properties) {
			if (!isPrototypeAttribute(property)) {
				varying.push(property);
				continue;
			}
			// `setAttribute` removes an attribute for these, so the prototype simply has none.
			if (property.value === null || property.value === false) continue;
			attributes[property.name] = property.value;
		}

		const spec: unknown[] = [element.tag, Object.keys(attributes).length === 0 ? null : attributes];
		const nested: { readonly element: Element; readonly at: number }[] = [];
		const varyingChildren: { before: number; readonly code: string }[] = [];
		let statics = 0;

		for (const child of element.children) {
			if (child.kind === 'text') {
				spec.push(child.text);
				statics += 1;
			} else if (child.kind === 'element' && fixed(child.element)) {
				nested.push({ element: child.element, at: statics });
				spec.push(null);
				statics += 1;
			} else {
				varyingChildren.push({ before: statics, code: childValue(child) });
			}
		}
		// A varying child with no static child after it goes at the end of the element.
		for (const entry of varyingChildren) if (entry.before === statics) entry.before = -1;

		for (const entry of varyingChildren) {
			edits.push(['child', path, entry.before]);
			values.push(entry.code);
		}
		for (const entry of nested) {
			spec[2 + entry.at] = visit(entry.element, [...path, entry.at], edits, values);
		}
		if (varying.length > 0) {
			edits.push(['props', path]);
			values.push(propertiesCode(varying));
		}
		return spec;
	};

	const childValue = (child: Child): string =>
		(child.kind === 'code' ? child.code : child.kind === 'text' ? JSON.stringify(child.text) : emit(child.element));

	return { emit, declarations };
};
