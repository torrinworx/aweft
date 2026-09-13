// The adapter suite, run over an adapter that is right and two that are wrong, so each
// check is seen to pass and to fail.

import test from 'node:test';
import assert from 'node:assert/strict';

import { adapterChecks } from '../src/index.ts';
import type { FileAdapter } from '../src/index.ts';

const KEY = /^[A-Za-z0-9_-]{1,128}$/;
const invalidKey = (key: string): Error => Object.assign(new Error(`invalid-key: ${key}`), { reason: 'invalid-key' });

const collect = async (stream: ReadableStream<Uint8Array>): Promise<Uint8Array> => {
	const chunks: Uint8Array[] = [];
	for await (const chunk of stream) chunks.push(chunk);
	const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
	let at = 0;
	for (const chunk of chunks) { out.set(chunk, at); at += chunk.byteLength; }
	return out;
};

/** Bytes in a map: the smallest adapter that is right. */
const memory = (options: { keepOnError?: boolean; skipKeyRule?: boolean } = {}): FileAdapter => {
	const held = new Map<string, Uint8Array>();
	const check = (key: string): string => {
		if (options.skipKeyRule !== true && !KEY.test(key)) throw invalidKey(key);
		return key;
	};
	return {
		name: 'memory',
		put: async (key, stream, _options) => {
			check(key);
			const chunks: Uint8Array[] = [];
			try {
				for await (const chunk of stream) chunks.push(chunk);
			} catch (error) {
				if (options.keepOnError === true) held.set(key, await collect(new ReadableStream({ start: (c) => { for (const chunk of chunks) c.enqueue(chunk); c.close(); } })));
				throw error;
			}
			held.set(key, await collect(new ReadableStream({ start: (c) => { for (const chunk of chunks) c.enqueue(chunk); c.close(); } })));
		},
		open: async (key) => {
			const bytes = held.get(check(key));
			return bytes === undefined ? undefined : new ReadableStream({ start: (c) => { c.enqueue(bytes); c.close(); } });
		},
		head: async (key) => {
			const bytes = held.get(check(key));
			return bytes === undefined ? undefined : { size: bytes.byteLength };
		},
		remove: async (key) => { held.delete(check(key)); },
	};
};

for (const check of adapterChecks()) {
	test(`a right adapter passes: ${check.name}`, () => check.run(() => memory()));
}

test('an adapter that keeps a partial body on error fails the check that says so', async () => {
	const check = adapterChecks().find((c) => c.name.includes('stream errors'))!;
	await assert.rejects(check.run(() => memory({ keepOnError: true })));
});

test('an adapter that takes any key fails the key rule check', async () => {
	const check = adapterChecks().find((c) => c.name.includes('outside the rule'))!;
	await assert.rejects(check.run(() => memory({ skipKeyRule: true })));
});
