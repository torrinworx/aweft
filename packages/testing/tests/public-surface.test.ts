// The generated surface, against a module small enough to write the expected lines by hand.
//
// The fixture lives in memory behind a compiler host rather than on disk, so the expected
// lines are fixed by this file and cannot move when a real package is edited. The check that
// the generator works on the real thing is `npm run surface:check`, which compares six
// packages against their committed files.

import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

import ts from 'typescript';

import { surfaceOf } from '../src/surface.ts';

const OPTIONS: ts.CompilerOptions = {
	target: ts.ScriptTarget.ES2023,
	strict: true,
	skipLibCheck: true,
	noEmit: true,
	baseUrl: '/',
	paths: { '@aweftjs/*': ['/fixture/*/index.ts'] },
};

const LIB = ts.getDefaultLibFilePath(OPTIONS);

const programOver = (sources: Readonly<Record<string, string>>, entry: string): ts.Program => {
	const host: ts.CompilerHost = {
		fileExists: (name) => name === LIB || name in sources,
		readFile: (name) => (name === LIB ? ts.sys.readFile(LIB) : sources[name]),
		getSourceFile: (name, version) => {
			const text = name === LIB ? ts.sys.readFile(LIB) : sources[name];
			return text === undefined ? undefined : ts.createSourceFile(name, text, version, true);
		},
		getDefaultLibFileName: () => LIB,
		writeFile: () => {},
		getCurrentDirectory: () => '/',
		getCanonicalFileName: (name) => name,
		useCaseSensitiveFileNames: () => true,
		getNewLine: () => '\n',
	};

	return ts.createProgram([entry], OPTIONS, host);
};

const SOURCES = {
	'/fixture/codec/index.ts': 'export interface Commit {\n\treadonly deltas: readonly string[];\n}\n',
	'/fixture/pkg/thing.ts': [
		'/** A thing, with a comment the surface has no business carrying. */',
		'export interface Thing {',
		'\t/** Its name. */',
		'\treadonly name: string;',
		'\tgo(count: number): void;',
		'}',
		'',
		'export const make = (name: string): Thing => ({ name, go: () => {} });',
		'',
	].join('\n'),
	'/fixture/pkg/index.ts': [
		"export { make } from './thing.ts';",
		"export type { Thing } from './thing.ts';",
		"export type { Commit } from '@aweftjs/codec';",
		"export const version: string = '1';",
		'',
	].join('\n'),
};

test('a module reads as one sorted line per export, by kind and by type', () => {
	const program = programOver(SOURCES, '/fixture/pkg/index.ts');

	assert.deepEqual(surfaceOf('/fixture/pkg/index.ts', program), [
		'type Commit: interface Commit { readonly deltas: readonly string[]; } (from @aweftjs/codec)',
		'type Thing: interface Thing { readonly name: string; go(count: number): void; }',
		'value make: (name: string) => Thing',
		'value version: string',
	]);
});

test('a module that exports nothing has an empty surface', () => {
	const program = programOver({ '/fixture/empty.ts': 'const unused = 1;\n' }, '/fixture/empty.ts');

	assert.deepEqual(surfaceOf('/fixture/empty.ts', program), []);
});

test('a path the program does not contain is a mistake worth a throw', () => {
	const program = programOver(SOURCES, '/fixture/pkg/index.ts');

	assert.throws(
		() => surfaceOf('/fixture/pkg/missing.ts', program),
		/is not part of the program/,
	);
});

test('the generator builds its own program when handed only a path', () => {
	const index = join(import.meta.dirname, '..', '..', 'codec', 'src', 'index.ts');

	assert.ok(surfaceOf(index).includes('value idToText: (id: Uint8Array<ArrayBufferLike>) => string'));
});
