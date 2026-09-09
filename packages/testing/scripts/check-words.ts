// The words check over the tree: the vocabulary of how the stack was built, kept out of the
// files that say what it is. The list and what each entry means are in `../src/words.ts`.
//
// With no arguments it reads every tracked file, which is what the root gate does. With paths it
// reads those files and directories instead, so a pass over one directory can be checked alone:
//
//   node packages/testing/scripts/check-words.ts docs/design
//   node packages/testing/scripts/check-words.ts /home/me/notes.md
//
// Four tracked files are not read: `spec/CHANGELOG.md`, because a changelog carries dates on
// purpose; `package-lock.json`, which is not prose; and the two files that define and test this
// check, which have to spell the words to look for them.

import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

import { checkWords } from '../src/index.ts';

const root = join(import.meta.dirname, '..', '..', '..');
const given = process.argv.slice(2).filter((argument) => !argument.startsWith('--'));

const SKIPPED = new Set([
	'spec/CHANGELOG.md',
	'package-lock.json',
	'packages/testing/src/words.ts',
	'packages/testing/tests/words.test.ts',
]);

const tracked = (): string[] => {
	const listed = spawnSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8' });
	if (listed.status !== 0) {
		throw new Error(`git ls-files failed in ${root}: ${listed.stderr}`);
	}
	return listed.stdout.split('\0').filter((path) => path.length > 0);
};

const under = (path: string): string[] => {
	if (!statSync(path).isDirectory()) return [path];
	return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
		if (entry.name === 'node_modules' || entry.name === '.git') return [];
		return under(join(path, entry.name));
	});
};

const paths = given.length === 0
	? tracked().filter((path) => !SKIPPED.has(path))
	: given.flatMap((argument) => under(isAbsolute(argument) ? argument : resolve(root, argument)))
		.map((path) => relative(root, path))
		.filter((path) => !SKIPPED.has(path));

const sources = paths.map((path) => ({ path, text: readFileSync(join(root, path), 'utf8') }));

const found = checkWords(sources);
for (const line of found) {
	console.log(`${line.path}:${String(line.line)}: ${line.word}; ${line.fix}`);
	console.log(`    ${line.text}`);
}

const files = new Set(found.map((line) => line.path)).size;
if (found.length > 0) {
	console.log(`\n${String(found.length)} line${found.length === 1 ? '' : 's'} in ${String(files)} file${files === 1 ? '' : 's'} carry a word from the list`);
	process.exit(1);
}
console.log(`words: ${String(sources.length)} files read, nothing from the list`);
