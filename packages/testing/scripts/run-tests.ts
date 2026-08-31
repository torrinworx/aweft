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
		'--test',
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
