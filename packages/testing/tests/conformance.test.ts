// Runs every committed fixture. This is the gate the wire format actually rests on: prose
// can drift, and a fixture cannot, because altering one by a byte fails here.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type Fixture, type InvalidFixture, checkFixture, checkInvalidFixture } from '../src/index.ts';

const dir = new URL('../../../spec/fixtures/', import.meta.url);
const invalidDir = new URL('invalid/', dir);

const jsonFiles = (at: URL): string[] =>
	readdirSync(at).filter((f) => f.endsWith('.json')).sort();

const read = <T>(at: URL, file: string): T => JSON.parse(readFileSync(new URL(file, at), 'utf8')) as T;

const fixtures = jsonFiles(dir);
const rejections = jsonFiles(invalidDir);

// A suite that finds no fixtures would pass while proving nothing, so the count is asserted
// before anything else runs.
test('there are fixtures to run', () => {
	// Exact, not a floor. A floor passes when a fixture and its generator entry are deleted
	// together, which is the one way the suite can quietly shrink.
	assert.equal(fixtures.length, 15, `found ${fixtures.length} fixtures`);
	assert.equal(rejections.length, 35, `found ${rejections.length} rejection fixtures`);
});

for (const file of fixtures) {
	test(`fixture ${file}`, () => {
		checkFixture(read<Fixture>(dir, file));
	});
}

for (const file of rejections) {
	test(`rejects ${file}`, () => {
		checkInvalidFixture(read<InvalidFixture>(invalidDir, file));
	});
}

test('the committed fixtures are the ones the generator produces', () => {
	const scratch = mkdtempSync(join(tmpdir(), 'aweft-fixtures-'));

	try {
		execFileSync(
			process.execPath,
			[fileURLToPath(new URL('../scripts/generate-fixtures.ts', import.meta.url))],
			{ env: { ...process.env, AWEFT_FIXTURES: scratch }, stdio: 'pipe' },
		);

		const fresh = new URL(`${pathToUrl(scratch)}/`);
		const freshInvalid = new URL('invalid/', fresh);

		assert.deepEqual(jsonFiles(fresh), fixtures, 'the set of fixtures has changed');
		assert.deepEqual(jsonFiles(freshInvalid), rejections, 'the set of rejections has changed');

		for (const file of fixtures) {
			assert.equal(
				readFileSync(new URL(file, fresh), 'utf8'),
				readFileSync(new URL(file, dir), 'utf8'),
				`${file} differs from what the generator produces`,
			);
		}
		for (const file of rejections) {
			assert.equal(
				readFileSync(new URL(file, freshInvalid), 'utf8'),
				readFileSync(new URL(file, invalidDir), 'utf8'),
				`invalid/${file} differs from what the generator produces`,
			);
		}
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
});

function pathToUrl(path: string): string {
	return new URL(`file://${path}`).href;
}

// The specification names the reasons an apply-stage refusal uses, and a reason that lives
// only in a fixture is one a second implementation finds by decoding bytes and guessing. That
// happened: `kind-conflict` was the rule and the token, and neither was written down. So the
// prose and the corpus are held to each other here rather than trusted to stay in step.
test('every apply-stage reason is in the specification, and every one there is used', () => {
	const spec = readFileSync(new URL('../../../spec/format.md', import.meta.url), 'utf8');
	const section = spec.slice(spec.indexOf('## 7. Conformance'));

	const used = new Set(
		rejections
			.map((file) => read<InvalidFixture>(invalidDir, file))
			.filter((f) => f.stage === 'apply')
			.map((f) => f.reason),
	);

	const stated = new Set([...section.matchAll(/^\| `([a-z-]+)` \|/gm)].map((m) => m[1]!));

	assert.deepEqual([...used].sort(), [...stated].sort());
	assert.ok(used.size > 0, 'no apply-stage fixture found, so this check proves nothing');
});
