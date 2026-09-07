// What a stage puts in the render's registry (design 126).
//
// Types only, in a file of their own, so `render.ts` can name the registry's contents without
// importing the components and the two files do not depend on each other.

/**
 * The parameter sets an act should be rendered at.
 *
 * Declared on an act, and read by a static walk. Nothing in this package calls it.
 */
export type ActEntries = () => Promise<readonly Readonly<Record<string, string>>[]>;

/** One declared act, as the registry reports it. */
export interface StageAct {
	/** The key it was declared under. */
	readonly name: string;
	/** Whether it arrives through a loader rather than being the component itself. */
	readonly loader: boolean;
	/** Its own parameter source, or null. */
	readonly entries: ActEntries | null;
}

/**
 * One live `StageContext`, read-only, so a static walk can enumerate the pages of a site from one
 * render of it.
 */
export interface StageEntry {
	/**
	 * The declared acts, in the order the `acts` object lists them, which is that object's own
	 * order: a whole-number name such as `404` comes before every other name, wherever it was
	 * written. Each row carries the act's own `entries`.
	 */
	readonly acts: readonly StageAct[];
	/** The path this stage's act keys are relative to: what its parent matched, not the pattern. */
	readonly prefix: string;
	/** The stage above, or null at the root. */
	readonly parent: StageEntry | null;
}
