// What a leaf is: any validator implementing the Standard Schema interface.
//
// This package describes the three observable kinds and nothing else, so the values inside
// them are described by something that already exists. Standard Schema is a published,
// vendor-neutral contract rather than a library, so writing the interface out here costs no
// dependency and works with any validator that implements it.

/** Where a validator found an issue, in whichever of the two spellings it uses. */
export type StandardPath = ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>;

/** One thing a validator found wrong. `message` is what a person reads. */
export interface StandardIssue {
	readonly message: string;
	readonly path?: StandardPath;
}

/** What a validator answers with: the value it accepted, or the issues that stopped it. */
export type StandardResult =
	| { readonly value: unknown }
	| { readonly issues: ReadonlyArray<StandardIssue> };

/**
 * A leaf of a shape: any validator implementing the Standard Schema interface.
 *
 * The whole contract is one property. An object carrying `~standard` with a `validate`
 * function is a leaf here, whoever wrote it, so the validator library an application already
 * uses describes the values and this package describes the structure around them.
 *
 * `validate` has to answer now. A validator that returns a promise cannot decide a commit,
 * because the commit closes before the promise settles, and `check` says so by name rather
 * than by accepting the change and refusing it later.
 *
 * Example:
 *   const nonEmpty: StandardSchema = {
 *     '~standard': {
 *       version: 1,
 *       vendor: 'my-app',
 *       validate: (value) => typeof value === 'string' && value.length > 0
 *         ? { value }
 *         : { issues: [{ message: 'expected some text' }] },
 *     },
 *   };
 */
export interface StandardSchema {
	readonly '~standard': {
		readonly version: 1;
		readonly vendor: string;
		validate(value: unknown): StandardResult | Promise<StandardResult>;
	};
}
