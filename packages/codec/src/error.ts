// Refusals: the one error shape every package throws.
//
// A refusal names the rule it refuses for, as a stable token a caller can branch on, says what
// it actually saw, and says what to do instead. The message is for a person; the reason is the
// contract; the fix is what a reader does next (design 101).

/**
 * An error carrying a stable machine-readable reason and the remedy for it.
 *
 * The reason is part of the format's contract: `spec/fixtures/invalid/` names one per case,
 * so a conforming implementation must reject the same input for the same stated cause, not
 * merely reject it somehow.
 */
export interface CodecError extends Error {
	readonly reason: string;
	readonly fix: string;
}

/**
 * Build a refusal that names the rule it is refusing for, and what to do about it.
 *
 * Params:
 *   reason: the stable machine-readable cause, as `spec/fixtures/invalid/` states it
 *   detail: what was actually seen, for a human reading the message
 *   fix: one sentence saying what to do instead, in the imperative
 *
 * Returns: an Error whose `message` is `reason: detail. fix`, whose `reason` is the reason
 * alone, and whose `fix` is the remedy alone. Callers branch on `reason` and never on the
 * message.
 *
 * The fix is required. An error that says only what went wrong leaves its reader to infer the
 * remedy, and the reader is often an agent with no other documentation in front of it.
 * `npm run errors` refuses a refusal whose fix is empty.
 *
 * Example:
 *   throw codecError('invalid-id', `${id.length} bytes is not an id`, 'Mint ids with createId.');
 */
export const codecError = (reason: string, detail: string, fix: string): CodecError =>
	Object.assign(new Error(`${reason}: ${detail}. ${fix}`), { reason, fix });
