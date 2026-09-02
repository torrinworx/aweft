// Deciding a whole commit: may this actor make this change (designs 032, 033, 035).
//
// Authority and reachability, and nothing else. A commit that is authorized can still be
// refused by the applier, because the applier holds the slot values this never sees.

import {
	type Commit, type Delta, type DeltaType, codecError, idToText, isReference,
} from '@aweftjs/codec';

import { type DocumentIndex, enclosesItself, overlayOf, resolve, stepOf } from './document.ts';
import { type Pattern, checkPattern, matches } from './pattern.ts';

/**
 * Who is making the change.
 *
 * `id` is compared against a path step exactly as written, so it is whatever the document
 * names this actor by. `roles` selects which rules apply; an actor with none is subject only
 * to the rules that name no role.
 */
export interface Actor {
	readonly id: string;
	readonly roles?: readonly string[];
}

/**
 * One rule of a policy.
 *
 * `effect` is required and there is no default: a rule that reads as protection and delivers
 * none is the failure this field exists to prevent (design 033). A deny beats every allow
 * whatever order the rules are in.
 */
export interface Rule {
	readonly effect: 'allow' | 'deny';
	/** The paths this rule is about. */
	readonly path: Pattern;
	/** Only actors holding one of these roles. Omitted means every actor. */
	readonly roles?: readonly string[];
	/** Only these delta types. Omitted means all three. */
	readonly types?: readonly DeltaType[];
}

/**
 * The whole authority for a document.
 *
 * An empty policy authorizes nothing. Allowing everything is one rule and has to be written:
 * `[{ effect: 'allow', path: [REST] }]`.
 */
export type Policy = readonly Rule[];

/** Why one delta was refused. The code is the contract; the message is for a person. */
export interface Reason {
	readonly code: 'unauthorized' | 'unreachable' | 'multiple-attach';
	readonly delta: Delta;
	/** Where the delta lands, when that could be decided. Absent when it could not. */
	readonly path?: readonly string[];
	readonly message: string;
}

/**
 * What a policy says about one commit.
 *
 * A commit is authorized whole or refused whole, because a commit applies whole or not at all
 * (`spec/format.md` 3.1). A refusal carries one reason per offending delta, so a developer
 * reading it sees every path their policy did not cover rather than the first.
 */
export type Verdict =
	| { readonly ok: true }
	| { readonly ok: false; readonly reasons: readonly Reason[] };

/** Everything a decision is made against, other than the commit itself. */
export interface Context {
	readonly index: DocumentIndex;
	readonly policy: Policy;
	readonly actor: Actor;
}

const TYPES: readonly DeltaType[] = ['add', 'replace', 'remove'];

/**
 * Refuse a policy that cannot mean what it says.
 *
 * Params:
 *   policy: the rules to check
 *
 * Throws `bad-rule` for an effect or a delta type that is not one, and `bad-pattern` for a
 * pattern that is malformed, naming the step. Returns nothing when the policy is well formed.
 *
 * `validate` calls this itself on every commit, so a rule appended to a policy after it was
 * first used is checked like any other. This exists for the caller who would rather find out
 * at boot than at the first commit that arrives.
 *
 * Example:
 *   checkPolicy(policy);  // before the server starts listening
 */
export const checkPolicy = (policy: Policy): void => {
	for (const rule of policy) {
		if (rule.effect !== 'allow' && rule.effect !== 'deny') {
			throw codecError('bad-rule', `${String(rule.effect)} is not an effect`);
		}
		if (rule.types !== undefined) {
			for (const type of rule.types) {
				if (!TYPES.includes(type)) throw codecError('bad-rule', `${String(type)} is not a delta type`);
			}
		}
		checkPattern(rule.path);
	}
};

const applies = (rule: Rule, actor: Actor, type: DeltaType): boolean => {
	if (rule.types !== undefined && !rule.types.includes(type)) return false;
	if (rule.roles === undefined) return true;

	const held = actor.roles;
	if (held === undefined) return false;
	return rule.roles.some((role) => held.includes(role));
};

/**
 * Does the policy allow this actor this change to this path?
 *
 * One pass, because a deny wins outright: an allow found earlier cannot survive a deny found
 * later, and a deny found earlier cannot be undone by an allow found later.
 */
