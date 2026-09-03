// Refusing a commit before anyone hears about it.
//
// Every commit closes in one place, whatever made it, so one seam covers an assignment, a
// block and an applied commit alike (design 058). A rule registered here reads the whole
// commit after its deltas have been applied inside the transaction and before any watcher is
// called, which is why it can read the document the commit would leave. Refusing takes the
// path a throwing block already takes: the tree rolls back and nothing is delivered.

import { codecError } from '@aweftjs/codec';

import { type Interceptor, register } from './refusal.ts';
import { nodeOf } from './value.ts';

/**
 * Let a rule refuse commits on a document.
 *
 * Params:
 *   document: any observable in the document. The rule covers the whole document it belongs
 *             to, not the subtree under the observable named here
 *   fn: the rule. It is handed the commit about to close, after every delta has been applied
 *       and before anything has been delivered, and answers with the reasons to refuse it.
 *       An empty answer lets the commit close
 *
 * Returns: the function that removes the rule.
 *
 * Every way of making a commit closes through one transaction, so an assignment, an `atomic`
 * block and a commit landed with `apply` are all read by the same rule, and a block is read
 * once with everything it wrote. Refusing rolls the whole commit back, tells no watcher, and
 * throws a `RefusedError` at whoever made it.
 *
 * The rule may read the document, which reads as the commit would leave it, and may not
 * write to it: a write from inside a rule throws `sealed`, because it would be a change to
 * the commit being decided. Several rules on one document all run and their refusals are
 * concatenated.
 *
 * Example:
 *   const stop = intercept(doc, (commit) =>
 *     doc.title === '' ? [{ code: 'invalid', message: 'a title cannot be empty' }] : []);
 */
export const intercept = (document: unknown, fn: Interceptor): (() => void) => {
	const node = nodeOf(document);
	if (node === undefined) throw codecError('not-observable', 'intercept takes an observable');

	return register({ node, fn });
};
