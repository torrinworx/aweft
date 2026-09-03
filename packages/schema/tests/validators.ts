// Small validators written against the Standard Schema interface, for the suites to describe
// leaves with. They are deliberately somebody else's job: this package ships none.

import type { StandardSchema } from '../src/index.ts';

const leaf = (check: (value: unknown) => string | undefined): StandardSchema => ({
	'~standard': {
		version: 1,
		vendor: 'aweft-tests',
		validate: (value) => {
			const problem = check(value);
			return problem === undefined ? { value } : { issues: [{ message: problem }] };
		},
	},
});

const say = (value: unknown): string => (typeof value === 'string' ? `"${value}"` : String(value));

export const text = (limits: { min?: number; max?: number } = {}): StandardSchema =>
	leaf((value) => {
		if (typeof value !== 'string') return `expected text, got ${say(value)}`;
		if (limits.min !== undefined && value.length < limits.min) {
			return `expected at least ${limits.min} characters, got ${value.length}`;
		}
		if (limits.max !== undefined && value.length > limits.max) {
			return `expected at most ${limits.max} characters, got ${value.length}`;
		}
		return undefined;
	});

export const number = (limits: { min?: number; max?: number } = {}): StandardSchema =>
	leaf((value) => {
		if (typeof value !== 'number') return `expected a number, got ${say(value)}`;
		if (limits.min !== undefined && value < limits.min) return `expected at least ${limits.min}`;
		if (limits.max !== undefined && value > limits.max) return `expected at most ${limits.max}`;
		return undefined;
	});

export const flag = (): StandardSchema =>
	leaf((value) => (typeof value === 'boolean' ? undefined : `expected true or false, got ${say(value)}`));

/** The one way a field is allowed to be absent: a validator that accepts nothing being there. */
export const optional = (inner: StandardSchema): StandardSchema => ({
	'~standard': {
		version: 1,
		vendor: 'aweft-tests',
		validate: (value) => (value === undefined ? { value } : inner['~standard'].validate(value)),
	},
});

/** A validator that answers later, which no commit can wait for. */
export const later = (): StandardSchema => ({
	'~standard': {
		version: 1,
		vendor: 'aweft-tests',
		validate: (value) => Promise.resolve({ value }),
	},
});
