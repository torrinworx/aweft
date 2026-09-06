// The shape every reader in this package produces, and the one the renderer consumes.
//
// Data, never text: a reader says what it found, and `render` owns every word a person sees.
// That keeps one vocabulary across a document, a commit and a refusal rather than one per
// reader.

/** One labelled fact about a thing: the label a reader sees, and the value behind it. */
export type Fact = readonly [label: string, value: unknown];

/** A described thing. `kind` names what it is in the stack's own words. */
export interface Described {
	readonly kind: string;
	readonly id?: string;
	readonly facts: readonly Fact[];
	readonly children?: readonly Described[];
}
