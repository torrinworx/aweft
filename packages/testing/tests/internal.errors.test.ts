// White-box: the refusal index reader, over fixtures that hold every shape it has to follow.
// Internal because `makersIn` is not public surface; only `errorsOf` and `errorLines` are.

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { errorLines, errorsOf, makersIn } from '../src/errors.ts';
import { surfaceProgram } from '../src/surface.ts';

const fixture = (name: string): string => join(import.meta.dirname, 'errors', name);

const read = (...names: string[]): ReturnType<typeof errorsOf> => {
	const files = names.map(fixture);
	return errorsOf(files, surfaceProgram(files));
};

describe('errorsOf', () => {
	const found = read('shapes.ts');
	const reasons = found.map((r) => r.reason);

	it('reads a plain throw site', () => {
		assert.ok(reasons.includes('plain-refusal'));
	});

	it('reads a forwarding helper at its call sites, once per remedy', () => {
		const forwarded = found.filter((r) => r.reason === 'forwarded');
		assert.equal(forwarded.length, 2, 'one reason, two remedies, two entries');
		assert.deepEqual(forwarded.map((r) => r.fix).sort(),
			['Do one thing instead.', 'Do two things instead.']);
	});

	it('follows a package factory, and is not fooled by a const inside it', () => {
		const entry = found.find((r) => r.reason === 'through-a-factory');
		assert.ok(entry !== undefined, 'the factory call site is a refusal site');
		assert.equal(entry.fix, 'Use the factory properly.');
	});

	it('records a re-raiser once, under the remedy it carries', () => {
		const entry = found.find((r) => r.reason.startsWith('<whatever'));
		assert.ok(entry !== undefined, 'a refusal rebuilt from elsewhere is still indexed');
		assert.equal(entry.fix, 'Handle it where the call was made.');
	});

	it('does not treat a function that merely throws as a factory', () => {
		assert.ok(reasons.includes('merely'), 'its own throw is indexed');
		assert.equal(reasons.filter((r) => r === 'merely').length, 1,
			'and its callers are not counted as refusal sites');
	});

	it('sorts by reason, then by remedy', () => {
		const sorted = [...found].sort((a, b) =>
			a.reason === b.reason ? (a.fix < b.fix ? -1 : 1) : a.reason < b.reason ? -1 : 1);
		assert.deepEqual(found, sorted);
	});

	it('refuses a refusal with no remedy', () => {
		assert.throws(() => read('missing.ts'), { reason: 'fix-missing' });
	});

	it('refuses a reason assembled at runtime', () => {
		assert.throws(() => read('built.ts'), { reason: 'reason-not-literal' });
	});

	it('refuses a file the program does not hold', () => {
		const files = [fixture('shapes.ts')];
		assert.throws(() => errorsOf([fixture('missing.ts')], surfaceProgram(files)),
			{ reason: 'not-in-program' });
	});
});

describe('makersIn', () => {
	const files = [fixture('shapes.ts')];
	const makers = makersIn([surfaceProgram(files).getSourceFile(files[0]!)!]);

	it('finds the factories and the helpers, re-raising chains included', () => {
		assert.deepEqual([...makers.keys()].sort(),
			['codecError', 'crossed', 'forwarding', 'packageError', 'reraise']);
	});

	it('marks only the one that is handed its reason and holds its own remedy', () => {
		assert.equal(makers.get('crossed')?.reraises, true);
		assert.notEqual(makers.get('packageError')?.reraises, true);
	});
});

describe('errorLines', () => {
	it('writes one line per refusal', () => {
		assert.deepEqual(errorLines([{ reason: 'a', fix: 'Do a.' }, { reason: 'b', fix: 'Do b.' }]),
			['a: Do a.', 'b: Do b.']);
	});
});
