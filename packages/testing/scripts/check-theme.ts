// The theme contract, run over this library's own components, plus the snapshot of every name.
//
// What counts as a theme definition, and therefore where a literal is allowed, is written out at
// the top of `../src/theme.ts` and in decision design 119. In one sentence: a value may be a
// literal where it is given a `$name`, and nowhere else.
//
// Run it over other code with paths. Each path is resolved against the repository root, so a
// relative one is read from there and an absolute one is taken as it is:
//
//   node packages/testing/scripts/check-theme.ts packages/ui/src
//   node packages/testing/scripts/check-theme.ts /home/me/app/src
//
// A path that holds no `.ts` or `.tsx` file fails. Scanning nothing used to print that every
// value was named, which is the answer a typo gets and it is the wrong one.
//
// With paths, only the scan runs. With none, it scans `packages/ui/src` and `recipes/` and
// compares `packages/ui/tokens.txt` with what the source defines; `--write` rewrites that file.

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { type ThemeViolation, checkTheme, themeTokens } from '../src/index.ts';

const root = join(import.meta.dirname, '..', '..', '..');
const write = process.argv.includes('--write');
const given = process.argv.slice(2).filter((argument) => !argument.startsWith('--'));

const sourcesUnder = (dir: string): string[] => {
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return entry.name === 'node_modules' || entry.name === 'dist' ? [] : sourcesUnder(path);
		return entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') ? [path] : [];
	}).sort();
};

// A file outside the repository is reported by its own path. `relative` would answer a row of
// `..` segments, which nobody can paste back into anything.
const label = (path: string): string => {
	const inside = relative(root, path);
	return inside.startsWith('..') ? path : inside;
};

const read = (paths: readonly string[]) =>
	paths.map((path) => ({ path: label(path), text: readFileSync(path, 'utf8') }));

// One line per violation. This is the console format of one script rather than a capability a
// caller of `@aweftjs/testing` reaches for, so it lives here.
const lines = (violations: readonly ThemeViolation[]): string[] =>
	violations.map((found) => `${found.path}:${String(found.line)}: ${found.where} sets ${found.property} `
		+ `to ${found.literal}; use ${found.fix}`);

const givenSources = (path: string): string[] => {
	const from = resolve(root, path);
	const found = sourcesUnder(from);
	if (found.length === 0) {
		console.error(`theme: no .ts or .tsx file under ${from}`);
		process.exit(1);
	}
	return found;
};

const uiSources = join(root, 'packages', 'ui', 'src');
const scanned = given.length > 0
	? given.flatMap(givenSources)
	: [...sourcesUnder(uiSources), ...sourcesUnder(join(root, 'recipes'))];

const violations = checkTheme(read(scanned));
if (violations.length > 0) {
	for (const line of lines(violations)) console.error(line);
	console.error(`\n${violations.length} value(s) written where they stand. Give each one a name, `
		+ 'or use the one the line suggests.');
	process.exit(1);
}

if (given.length > 0) {
	console.log(`theme: ${scanned.length} files, every value named`);
	process.exit(0);
}

const tokens = themeTokens(read(sourcesUnder(uiSources)));
const path = join(root, 'packages', 'ui', 'tokens.txt');
const text = tokens.join('\n') + '\n';

if (write) {
	writeFileSync(path, text);
	console.log(`theme: wrote ${tokens.length} names to packages/ui/tokens.txt`);
	process.exit(0);
}

const committed = existsSync(path) ? readFileSync(path, 'utf8').split('\n').slice(0, -1) : [];
if (committed.join('\n') !== tokens.join('\n')) {
	console.error('packages/ui/tokens.txt');
	const before = new Set(committed);
	const after = new Set(tokens);
	for (const line of committed) if (!after.has(line)) console.error(`  -${line}`);
	for (const line of tokens) if (!before.has(line)) console.error(`  +${line}`);
	console.error('\nthe named values changed: regenerate with npm run theme, and write the '
		+ 'design note that describes the change');
	process.exit(1);
}

console.log(`theme: ${scanned.length} files, every value named; ${tokens.length} names match tokens.txt`);
