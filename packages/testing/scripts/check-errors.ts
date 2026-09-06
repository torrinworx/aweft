// The generated refusal vocabulary, compared with the committed one.
//
// `errors.txt` next to each package is every reason that package can throw and the remedy it
// offers with it. It is generated, never hand-written, so the only way it changes is that the
// vocabulary changed, and the diff is the change. A reason is API even though it appears in no
// signature: callers branch on it, and `spec/fixtures/invalid/` names one per case.
//
// It also enforces the half of design 101 that prose cannot: a refusal with no fix, or one
// built at runtime, fails here rather than reaching a reader who needed the remedy.

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { errorLines, errorsOf, surfaceProgram } from '../src/index.ts';

const root = join(import.meta.dirname, '..', '..', '..');
const write = process.argv.includes('--write');
const NEWLINE = String.fromCharCode(10);

const packages = readdirSync(join(root, 'packages'))
	.filter((name) => statSync(join(root, 'packages', name)).isDirectory())
	.filter((name) => existsSync(join(root, 'packages', name, 'src')))
	.sort();

// Every source file, not just the entry: a refusal is thrown where the rule is, and the entry
// file re-exports rather than throws.
const sourcesOf = (name: string): string[] => {
	const dir = join(root, 'packages', name, 'src');
	const walk = (at: string): string[] => readdirSync(at, { withFileTypes: true }).flatMap((entry) => {
		const path = join(at, entry.name);
		if (entry.isDirectory()) return walk(path);
		return entry.name.endsWith('.ts') ? [path] : [];
	});
	return walk(dir).sort();
};

const files = new Map(packages.map((name) => [name, sourcesOf(name)] as const));
const program = surfaceProgram([...files.values()].flat());

let changed = 0;
for (const name of packages) {
	const generated = errorLines(errorsOf(files.get(name)!, program));
	const text = generated.length === 0 ? '' : generated.join(NEWLINE) + NEWLINE;
	const path = join(root, 'packages', name, 'errors.txt');

	if (write) {
		writeFileSync(path, text);
		continue;
	}

	const committed = existsSync(path)
		? readFileSync(path, 'utf8').split(NEWLINE).filter((line) => line !== '')
		: [];
	if (committed.join(NEWLINE) === generated.join(NEWLINE)) continue;

	changed += 1;
	console.error('packages/' + name + '/errors.txt');

	const before = new Set(committed);
	const after = new Set(generated);
	for (const line of committed) if (!after.has(line)) console.error('  -' + line);
	for (const line of generated) if (!before.has(line)) console.error('  +' + line);
}

if (changed > 0) {
	console.error('');
	console.error(String(changed) + ' package(s) refuse for reasons the committed index does not list.');
	console.error('Run `npm run errors` to regenerate, and check the diff says what you meant it to.');
	process.exit(1);
}

const total = packages.reduce((n, name) => n + errorsOf(files.get(name)!, program).length, 0);
console.log('errors: ' + String(total) + ' refusals across ' + String(packages.length) + ' packages, each with a fix');
