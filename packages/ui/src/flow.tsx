// The two control-flow components. Neither builds an element or keeps any state: each is a
// function of its value, so what they return is what `mount` was going to take anyway.

import { all } from '@aweftjs/core';

import { assert } from './assert.ts';
import { categories, isMark } from './mark.ts';
import { isSource } from './source.ts';

/** Follow a value that may or may not be reactive, through one function. */
const through = (value: unknown, pick: (value: unknown) => unknown): unknown =>
	(isSource(value) && value.map !== undefined ? value.map(pick) : pick(value));

/**
 * One of two subtrees, by a condition.
 *
 * Params:
 *   value: the condition, a value or a cell
 *   invert: flip it
 *   children: the truthy branch, with `<mark.else>` for the other
 *
 * Returns: whichever branch applies, following `value` when it is a cell.
 *
 * Example:
 *   <Shown value={open}>
 *     <Menu />
 *     <mark.else><p>nothing open</p></mark.else>
 *   </Shown>
 */
export const Shown = (props: { value?: unknown; invert?: unknown; children?: unknown[] }): unknown => {
	const [truthy, falsy] = categories(props.children ?? [], ['then', 'else'], 'then');
	const flipped = Boolean(props.invert);
	return through(props.value, (value) => (Boolean(value) !== flipped ? truthy!.items : falsy!.items));
};

/**
 * One subtree of several, by a value or by the first truthy cell.
 *
 * Params:
 *   value: matched against each `<mark.case value=...>`, a value or a cell
 *   cases: an object of cells, the first truthy key winning; not to be given with `value`
 *   children: `<mark.case value=...>` for each branch, and `<mark.default>` for the rest
 *
 * Returns: the branch that matched, following whichever input is reactive.
 *
 * Throws: an assert, loud in development and stripped in a release build, when both `value` and
 * `cases` are given, or when a case has no `value`.
 *
 * Example:
 *   <Switch value={status}>
 *     <mark.case value="loading"><Spinner /></mark.case>
 *     <mark.case value="ready"><List /></mark.case>
 *     <mark.default><p>nothing yet</p></mark.default>
 *   </Switch>
 */
export const Switch = (props: {
	value?: unknown;
	cases?: Record<string, unknown>;
	children?: unknown[];
}): unknown => {
	assert(props.value === undefined || props.cases === undefined,
		'Switch takes value or cases, not both; drop one of the two');

	const branches: { key: unknown; items: unknown[] }[] = [];
	const fallback: unknown[] = [];
	for (const child of props.children ?? []) {
		if (!isMark(child)) {
			if (child !== null && child !== undefined) fallback.push(child);
			continue;
		}
		if (child.name === 'default') {
			fallback.push(...child.props.children);
			continue;
		}
		assert(child.name === 'case', `Switch knows the slots case and default and was given ${child.name}; rename the mark`);
		if (child.name !== 'case') continue;
		assert('value' in child.props, 'a Switch case needs a value to match; write <mark.case value={...}>');
		branches.push({ key: child.props['value'], items: [...child.props.children] });
	}

	if (props.cases !== undefined) {
		const keys = Object.keys(props.cases);
		const pick = (): unknown => {
			for (const key of keys) {
				const held = props.cases![key];
				const value = isSource(held) ? held.get() : held;
				if (value) return branches.find((branch) => branch.key === key)?.items ?? fallback;
			}
			return fallback;
		};
		// Any of the cells moving can change the answer, so the whole set is the input.
		const inputs = keys.map((key) => props.cases![key]);
		return inputs.some(isSource) ? all(inputs).map(() => pick()) : pick();
	}

	return through(props.value, (value) => branches.find((branch) => branch.key === value)?.items ?? fallback);
};
