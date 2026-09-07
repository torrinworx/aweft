// Putting the files on disk.
//
// The one file in this package that touches the filesystem, so a client bundle that reaches for
// `@aweftjs/ssg/client` carries none of it.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve, sep } from 'node:path';

import { codecError } from '@aweftjs/codec';

/**
 * Write a set of files under one directory, making the directories they need.
 *
 * Params:
 *   out: the directory to write into. Made if it is not there
 *   files: the file paths, relative to `out`, each with its content, in the order to write them
 *
 * Returns: nothing. Every file is written, or the first failure is thrown.
 *
 * Throws: `not-a-path` for a path holding a `.` or a `..` segment, and `outside-out` for one that
 * climbs out of `out`. Both are what an act key answered a path operation rather than a name would
 * produce.
 *
 * Example:
 *   await writeFiles('dist', [['index.html', html]]);
 */
export const writeFiles = async (out: string, files: readonly (readonly [string, string])[]): Promise<void> => {
	const root = resolve(out);
	for (const [name, content] of files) {
		// A path that normalises to something else holds a `.` or a `..`, and one of those can land
		// inside `out` and still overwrite another page: `posts/../index.html` is the site root. So
		// the name has to already be the path, and the guard below then covers climbing out of it.
		if (normalize(name) !== name) {
			throw codecError('not-a-path', name,
				'Write each page at the path its URL names; a . or a .. in it names a place rather than a page.');
		}
		const path = join(root, name);
		if (path !== root && !path.startsWith(root + sep)) {
			throw codecError('outside-out', name,
				'Keep every page URL under the site root; a parameter that answers .. is not a page.');
		}
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, content, 'utf8');
	}
};
