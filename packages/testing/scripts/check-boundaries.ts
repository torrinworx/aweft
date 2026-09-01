// The tier rule, run over the imports that actually exist.
//
// `checkGraph` decides whether an edge is legal, and until this script existed it was only
// ever handed edge lists written by hand in its own tests. So the rule had tests, the policy
// said the machine enforced it on every push, and the real graph was never looked at. It held
// a violation the whole time.
//
// Runtime code is what ships, and that is what the tier rule governs. Tests, scripts and
// examples are excluded deliberately: a suite importing the harness creates no dependency in
// anything a user installs, and definition-of-done item 3 requires exactly that import. They
// are still reported, so an exclusion that starts hiding something is visible rather than
// silent.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { type PackageInfo, checkGraph } from '../src/boundaries.ts';

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

/** Every `@aweftjs/x` a file imports from, however the import statement is spelled. */
const importsOf = (path: string): string[] => {
	const text = readFileSync(path, 'utf8');
	const found = new Set<string>();

	// All three spellings. A bare `import '@aweftjs/x';` has no `from`, and missing it was
	// this script's own first bug: the red demonstration it was written for came back green.
	for (const m of text.matchAll(/from\s+'@aweftjs\/([a-z-]+)'/g)) found.add(m[1]!);
	for (const m of text.matchAll(/import\s*\(\s*'@aweftjs\/([a-z-]+)'\s*\)/g)) found.add(m[1]!);
	for (const m of text.matchAll(/import\s+'@aweftjs\/([a-z-]+)'/g)) found.add(m[1]!);

	return [...found];
};

const packages = readdirSync(join(root, 'packages'))
	.filter((name) => statSync(join(root, 'packages', name)).isDirectory());

const seen = new Set<string>();
const runtime: Array<readonly [string, string]> = [];
const outside: Array<readonly [string, string, string]> = [];

for (const name of packages) {
	for (const area of ['src', 'tests', 'scripts']) {
		const dir = join(root, 'packages', name, area);

		try {
			statSync(dir);
		} catch {
			continue;
		}

		for (const file of sources(dir)) {
			for (const to of importsOf(file)) {
				if (area === 'src') {
					if (seen.has(`${name} ${to}`)) continue;
					seen.add(`${name} ${to}`);
					runtime.push([name, to]);
				}
				else outside.push([name, to, file.slice(root.length + 1)]);
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
