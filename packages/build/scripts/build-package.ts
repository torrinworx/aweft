// The compile that only a published package needs (design 256).
//
// Node refuses to strip types from a file under `node_modules`, so a package on a registry has
// to carry JavaScript. Nothing else here does: the repo runs the TypeScript as it stands, and
// this runs at pack time and before a publish.
//
// Two passes, because the stack compiles its own JSX. `transform` turns markup and JSX into `h`
// calls (design 110) and leaves types alone; `tsc` then erases the types and rewrites relative
// import extensions, so `./value.ts` in the source is `./value.js` in the output and a bare
// `@aweftjs/core` stays bare.
//
// Run with `--all` for every package, or with no argument from inside one, which is what each
// package's `prepack` does.

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';

import { transform } from '../src/index.ts';

const root = join(import.meta.dirname, '..', '..', '..');
const packagesDir = join(root, 'packages');

/** Every `.ts` and `.tsx` file under a directory, as paths relative to it. */
const sourcesOf = (dir: string): string[] => {
	const walk = (at: string): string[] => readdirSync(at, { withFileTypes: true }).flatMap((entry) => {
		const path = join(at, entry.name);
		if (entry.isDirectory()) return walk(path);
		return entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') ? [path] : [];
	});
	return walk(dir).map((path) => relative(dir, path)).sort();
};

// The staged tree is what `tsc` compiles: every `.ts` copied as it stands, and every `.tsx` with
// its JSX already turned into `h` calls. A `.tsx` keeps its name so that a relative import naming
// it still resolves; `--jsx react` is what makes `tsc` write the result as `.js`, and it has no
// JSX left to act on by then.
//
// `defaultH` is deliberately unset. `ui`'s three files that bind no `h` of their own take it from
// `@aweftjs/dom`, which is what they take under `ui`'s own test script, so the compiled output and
// the tested source agree. Naming `@aweftjs/ui` here would have the package import itself.
const stage = (pkgDir: string, stageDir: string): void => {
	for (const rel of sourcesOf(join(pkgDir, 'src'))) {
		const from = join(pkgDir, 'src', rel);
		const to = join(stageDir, rel);
		mkdirSync(dirname(to), { recursive: true });
		if (!rel.endsWith('.tsx')) {
			cpSync(from, to);
			continue;
		}
		const source = readFileSync(from, 'utf8');
		try {
			writeFileSync(to, transform(source, { filename: from }).code);
		} catch (fault) {
			const said = fault instanceof Error ? fault.message : String(fault);
			throw new Error(`${from}: ${said}`, { cause: fault });
		}
	}
};

const TSC = join(root, 'node_modules', 'typescript', 'bin', 'tsc');

const compile = (name: string, stageDir: string, outDir: string): void => {
	const files = sourcesOf(stageDir).map((rel) => join(stageDir, rel));
	const result = spawnSync(process.execPath, [
		TSC,
		'--rootDir', stageDir,
		'--outDir', outDir,
		'--declaration',
		'--target', 'es2023',
		'--lib', 'es2023,dom',
		'--module', 'nodenext',
		'--moduleResolution', 'nodenext',
		'--jsx', 'react',
		'--allowImportingTsExtensions',
		'--rewriteRelativeImportExtensions',
		'--verbatimModuleSyntax',
		'--strict',
		'--exactOptionalPropertyTypes',
		'--noUncheckedIndexedAccess',
		'--skipLibCheck',
		...files,
	], { stdio: 'inherit', cwd: root });
	if (result.status !== 0) throw new Error(`${name}: tsc exited ${result.status}`);
};

const build = (name: string): void => {
	const pkgDir = join(packagesDir, name);
	const stageDir = join(pkgDir, '.build');
	const outDir = join(pkgDir, 'dist');
	rmSync(stageDir, { recursive: true, force: true });
	rmSync(outDir, { recursive: true, force: true });
	try {
		stage(pkgDir, stageDir);
		compile(name, stageDir, outDir);
	} finally {
		rmSync(stageDir, { recursive: true, force: true });
	}
	console.log(`build: ${name}`);
};

const all = readdirSync(packagesDir)
	.filter((name) => statSync(join(packagesDir, name)).isDirectory())
	.filter((name) => existsSync(join(packagesDir, name, 'package.json')))
	.sort();

// Named packages build; `--all` builds every one; with neither, the package is whichever
// directory npm started the script in, which is how one `prepack` line works in every manifest.
const named = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const targets = process.argv.includes('--all') ? all : named.length > 0 ? named : [basename(process.cwd())];
for (const name of targets) {
	if (!all.includes(name)) throw new Error(`no package named ${name} in packages/`);
	build(name);
}
