// A literal icon name on `Icon` becomes an import of that one icon (design 141).
//
// `<Icon name="lucide:check" />` names an icon the page knows at build time, so the drawing can
// come with the page instead of being looked up when it runs. The import it becomes is a module
// nobody wrote: `@aweftjs/icons` generates it, through the two hooks in `plugin.ts` and
// `loader.ts`.
//
// This is the only place `build` knows the name of a component. It knows two specifiers already
// (design 108); this adds one export name to the second, not a vocabulary.

/** The package that answers the generated imports. */
export const ICONS = '@aweftjs/icons';

// What a set publishes: lowercase letters, digits, and dashes between them, on both halves of
// `set:name`. Anything else is left where it is and looked up at run time, because a name this
// does not recognise is a name that would not resolve.
const PREFIXED = /^([a-z0-9]+(?:-[a-z0-9]+)*):([a-z0-9]+(?:-[a-z0-9]+)*)$/;

export interface IconImports {
	/**
	 * The identifier standing for one `set:name`, or null when the value is not one. The first
	 * ask mints the import; the same name asked for twice gives the same identifier.
	 */
	take(value: string): string | null;
	/** The import declarations to put at the top of the file, in the order they were minted. */
	readonly declarations: readonly string[];
}

/**
 * Collect the icon imports one file needs.
 *
 * Params:
 *   prefix: the base for each generated name, already free of everything the file mentions
 *
 * Returns: the collector. Read `declarations` after every element has been read.
 *
 * Example:
 *   const icons = createIconImports(freshPrefix('_icon', bindings.names));
 *   const bound = icons.take('lucide:check');
 */
export const createIconImports = (prefix: string): IconImports => {
	const declarations: string[] = [];
	const taken = new Map<string, string>();

	const take = (value: string): string | null => {
		const held = taken.get(value);
		if (held !== undefined) return held;

		const parts = PREFIXED.exec(value);
		if (parts === null) return null;

		const name = `${prefix}${declarations.length}`;
		taken.set(value, name);
		declarations.push(`import ${name} from '${ICONS}/${parts[1]!}/${parts[2]!}';`);
		return name;
	};

	return { take, declarations };
};

/**
 * What follows `@aweftjs/icons/` in an import the generated modules answer, or null.
 *
 * Params:
 *   specifier: the import as it was written
 *
 * Returns: the request `@aweftjs/icons/node` takes, or null for anything else, which includes
 * the package's own two entries: `@aweftjs/icons` is a file, and so is `@aweftjs/icons/node`.
 *
 * Example:
 *   iconRequest('@aweftjs/icons/lucide/check'); // 'lucide/check'
 */
export const iconRequest = (specifier: string): string | null => {
	if (!specifier.startsWith(`${ICONS}/`)) return null;
	const rest = specifier.slice(ICONS.length + 1);
	if (rest === '' || rest === 'node' || rest.startsWith('node/')) return null;
	return rest;
};

/** The directory a file is in, from a path a bundler wrote, either separator. */
export const directoryOf = (file: string): string => {
	const at = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'));
	return at < 0 ? '.' : file.slice(0, at);
};
