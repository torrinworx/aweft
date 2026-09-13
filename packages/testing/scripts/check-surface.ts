// The generated public surface, compared with the committed one.
//
// `surface.txt` next to each package is the record of what that package hands out. It is
// generated, never hand-written, so the only way it changes is that the API changed, and the
// diff is the change. That makes the surface reviewable in the one place review is cheap: the
// commit. Regenerating without a decision behind it is the failure this is here to make loud,
// which is why the message says what to do rather than just what differs.

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { surfaceOf, surfaceProgram } from '../src/index.ts';

const root = join(import.meta.dirname, '..', '..', '..');
const write = process.argv.includes('--write');

const packages = readdirSync(join(root, 'packages'))
	.filter((name) => statSync(join(root, 'packages', name)).isDirectory())
	.filter((name) => existsSync(join(root, 'packages', name, 'src', 'index.ts')))
	.sort();

// Every entry the exports map names, the main one first. A subpath is as public as the main
// entry, so its surface is recorded too, each line prefixed with the subpath it belongs to.
//
// The surface is the source's, so an entry is read through its `aweft-source` condition. The
// other two conditions name compiled output that only a published package carries (design 256),
// and reading them here would make the check depend on a build having run.
const manifestOf = (name: string): { exports?: Record<string, string | Record<string, string>> } =>
	JSON.parse(readFileSync(join(root, 'packages', name, 'package.json'), 'utf8')) as { exports?: Record<string, string | Record<string, string>> };

const bySubpath = ([a]: readonly [string, unknown], [b]: readonly [string, unknown]): number =>
	(a === '.' ? -1 : b === '.' ? 1 : a < b ? -1 : 1);

/** A `.json` on the exports map is data with no surface of its own, listed by name (design 278). */
const isData = (entry: string | Record<string, string>): entry is string => typeof entry === 'string' && entry.endsWith('.json');

const entriesOf = (name: string): Array<readonly [string, string]> => {
	const exports = manifestOf(name).exports ?? { '.': './src/index.ts' };
	return Object.entries(exports)
		.filter(([, entry]) => !isData(entry))
		.sort(bySubpath)
		.map(([subpath, entry]) => {
			const file = typeof entry === 'string' ? entry : entry['aweft-source'];
			if (file === undefined) throw new Error(`${name}: ${subpath} names no aweft-source condition`);
			return [subpath, join(root, 'packages', name, file)] as const;
		});
};

/** The data entries as surface lines, after every entry with code in it. */
const dataLinesOf = (name: string): string[] =>
	Object.entries(manifestOf(name).exports ?? {})
		.filter(([, entry]) => isData(entry))
		.sort(bySubpath)
		.map(([subpath, entry]) => `${subpath} data ${entry as string}`);

// One program over every entry file. Six programs would reparse the shared lower packages six
// times, and the checker is the expensive part of both.
const program = surfaceProgram(
	packages.flatMap((name) => entriesOf(name).map(([, file]) => file)),
);

let changed = 0;
for (const name of packages) {
	const generated = [
		...entriesOf(name).flatMap(([subpath, file]) =>
			surfaceOf(file, program).map((line) => (subpath === '.' ? line : `${subpath} ${line}`))),
		...dataLinesOf(name),
	];
	const text = generated.join('\n') + '\n';
	const path = join(root, 'packages', name, 'surface.txt');

	if (write) {
		writeFileSync(path, text);
		continue;
	}

	const committed = existsSync(path) ? readFileSync(path, 'utf8').split('\n').slice(0, -1) : [];
	if (committed.join('\n') === generated.join('\n')) continue;

	changed += 1;
	console.error(`packages/${name}/surface.txt`);

	const before = new Set(committed);
	const after = new Set(generated);
	for (const line of committed) if (!after.has(line)) console.error(`  -${line}`);
	for (const line of generated) if (!before.has(line)) console.error(`  +${line}`);
}

if (changed > 0) {
	console.error(
		'\nsurface changed: regenerate with npm run surface, and write the design note '
		+ 'that describes the change',
	);
	process.exit(1);
}

console.log(
	write
		? `surface: wrote ${packages.length} surface.txt files`
		: `surface: ${packages.length} packages match their committed surface`,
);
