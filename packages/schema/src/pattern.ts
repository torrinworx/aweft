// The pattern language a policy is written in (design 032).
//
// A pattern is an array of steps matched against the attach path a delta lands on. Matching
// is one left-to-right scan: `REST` is only ever the last step, so there is nothing to
// backtrack over and a pattern costs its own length and no more.

import { codecError } from '@aweftjs/codec';

/**
 * A step matching any one path step.
 *
 * Example:
 *   const rule = { effect: 'allow', path: ['posts', ANY, 'title'] };  // every post's title
 */
export const ANY = { any: true } as const;

/**
 * A step matching every remaining path step, including none.
 *
 * Only ever the last step of a pattern: a pattern with `REST` anywhere else throws
 * `bad-pattern` the first time the policy is used.
 *
 * Example:
 *   const rule = { effect: 'allow', path: ['drafts', REST] };  // drafts, and everything in them
 */
export const REST = { rest: true } as const;

/**
 * A step matching one path step equal to the acting actor's id.
 *
 * The comparison is against `actor.id` exactly as written, so it is whatever the document
 * names the actor by: the text form of an id for a map slot, or the key itself for an object
 * slot.
 *
 * Example:
 *   const rule = { effect: 'allow', path: ['users', SELF, REST] };  // an actor's own record
 */
export const SELF = { self: true } as const;

/** One step of a pattern: a literal path step, or one of the three wildcards. */
export type PatternStep = string | typeof ANY | typeof REST | typeof SELF;

/** What a rule matches: a sequence of steps against the path a delta lands on. */
export type Pattern = readonly PatternStep[];

const isRest = (step: PatternStep): step is typeof REST =>
	typeof step === 'object' && 'rest' in step;

/**
 * Refuse a pattern that cannot mean what it looks like.
 *
 * Checked once per policy rather than per delta, and eagerly rather than when a path happens
 * to reach the bad step, because a pattern whose defect only shows on some inputs is a policy
 * that reads as protection until the day it does not.
 */
export const checkPattern = (pattern: Pattern): void => {
	for (let i = 0; i < pattern.length; i++) {
		const step = pattern[i]!;

		if (typeof step === 'string') continue;
		if (typeof step !== 'object' || step === null) {
			throw codecError('bad-pattern', `step ${i} is ${typeof step}, not a step`);
		}
		if (isRest(step)) {
			if (i !== pattern.length - 1) {
				throw codecError('bad-pattern', `REST is step ${i} of ${pattern.length} and is only ever the last`);
			}
			continue;
		}
		if (!('any' in step) && !('self' in step)) {
			throw codecError('bad-pattern', `step ${i} is an object that is not ANY, REST or SELF`);
		}
	}
};

/**
 * Does this pattern match this path?
 *
 * Params:
 *   pattern: the rule's steps, already checked by checkPattern
 *   path: the attach path a delta lands on, root first
 *   self: the acting actor's id, which is what SELF compares against
 *
 * Returns: true when every step matches. Without a trailing REST the lengths must be equal,
 * so `['a', 'b']` matches that slot and nothing under it.
 *
 * Example:
 *   matches(['users', SELF, REST], ['users', 'me', 'name'], 'me');  // true
 */
export const matches = (pattern: Pattern, path: readonly string[], self: string): boolean => {
	for (let i = 0; i < pattern.length; i++) {
		const step = pattern[i]!;
		if (typeof step === 'object' && 'rest' in step) return true;
		if (i >= path.length) return false;

		const at = path[i]!;
		if (typeof step === 'string') {
			if (step !== at) return false;
		} else if ('self' in step) {
			if (at !== self) return false;
		}
	}

	return pattern.length === path.length;
};
