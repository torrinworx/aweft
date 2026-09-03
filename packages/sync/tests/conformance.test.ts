// The frame corpus, run against the shipped encoder.
//
// Each fixture states the frame and, separately, the array `spec/replication.md` section 5
// says that frame is written as. The bytes are the codec's value encoder applied to that
// stated array, so nothing here compares the encoder against its own past output.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import { type WireValue, bytesFromHex, bytesToHex, encodeValue } from '@aweftjs/codec';
import { decodeFrame, encodeFrame } from '@aweftjs/sync';
import type { Frame } from '@aweftjs/sync';

const here = join(import.meta.dirname, '..', '..', '..', 'spec', 'frames');
const files = readdirSync(here).sort();
const read = (name: string): Record<string, unknown> =>
	JSON.parse(readFileSync(join(here, name), 'utf8'));

/** A wire value as a fixture writes it: bytes wrapped so they survive JSON. */
const wireFromJson = (value: unknown): WireValue => {
	if (Array.isArray(value)) return value.map(wireFromJson);
	if (value !== null && typeof value === 'object') return bytesFromHex((value as { hex: string }).hex);
	return value as WireValue;
};

/** A frame as a fixture writes it: every byte string in hex. */
const frameFromJson = (value: Record<string, unknown>): Frame => {
	const out: Record<string, unknown> = { ...value };
	if (out.root !== undefined && out.root !== null) {
		const root = out.root as { id: string; kind: string };
		out.root = { id: bytesFromHex(root.id), kind: root.kind };
	}
	if (out.commit !== undefined) {
		out.commit = commitFromJson(out.commit as Record<string, unknown>);
	}
	if (Array.isArray(out.commits)) {
		out.commits = (out.commits as Record<string, unknown>[]).map(commitFromJson);
	}
	return out as unknown as Frame;
};

const commitFromJson = (value: Record<string, unknown>): unknown => ({
	deltas: (value.deltas as Record<string, unknown>[]).map((delta) => {
		const ref = delta.ref as { kind: string; key: string };
		const out: Record<string, unknown> = {
			type: delta.type,
			id: bytesFromHex(delta.id as string),
			ref: ref.kind === 'object' ? ref : { kind: ref.kind, key: bytesFromHex(ref.key) },
		};
		if ('value' in delta) out.value = delta.value;
		return out;
	}),
});

test('the corpus exists and every file is a fixture', () => {
	assert.ok(files.length >= 20, `${files.length} fixture files`);
	for (const name of files) assert.ok(name.endsWith('.json'), name);
});

for (const name of files.filter((f) => !f.startsWith('invalid-'))) {
	const fixture = read(name);

	test(`${name}: the spec's shape writes the bytes the fixture states`, () => {
		const wire = (fixture.wire as unknown[]).map(wireFromJson);
		assert.equal(bytesToHex(encodeValue(wire) as Uint8Array), fixture.bytes, fixture.note as string);
	});

	test(`${name}: the encoder writes the same bytes from the frame`, () => {
		const frame = frameFromJson(fixture.frame as Record<string, unknown>);
		assert.equal(bytesToHex(encodeFrame(frame)), fixture.bytes, fixture.note as string);
	});

	test(`${name}: the bytes decode to the frame the fixture states`, () => {
		const decoded = decodeFrame(bytesFromHex(fixture.bytes as string));
		assert.deepStrictEqual(
			decoded, frameFromJson(fixture.frame as Record<string, unknown>), fixture.note as string,
		);
		assert.equal(bytesToHex(encodeFrame(decoded)), fixture.bytes, 're-encoding reproduces the bytes');
	});
}

for (const name of files.filter((f) => f.startsWith('invalid-'))) {
	const fixture = read(name);

	test(`${name}: refused, for the reason it names`, () => {
		assert.throws(
			() => decodeFrame(bytesFromHex(fixture.bytes as string)),
			(error: unknown) => {
				assert.equal(
					(error as { reason?: string }).reason, fixture.reason,
					`${name} must be refused as ${String(fixture.reason)}: ${String(fixture.note)}`,
				);
				return true;
			},
		);
	});
}

// A fixture edited by hand is a format change without a changelog entry, so the gate
// regenerates the corpus into a scratch directory and holds the two to byte equality.
test('what is committed is what the generator produces', () => {
	const scratch = mkdtempSync(join(tmpdir(), 'aweft-frames-'));
	try {
		const run = spawnSync(
			process.execPath,
			[join(import.meta.dirname, '..', 'scripts', 'generate-frames.ts')],
			{ env: { ...process.env, AWEFT_FRAMES: scratch }, stdio: 'pipe', encoding: 'utf8' },
		);
		assert.equal(run.status, 0, `generation failed: ${run.stderr}`);

		const made = readdirSync(scratch).sort();
		assert.deepStrictEqual(made, files, 'the same fixtures, by name');
		for (const name of made) {
			assert.equal(
				readFileSync(join(scratch, name), 'utf8'), readFileSync(join(here, name), 'utf8'),
				`${name} differs from what the generator produces`,
			);
		}
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
});
