// The tier rule, run over the imports that actually exist.
//
// `checkGraph` decides whether an edge is legal; `moduleSpecifiers` finds the edges by
// parsing each file the way the compiler does, so every literal spelling of an import is
// seen and a specifier in a comment or a string is not. What no scanner can see is a
// specifier that is not written as a literal, and evading the rule that way is deliberate,
// which review catches.
//
// Runtime code is what ships, and that is what the tier rule governs. `tests` and `scripts`
// are excluded deliberately: a suite importing the harness creates no dependency in anything
// a user installs, and definition-of-done item 3 requires exactly that import. They are
// still reported, so an exclusion that starts hiding something is visible rather than
// silent. Any other directory inside a package is treated as runtime: code that is neither
// tests nor scripts is presumed shipped until someone says otherwise.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { type PackageInfo, aweftPackageOf, checkGraph, moduleSpecifiers } from '../src/index.ts';

const root = join(import.meta.dirname, '..', '..', '..');
const table = JSON.parse(readFileSync(join(root, 'boundaries.json'), 'utf8'))
	.packages as Record<string, PackageInfo>;

const sources = (dir: string): string[] => {
	let found: string[] = [];

	for (const entry of readdirSync(dir)) {
		if (entry === 'node_modules') continue;
		const path = join(dir, entry);

		if (statSync(path).isDirectory()) found = found.concat(sources(path));
		else if (entry.endsWith('.ts')) found.push(path);
	}
	return found;
};

const packages = readdirSync(join(root, 'packages'))
	.filter((name) => statSync(join(root, 'packages', name)).isDirectory());

const seen = new Set<string>();
const runtime: Array<readonly [string, string]> = [];
const outside: Array<readonly [string, string, string]> = [];

for (const name of packages) {
	const home = join(root, 'packages', name);

	for (const file of sources(home)) {
		const relative = file.slice(home.length + 1);
		const area = relative.split('/', 1)[0]!;
		const exempt = area === 'tests' || area === 'scripts';

		for (const specifier of moduleSpecifiers(readFileSync(file, 'utf8'), file)) {
			const to = aweftPackageOf(specifier);
			if (to === undefined) continue;

			if (!exempt) {
				if (seen.has(`${name} ${to}`)) continue;
				seen.add(`${name} ${to}`);
				runtime.push([name, to]);
			} else {
				outside.push([name, to, file.slice(root.length + 1)]);
			}
		}
	}
}

// A package in the table that has no directory is a package not built yet, which is fine. A
// directory with no table entry is not: checkEdge reports it as unknown-package, and this
// catches the case where nothing imports it so no edge exists to report.
const unregistered = packages.filter((name) => table[name] === undefined);

const violations = checkGraph(runtime, table);

for (const [from, to, file] of outside) {
	console.log(`  outside the runtime graph: ${from} -> ${to} (${file})`);
}

if (unregistered.length > 0) {
	for (const name of unregistered) {
		console.error(`packages/${name} is not in boundaries.json`);
	}
}

if (violations.length > 0) {
	for (const v of violations) console.error(`${v.from} -> ${v.to}  ${v.rule}: ${v.detail}`);
}

if (violations.length > 0 || unregistered.length > 0) {
	console.error(
		`\n${violations.length} boundary violation(s) across ${runtime.length} runtime edges.`,
	);
	process.exit(1);
}

console.log(
	`boundaries: ${runtime.length} runtime edges legal across ${packages.length} packages, `
	+ `${outside.length} edges outside the runtime graph`,
);
