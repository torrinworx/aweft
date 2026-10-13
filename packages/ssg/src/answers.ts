// What a render on request records for the browser, and how both halves read it (design 304).
//
// A file of its own, like `stamp.ts`, because both halves import it and the browser half must not
// import the render. It holds the key both halves compute for one ask, the type of a recorded
// answer, the id of the script the answers are written in, and the error made from a recorded
// refusal.

import { codecError } from '@aweftjs/codec';

/** The id of the script a page's recorded answers travel in. */
export const ANSWERS = 'aweft-answers';

/** A refusal in the form an ask over the socket gets it: reason, message, and the gate's reasons if any. */
export interface Refused {
	readonly reason: string;
	readonly message: string;
	readonly reasons?: readonly { readonly code: string; readonly message: string }[];
}

/** One recorded answer: the result, or the refusal the ask was answered with. */
export type Recorded = { readonly result: unknown } | { readonly error: Refused };

// Sorted, because two ends that build one object can still put its keys in different orders
// (design 302), and the key is only worth anything if both ends spell it the same.
const sorted = (value: unknown): unknown => {
	if (Array.isArray(value)) return value.map(sorted);
	if (value === null || typeof value !== 'object') return value;
	const out: Record<string, unknown> = {};
	for (const key of Object.keys(value).sort()) out[key] = sorted((value as Record<string, unknown>)[key]);
	return out;
};

/**
 * The key an ask is recorded and found under: the name, and the arguments as JSON with every
 * object's keys sorted.
 *
 * Params:
 *   name: the module asked
 *   args: the arguments as they crossed, which is to say after a trip through JSON
 */
export const askKey = (name: string, args: unknown): string => `${name} ${JSON.stringify(sorted(args))}`;

/** The arguments as the far end would receive them: through JSON, with `undefined` read as `null`. */
export const throughJson = (value: unknown): unknown => {
	const text = JSON.stringify(value === undefined ? null : value);
	return text === undefined ? null : JSON.parse(text) as unknown;
};

/**
 * The error an ask rejects with for a recorded refusal. It carries what an ask over the socket
 * rejects with: the reason to check, the message the module wrote, and the gate's reasons.
 */
export const crossed = (reason: string, message: string, reasons?: Refused['reasons']): Error => {
	const error = Object.assign(codecError(reason, message,
		'Handle this reason where the ask was made, or fix the module that refused it.'), { message });
	return reasons === undefined || reasons.length === 0 ? error : Object.assign(error, { reasons });
};
