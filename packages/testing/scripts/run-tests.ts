import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

/*
 * Runs every workspace's tests in its own coverage pass, scoped to that package's
 * sources, and fails below the branch threshold the package declares as
 * aweft.branchCoverage. One pass per package, because in a shared pass one
 * package's tests can pad another package's number.
 */

const root = new URL('../../../', import.meta.url);
const packagesDir = new URL('packages/', root);

// The policy's floors, restated here so a declared threshold cannot drift below them
// without this run going red. Raising a declaration above its floor is always allowed;
// lowering a floor is a policy change and happens in this file together with AGENTS.md.
const FLOORS: Record<string, number> = {
	core: 90, schema: 90, sync: 90, store: 90, modules: 90, sandbox: 90, dom: 90, codec: 90,
	ui: 80, icons: 80, server: 80, auth: 80, jobs: 80, ssg: 80, static: 80, health: 80, logs: 80, uploads: 80, build: 80, testing: 80,
};

let failed = false;
for (const name of readdirSync(packagesDir).sort()) {
	const pkgDir = new URL(`${name}/`, packagesDir);
	const manifestPath = new URL('package.json', pkgDir);
	if (!existsSync(manifestPath)) continue;

	const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
	const threshold = manifest.aweft?.branchCoverage;
	if (typeof threshold !== 'number') {
		console.error(`${name}: package.json declares no aweft.branchCoverage`);
		failed = true;
		continue;
	}

	const floor = FLOORS[name];
	if (floor !== undefined && threshold < floor) {
		console.error(`${name}: declares branch coverage ${threshold}, below the policy floor of ${floor}`);
		failed = true;
		continue;
	}

	const testsDir = new URL('tests/', pkgDir);
	const tests = existsSync(testsDir)
		? readdirSync(testsDir).filter(f => f.endsWith('.test.ts')).map(f => `packages/${name}/tests/${f}`)
		: [];
	if (tests.length === 0) {
		console.error(`${name}: no tests`);
		failed = true;
		continue;
	}

	const args = [
		// `ui`'s source is .tsx, which Node cannot load on its own. The loader is this stack's own
		// transform, so every gate run compiles the repo with its own compiler (design 110).
		'--import', '@aweftjs/build/loader',
		'--test',
		// A test that waits forever is a red test, not a stuck gate: without this cap a link
		// test that never gets its answer hangs the suite instead of failing it.
		'--test-timeout=120000',
		'--experimental-test-coverage',
		`--test-coverage-branches=${threshold}`,
		`--test-coverage-include=packages/${name}/src/**`,
	];
	if (existsSync(new URL('scripts/', pkgDir))) {
		args.push(`--test-coverage-include=packages/${name}/scripts/**`);
	}

	console.log(`\n${name}: branch threshold ${threshold}`);
	const run = spawnSync(process.execPath, [...args, ...tests], { cwd: root, stdio: 'inherit' });
	if (run.status !== 0) failed = true;
}

process.exit(failed ? 1 : 0);
