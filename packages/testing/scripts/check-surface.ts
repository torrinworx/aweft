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

// One program over every entry file. Six programs would reparse the shared lower packages six
// times, and the checker is the expensive part of both.
const program = surfaceProgram(
	packages.map((name) => join(root, 'packages', name, 'src', 'index.ts')),
);

let changed = 0;
for (const name of packages) {
	const generated = surfaceOf(join(root, 'packages', name, 'src', 'index.ts'), program);
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
