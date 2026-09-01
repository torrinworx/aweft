// Refusals: the one error shape every package throws.
//
// A refusal names the rule it refuses for, as a stable token a caller can branch on. The
// message is for a person; the reason is the contract.

/**
 * An error carrying a stable machine-readable reason.
 *
 * The reason is part of the format's contract: `spec/fixtures/invalid/` names one per case,
 * so a conforming implementation must reject the same input for the same stated cause, not
 * merely reject it somehow.
 */
export interface CodecError extends Error {
	readonly reason: string;
}

/**
 * Build a refusal that names the rule it is refusing for.
 *
 * Params:
 *   reason: the stable machine-readable cause, as `spec/fixtures/invalid/` states it
 *   detail: what was actually seen, for a human reading the message
 *
 * Returns: an Error whose `message` is `reason: detail` and whose `reason` is the reason
 * alone. Callers branch on `reason` and never on the message.
 *
 * Example:
 *   throw codecError('invalid-id', `${id.length} bytes is not an id`);
 */
export const codecError = (reason: string, detail: string): CodecError =>
	Object.assign(new Error(`${reason}: ${detail}`), { reason });
