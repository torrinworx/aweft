// What a catalogue example is (design 197): a module the page finds, not a page that lists it.
//
// A file under `examples/` exports `name` and `Example`, and `catalogue.tsx` collects every one of
// them with the bundler's glob. The id convention lives here too, so an example says which part it
// is naming and this file adds the mode.
//
// Every example imports `h` from `@aweftjs/ui`, whether or not it calls it: that import is what its
// JSX compiles to, and a file that binds no `h` of its own gets `dom`'s, which knows nothing about
// themes (design 147).

/** One example: whichever mode the pane above it is in. */
export type ExampleComponent = (props: { mode?: unknown }) => unknown;

/** What every file under `examples/` exports. */
export interface ExampleModule {
	/**
	 * The component's export name from `@aweftjs/ui`. It is the act's name, its URL and the id of
	 * the page the catalogue renders for it.
	 */
	readonly name: string;
	/**
	 * What the one-page catalogue grouped by. Nothing reads it since design 226 gave each component
	 * a page of its own and put the nav in alphabetical order; the files still declare it and the
	 * next pass through them takes it out.
	 */
	readonly order?: number;
	/** Every state, type and size of that one component. */
	readonly Example: ExampleComponent;
}

/**
 * The id maker for one pane.
 *
 * Params:
 *   mode: what the pane was given, `light` or `dark`
 *
 * Returns: a function turning a part's name into the id it gets on the page.
 *
 * Example:
 *   const at = ids(props.mode);
 *   at('button-quiet');  // 'button-quiet-light'
 */
export const ids = (mode: unknown): ((part: string) => string) => {
	const suffix = String(mode ?? 'light');
	return (part: string): string => `${part}-${suffix}`;
};
