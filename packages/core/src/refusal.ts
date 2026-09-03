// What a refusal is, and the rules that produce one.
//
// This file is what the transaction reaches for when a commit closes (design 058), so it
// imports nothing that leads back to the transaction: the registry is here, and registering a
// rule against a live observable is `intercept.ts`'s job.

import type { Commit, Delta } from '@aweftjs/codec';

import type { Node } from './types.ts';

/**
 * One reason a commit was refused.
 *
 * `code` is the stable token to branch on and `message` is for a person. `path` names the
 * slot the reason is about, from the document root down, spelled the way the document spells
 * its own keys: an object key as itself, a map id in text form, an array position in hex.
 * Core never reads any of the three; it carries them so that a rule, a link and an
 * application all say refusal the same way.
 */
export interface Refusal {
	readonly code: string;
	readonly message: string;
	readonly path?: readonly string[];
}

/**
 * A rule that reads a closing commit and answers with the reasons to refuse it.
 *
 * An empty answer lets the commit close. Anything else rolls it back. The rule runs inside
 * the transaction, so it may read the document and may not write to it.
 */
export type Interceptor = (commit: Commit) => readonly Refusal[];

/**
 * What is thrown at whoever made a commit a rule refused.
 *
 * The commit is already rolled back when this arrives, and no watcher was told anything, so
 * catching it is a complete recovery: there is no half-applied state to repair.
 *
 * Example:
 *   try { doc.title = ''; } catch (error) {
 *     if (error instanceof RefusedError) show(error.refusals[0]!.message);
 *   }
 */
export class RefusedError extends Error {
	readonly refusals: readonly Refusal[];

	constructor(refusals: readonly Refusal[]) {
		super(`refused: ${refusals.map((r) => r.message).join('; ')}`);
		this.name = 'RefusedError';
		this.refusals = refusals;
	}
}

/** One registered rule: the node it was registered on, and the function. */
export interface Rule {
	readonly node: Node;
	readonly fn: Interceptor;
}

/** Rules by the document they are on, so a rule on one document costs every other nothing. */
const rules = new Map<Node, Set<Rule>>();

/** Put a rule in the registry. Returns the function that takes it out. */
export const register = (rule: Rule): (() => void) => {
	const root = rule.node.root;
	let held = rules.get(root);
	if (held === undefined) rules.set(root, (held = new Set()));
	held.add(rule);
	return () => {
		const set = rules.get(root);
		if (set === undefined) return;
		set.delete(rule);
		if (set.size === 0) rules.delete(root);
	};
};
const NONE: readonly Refusal[] = [];

/** Whether any rule exists anywhere, so a commit on a document nobody watches or guards costs nothing. */
export const hasInterceptors = (): boolean => rules.size > 0;

/** Whether this document has a rule, so a rule on one document costs every other nothing. */
export const hasRulesFor = (root: Node): boolean => rules.has(root);

/**
 * Every refusal the rules on one document have for this commit, in the order they were
 * registered. All of them run: a caller that fixes only the first reason and retries would
 * otherwise learn its problems one commit at a time.
 */
export const refusalsFor = (root: Node, deltas: readonly Delta[]): readonly Refusal[] => {
	let out: Refusal[] | undefined;
	const commit: Commit = { deltas };

	const held = rules.get(root);
	if (held === undefined) return NONE;

	// A rule is user code and may register or remove rules while it runs. Walk a copy, so this
	// commit is judged by the rules that stood when it closed: one added now waits for the
	// next commit, one removed now still had its say. Never call user code mid-walk of a
	// structure that code can mutate.
	for (const rule of [...held]) {
		const found = rule.fn(commit);
		if (found.length === 0) continue;
		if (out === undefined) out = [...found];
		else out.push(...found);
	}

	return out ?? NONE;
};
