/// <reference path="./virtual.d.ts" />
// The generator behind the virtual modules (design 141). On its own subpath because it reads the
// filesystem, and the root entry has to load in a browser (design 140).
//
// Nothing here is imported by an application. `@aweftjs/build`'s plugin and loader call it while
// they resolve an `@aweftjs/icons/...` import, and what comes back is the source of a module
// nobody wrote. The grammar of those imports is here rather than in `build`, so the spelling of
// the standard selection is written down once.
//
// The set is resolved from the directory that asked for it rather than from this file, so the
// set an application installed is the set it gets, and this package can sit next to several of
// them without choosing.

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';

import { codecError } from '@aweftjs/codec';
import { standardIcons } from '@aweftjs/ui/icon-names';

import { type IconSet, packOf, pickIcon, selectionOf } from './set.ts';

/** The segment that asks for the standard names. No icon name can be it (design 142). */
const STANDARD = '+standard';

// What a set publishes, and what a set is named: lowercase letters and digits with single dashes
// between them. A request whose segments are not that is not a request at all, and answering one
// would resolve `@iconify-json/<segment>/icons.json` for a segment that is not a set name: `..`
// resolves to a file outside every set.
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const INSTALL = 'Install the icon set the message names, or hand a pack of your own to Icons.';

// Parsing a 588 KB set once per icon on a page that names ten of them is nine reads for nothing.
// Keyed by the resolved file, so two directories resolving to different copies stay apart.
const parsed = new Map<string, IconSet>();

const setOf = (set: string, from: string): IconSet => {
	const require = createRequire(pathToFileURL(join(from, 'anything.js')));
	let file: string;
	try {
		file = require.resolve(`@iconify-json/${set}/icons.json`);
	} catch {
		throw codecError(
			'set-not-installed',
			`the icon set "${set}" is not installed; run: npm install @iconify-json/${set}`,
			INSTALL,
		);
	}
	const held = parsed.get(file);
	if (held !== undefined) return held;
	const read = JSON.parse(readFileSync(file, 'utf8')) as IconSet;
	parsed.set(file, read);
	return read;
};

// `<` inside a string is legal JavaScript and ends a script when the module is inlined into a
// page. Every icon body is full of it.
const moduleOf = (value: unknown): string =>
	`export default ${JSON.stringify(value).split('<').join('\\u003c')};\n`;

/**
 * One icon, an alias followed once and the set's own box applied. A few hundred bytes: over
 * Lucide's 1,884 icons the median is 325 bytes and the largest is 978.
 */
const iconModule = (set: string, name: string, from: string): string => {
	const found = pickIcon(setOf(set, from), name);
	if (found === null) {
		throw codecError('icon-not-in-set', `the set "${set}" has no icon named "${name}"`,
			'Name an icon the set publishes, or install the set that has it.');
	}
	return moduleOf(found);
};

/**
 * The source of the module one `@aweftjs/icons` import names.
 *
 * Three requests are answered, and they are the three subpaths an application writes:
 *
 * | request | the module |
 * |---|---|
 * | `lucide` | the whole installed set as an `IconPack`, with its root size |
 * | `lucide/check` | one icon as `IconData`, an alias followed once, the set's box applied |
 * | `lucide/+standard` | the names in `ui`'s `standardIcons` that this set has, as an `IconPack` |
 *
 * A name the set lacks is left out of the standard selection rather than refused, because the
 * application answers it with a pack of its own in front.
 *
 * Params:
 *   request: what follows `@aweftjs/icons/` in the import
 *   from: the directory to resolve `@iconify-json/<set>` from, usually the directory of the file
 *         that wrote the import
 *
 * Returns: the module's source, `export default { ... }`, or null when the request is none of
 * the three, which leaves the import to ordinary module resolution. A set name and an icon name
 * are the sets' own grammar, lowercase letters and digits with single dashes between them, and
 * `+standard` is the one exception; anything else is not a request.
 *
 * Throws: a refusal with reason `set-not-installed` when `@iconify-json/<set>` does not resolve
 * from `from`, whose message carries the install command; `icon-not-in-set` when the set has no
 * icon under the name asked for.
 *
 * Example:
 *   const source = moduleFor('lucide/check', dirname(importer));
 */
export const moduleFor = (request: string, from: string): string | null => {
	const parts = request.split('/');
	const set = parts[0];
	if (set === undefined || !NAME.test(set)) return null;
	if (parts.length === 1) return moduleOf(packOf(setOf(set, from)));
	if (parts.length !== 2) return null;
	const name = parts[1]!;
	if (name === STANDARD) return moduleOf(selectionOf(setOf(set, from), standardIcons));
	if (!NAME.test(name)) return null;
	return iconModule(set, name, from);
};
