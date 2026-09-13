// The operator sweep over one package, on a copy of the repo (design 287).
//
// Usage: npm run sweep -- <package> [--only=<file>[,<file>]]
//
// Copies the repo into a scratch directory, flips one operator at a time in the package's
// sources, runs the package's own suite against each flip, restores the file, and prints every
// flip the suite let through. It runs on request and never in the gate: one flip is one run of
// the suite, and a large package has hundreds of sites.
//
// A survivor is either killed by a test or written down as equivalent with the reason, wherever
// the change that ran this is written up. A survivor nobody classified is a guard nobody tested.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { flipSite, sweepSites } from '../src/index.ts';

const root = join(import.meta.dirname, '..', '..', '..');
const name = process.argv.slice(2).find((argument) => !argument.startsWith('--'));
if (name === undefined || !existsSync(join(root, 'packages', name, 'src'))) {
	console.error('usage: npm run sweep -- <package> [--only=<file>[,<file>]]');
	process.exit(2);
}
// One file or a few, for a builder working through one file's survivors, or for a package
// whose whole sweep is longer than one sitting.
const only = process.argv.slice(2).find((argument) => argument.startsWith('--only='))?.slice('--only='.length).split(',');

const sources = readdirSync(join(root, 'packages', name, 'src'))
	.filter((file) => (file.endsWith('.ts') || file.endsWith('.tsx')) && file !== 'index.ts')
	.filter((file) => only === undefined || only.includes(file))
	.sort();
const tests = readdirSync(join(root, 'packages', name, 'tests'))
	.filter((file) => file.endsWith('.test.ts'))
	.map((file) => `packages/${name}/tests/${file}`);

// A copy, so a flip never touches the tree a person or a gate is reading. `cp -a` keeps the
// workspace symlinks relative, so the copy resolves `@aweftjs/*` to its own packages.
const scratch = mkdtempSync(join(tmpdir(), 'aweft-sweep-'));
const copy = join(scratch, 'repo');
const copied = spawnSync('cp', ['-a', root, copy], { stdio: 'inherit' });
if (copied.status !== 0) {
	console.error('could not copy the repo');
	process.exit(1);
}
rmSync(join(copy, '.git'), { recursive: true, force: true });
// Other checkouts kept under .claude are not the tree being swept, and each has its own
// node_modules.
rmSync(join(copy, '.claude'), { recursive: true, force: true });

// An interrupt would otherwise leave the whole copy behind in the temp directory.
const cleanUp = (): void => rmSync(scratch, { recursive: true, force: true });
process.on('SIGINT', () => { cleanUp(); process.exit(130); });
process.on('SIGTERM', () => { cleanUp(); process.exit(143); });

// Two test files at a time, not one per core: a sweep is hundreds of suite runs in the
// background of a working machine, and the runner's default would take every core for each.
const run = (): boolean => {
	const result = spawnSync(process.execPath, [
		'--conditions=aweft-source',
		'--import', '@aweftjs/build/loader',
		'--test',
		'--test-concurrency=2',
		'--test-timeout=30000',
		...tests,
	], { cwd: copy, stdio: 'ignore', timeout: 300_000 });
	return result.status === 0;
};

try {
	if (!run()) {
		console.error(`${name}: the suite is not green on the copy, so a flip cannot be judged`);
		process.exit(1);
	}

	let total = 0;
	const survivors: string[] = [];
	for (const file of sources) {
		const path = join(copy, 'packages', name, 'src', file);
		const original = readFileSync(path, 'utf8');
		const sites = sweepSites(original);
		console.error(`${file}: ${String(sites.length)} sites`);
		for (const site of sites) {
			total += 1;
			writeFileSync(path, flipSite(original, site));
			const survived = run();
			writeFileSync(path, original);
			if (!survived) continue;
			const line = original.split(String.fromCharCode(10))[site.line - 1]!.trim();
			// Line and column, because one line can carry the same operator twice.
			survivors.push(`packages/${name}/src/${file}:${String(site.line)}:${String(site.column + 1)}  ${site.from.trim()} -> ${site.to.trim()}  ${line}`);
		}
	}

	for (const survivor of survivors) console.log(survivor);
	console.log(`${name}: ${String(survivors.length)} of ${String(total)} flips survived the suite`);
} finally {
	cleanUp();
}
