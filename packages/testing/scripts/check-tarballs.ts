// The packages as npm would ship them: pack every workspace, install the tarballs in an empty
// directory outside the repo, import every entry each `exports` map names, and run two recipes
// against what was installed. Every other check reads the source. This one reads the
// tarball, so it is the release's last check before `npm publish` (design 256).
//
//   node packages/testing/scripts/check-tarballs.ts

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..', '..');
const scratch = mkdtempSync(join(tmpdir(), 'aweft-tarballs-'));
const packed = join(scratch, 'packed');
const app = join(scratch, 'app');
mkdirSync(packed);
mkdirSync(app);

// An interrupt or a throw would otherwise leave the install behind in the temp directory.
const cleanUp = (): void => rmSync(scratch, { recursive: true, force: true });
process.on('exit', cleanUp);
process.on('SIGINT', () => process.exit(130));
process.on('SIGTERM', () => process.exit(143));

// `npm run` hands its children the repo's `.npmrc`, both as NODE_OPTIONS and as npm_config_*
// variables, and that config resolves @aweftjs/* to `src/`. A consumer has neither.
const env: Record<string, string> = {};
for (const [name, value] of Object.entries(process.env)) {
	if (value === undefined || name === 'NODE_OPTIONS' || name.toLowerCase().startsWith('npm_config_')) continue;
	env[name] = value;
}

const run = (label: string, command: string, args: string[], cwd: string): string => {
	const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 300_000 });
	if (result.status !== 0) {
		console.error(`tarballs: ${label} failed (exit ${String(result.status)})`);
		console.error((result.stdout + result.stderr).trim().split('\n').slice(-30).join('\n'));
		process.exit(1);
	}
	return result.stdout;
};

run('npm pack', 'npm', ['pack', '--workspaces', '--pack-destination', packed], root);
const tarballs = readdirSync(packed).filter((name) => name.endsWith('.tgz'));

writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'app', private: true, type: 'module' }));
run('npm install', 'npm', ['install', '--no-audit', '--no-fund', ...tarballs.map((name) => join(packed, name))], app);

// A `.json` subpath needs the import attribute, and Node refuses it without one. Importing reads
// only the `default` condition, so the declarations `types` names are looked for by hand.
writeFileSync(join(app, 'entries.mjs'), `import { existsSync, readdirSync, readFileSync } from 'node:fs';
const scope = new URL('./node_modules/@aweftjs/', import.meta.url);
const failed = [];
let count = 0;
for (const name of readdirSync(scope)) {
	const manifest = JSON.parse(readFileSync(new URL(name + '/package.json', scope), 'utf8'));
	for (const path of Object.keys(manifest.exports ?? {})) {
		if (path.includes('*')) continue;
		const specifier = '@aweftjs/' + name + (path === '.' ? '' : path.slice(1));
		count++;
		const types = manifest.exports[path].types;
		if (types !== undefined && !existsSync(new URL(name + '/' + types, scope))) failed.push(specifier + ': ' + types + ' is not in the tarball');
		try {
			await (specifier.endsWith('.json') ? import(specifier, { with: { type: 'json' } }) : import(specifier));
		} catch (error) {
			failed.push(specifier + ': ' + String(error.message).split('\\n')[0]);
		}
	}
}
for (const line of failed) console.error(line);
if (failed.length > 0) process.exit(1);
console.log(count);
`);
const entries = run('importing every entry', process.execPath, ['entries.mjs'], app).trim();

// Two recipes: two-clients uses core and sync together. The sandbox recipe matters because a
// sandboxed process may read only the directories next to the installed package, and those
// are not where they are in the repo (design 256).
for (const recipe of ['two-clients', 'sandbox']) {
	copyFileSync(join(root, 'recipes', recipe, 'main.ts'), join(app, `${recipe}.ts`));
	run(`recipes/${recipe}`, process.execPath, [`${recipe}.ts`], app);
}

console.log(`tarballs: ${String(tarballs.length)} packed and installed, ${entries} entries import, two-clients and sandbox run`);