const decide = (
	policy: Policy,
	actor: Actor,
	path: readonly string[],
	type: DeltaType,
): boolean => {
	let allowed = false;

	for (const rule of policy) {
		if (!applies(rule, actor, type)) continue;
		if (!matches(rule.path, path, actor.id)) continue;
		if (rule.effect === 'deny') return false;
		allowed = true;
	}

	return allowed;
};

/**
 * Decide a whole commit against a policy.
 *
 * Params:
 *   commit: the commit to judge, its deltas in any order
 *   context: the document's index, the policy, and the actor making the change
 *
 * Returns: `{ ok: true }`, or `{ ok: false, reasons }` naming every delta that was refused
 * and why. Three causes and no others: `unauthorized` when the policy does not allow a
 * delta's path or denies it, `unreachable` when a delta's target has no attach path from the
 * root, and `multiple-attach` when a delta would leave an observable in two places at once so
 * that no single path decides its authority.
 *
 * Reachability counts the commit's own attachments, so a whole new subtree arriving in one
 * commit is judged at the paths that commit gives it, and its own detachments, so an
 * observable a commit takes out of the document cannot be written to in the same breath.
 *
 * What this does not decide is whether the commit can be applied: a slot that is occupied, a
 * slot that is empty, an observable called two kinds. Those need the document's values, which
 * an authority index deliberately does not hold, so an authorized commit still goes through
 * the applier and a refusal from either refuses the commit (design 035).
 *
 * Throws `bad-pattern` or `bad-rule` for a policy that cannot mean what it says.
 *
 * Example:
 *   const verdict = validate(commit, { index, policy, actor });
 *   if (verdict.ok) { apply(doc, commit); record(index, commit); }
 *   else report(verdict.reasons);
 */
export const validate = (commit: Commit, context: Context): Verdict => {
	const { index, policy, actor } = context;
	checkPolicy(policy);

	const overlay = overlayOf(index, commit);

	// Staged the way the applier stages its own checks: every attachment first, then every
	// path. A commit that breaks both rules has one reason, and it is the same reason on both
	// sides, which is what design 035 promises and design 037 made checkable.
	if (overlay.ambiguous.size > 0) {
		const reasons: Reason[] = [];

		for (const delta of commit.deltas) {
			const holder = idToText(delta.id);
			const value = delta.value;
			const target = value !== undefined && isReference(value) ? idToText(value.id) : undefined;

			if (!overlay.ambiguous.has(holder) && (target === undefined || !overlay.ambiguous.has(target))) {
				continue;
			}
			reasons.push({
				code: 'multiple-attach',
				delta,
				message: `${overlay.ambiguous.has(holder) ? holder : target!} would be in two places at once, `
					+ 'so no path decides who may write it',
			});
		}

		return { ok: false, reasons };
	}

	const reasons: Reason[] = [];
	const known = new Map<string, readonly string[] | 'unreachable' | 'multiple-attach'>();

	const at = (key: string): readonly string[] | 'unreachable' | 'multiple-attach' => {
		const settled = known.get(key);
		if (settled !== undefined) return settled;

		const found = resolve(index, overlay, key);
		known.set(key, found);
		return found;
	};

	for (const delta of commit.deltas) {
		const holder = idToText(delta.id);
		const found = at(holder);

		if (found === 'unreachable' || found === 'multiple-attach') {
			reasons.push({
				code: 'unreachable',
				delta,
				message: `${holder} has no attach path from the root`,
			});
			continue;
		}

		// An edge that puts an observable inside its own subtree closes a ring, and a ring has
		// no top, so the applier refuses it as unreachable and so does this. Checked here, after
		// the holder's own path, because that is the order the applier checks them in.
		const value = delta.value;
		if (value !== undefined && isReference(value) && value.edge === 'attach'
			&& enclosesItself(index, overlay, idToText(value.id), holder)) {
			reasons.push({
				code: 'unreachable',
				delta,
				message: `${idToText(value.id)} cannot be attached inside itself`,
			});
			continue;
		}

		const path = [...found, stepOf(delta.ref)];
		if (!decide(policy, actor, path, delta.type)) {
			reasons.push({
				code: 'unauthorized',
				delta,
				path,
				message: `${actor.id} may not ${delta.type} ${path.join('/')}`,
			});
		}
	}

	return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
};
