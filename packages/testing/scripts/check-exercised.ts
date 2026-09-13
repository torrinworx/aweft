// Every value export and every refusal reason, named by the owning package's own suite.
//
// `surface.txt` and `errors.txt` are generated and therefore true, and coverage says a line
// ran. Neither says a test reached the export or asked for the refusal (design 285). This reads
// the two files and the package's tests and fails on a name the suite never uses.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { checkExercised } from '../src/index.ts';

const root = join(import.meta.dirname, '..', '..', '..');

// A package joins once its suite names everything, and never leaves. The rest are printed so
// the gap stays visible. `testing` is exempt for good: its surface is the suites of the other
// packages and the scripts here, so a test naming each export would be padding.
const COVERED = new Set(['codec', 'core', 'schema', 'sync', 'store']);
const EXEMPT = new Set(['testing']);

const packages = readdirSync(join(root, 'packages'))
	.filter((name) => statSync(join(root, 'packages', name)).isDirectory())
	.filter((name) => existsSync(join(root, 'packages', name, 'surface.txt')))
	.sort();

const read = (path: string): string => (existsSync(path) ? readFileSync(path, 'utf8') : '');

let failed = 0;
const pending: string[] = [];
for (const name of packages) {
	if (EXEMPT.has(name)) continue;
	const dir = join(root, 'packages', name);
	const testsDir = join(dir, 'tests');
	const tests = existsSync(testsDir)
		? readdirSync(testsDir)
			.filter((file) => statSync(join(testsDir, file)).isFile())
			.map((file) => ({ path: `packages/${name}/tests/${file}`, text: read(join(testsDir, file)) }))
		: [];
	const surface = read(join(dir, 'surface.txt'));
	const misses = checkExercised(name, surface, read(join(dir, 'errors.txt')), tests);
	// A surface that parses to nothing is a format drift, not a suite that names everything.
	if (COVERED.has(name) && !/^(?:\S+ )?value /m.test(surface)) {
		console.error(`${name}: surface.txt lists no value export in the form the check reads`);
		failed += 1;
		continue;
	}
	if (misses.length === 0) continue;
	if (!COVERED.has(name)) {
		pending.push(`${name}: ${String(misses.length)} not yet named`);
		continue;
	}
	failed += misses.length;
	for (const miss of misses) console.error(miss);
}

if (failed > 0) {
	console.error('');
	console.error(`${String(failed)} name(s) a covered package exports or refuses with that its own suite never uses.`);
	console.error('Write the test that reaches each one; a mention in a comment does not count.');
	process.exit(1);
}

console.log(`exercised: ${String(COVERED.size)} packages name every export and every refusal`);
for (const line of pending) console.log(`  pending ${line}`);
