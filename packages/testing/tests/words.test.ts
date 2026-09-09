// The words check, against text written here so the expected answers are fixed by this file.
//
// What the check does over the real tree is `npm run words`; this states the rule one planted
// word at a time, and the shapes it must leave alone. This file and `../src/words.ts` are the
// two the script does not read, because both have to spell the words to check for them.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type WordViolation, checkWords, wordRules } from '../src/words.ts';

const words = (text: string, path = 'a.md'): string[] =>
	checkWords([{ path, text }]).map((found: WordViolation) => `${found.path}:${String(found.line)}: ${found.word}`);

test('a clean file reports nothing', () => {
	assert.deepEqual(words('A commit applies whole or not at all.\nThe session cookie is read off the request.\n'), []);
});

test('each entry in the list is reached by the spelling it names', () => {
	const planted: [string, string][] = [
		['CALLS 193 asked for Tabs.', 'a calls file id'],
		['see `docs/PARKED.md` for the rest', 'a process file'],
		['as record 129 says', 'a record id'],
		['Records 199 and 200 describe them.', 'a record id'],
		['decision 105 supersedes it', 'a decision id'],
		['the file is in docs/decisions/', 'the old records directory'],
		['Decided by: the session.', 'a decided-by header'],
		['Concept: surface.', 'a concept header'],
		['measured in log 230', 'a log id'],
		['written with the Logs app', 'the logs application'],
		['two mutants killed', 'a mutant'],
		['amended from the check-in', 'a review step'],
		['a docs-only reader', 'a review step'],
		['signed off on the shape', 'a review step'],
		['runs in worktree aweft-x', 'a worktree'],
		['the work order asked for', 'a work order'],
		['built in batch two', 'a build batch'],
		["this session's own call", 'a session'],
		['measured on 2026-09-08', 'a date'],
	];
	for (const [text, word] of planted) {
		assert.deepEqual(words(text), [`a.md:1: ${word}`], text);
	}
});

test('the words the code needs are left alone', () => {
	const fine = [
		'const batch = pending;',
		'a session that has expired is anonymous',
		'the calls document is written by both ends',
		'leave the equals sign off',
		'the log is appended once per run',
		'a record of every node operation',
		'the store records no actor',
		'twenty-nine uses pass a function of their own',
	];
	for (const text of fine) assert.deepEqual(words(text), [], text);
});

test('a line carrying two words is reported twice, and lines are numbered from one', () => {
	assert.deepEqual(words('fine\nCALLS 001, see docs/PARKED.md\n'), ['a.md:2: a calls file id', 'a.md:2: a process file']);
});

test('every rule names what to write instead', () => {
	for (const rule of wordRules()) assert.ok(rule.fix.length > 0, rule.word);
});

test('the script reports each line with its fix and exits nonzero, and exits zero on a clean tree', () => {
	const dir = mkdtempSync(join(tmpdir(), 'aweft-words-'));
	try {
		writeFileSync(join(dir, 'note.md'), 'fine\nDecided by: nobody.\n');
		const script = join(import.meta.dirname, '..', 'scripts', 'check-words.ts');
		const red = spawnSync(process.execPath, [script, dir], { encoding: 'utf8' });
		assert.equal(red.status, 1, red.stdout + red.stderr);
		assert.match(red.stdout, /note\.md:2: a decided-by header; drop the line/);
		assert.match(red.stdout, /1 line/);

		writeFileSync(join(dir, 'note.md'), 'fine\n');
		const green = spawnSync(process.execPath, [script, dir], { encoding: 'utf8' });
		assert.equal(green.status, 0, green.stdout + green.stderr);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
