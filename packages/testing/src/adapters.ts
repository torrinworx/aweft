// The suite an `uploads` adapter passes rather than claims (design 262).
//
// An adapter keeps bytes by key. Each check is a named function that throws on failure and
// runs against an adapter the caller makes, so one written for another store proves itself
// the way the directory and bucket ones do.

import assert from 'node:assert/strict';

/** What a check needs: an adapter nobody else is using. */
export type MakeAdapter = () => Promise<FileAdapter> | FileAdapter;

/**
 * The part of an `uploads` adapter this suite exercises.
 *
 * Stated structurally rather than imported, so `testing` does not depend on `uploads`: the
 * package it checks depends on it in turn.
 */
export interface FileAdapter {
	readonly name: string;
	put(key: string, stream: ReadableStream<Uint8Array>, options: { readonly type: string; readonly size: number }): Promise<void>;
	open(key: string): Promise<ReadableStream<Uint8Array> | undefined>;
	head(key: string): Promise<{ readonly size: number } | undefined>;
	remove(key: string): Promise<void>;
}

/** One named obligation an adapter has to meet. */
export interface AdapterCheck {
	readonly name: string;
	run(make: MakeAdapter): Promise<void>;
}

const bytesOf = (length: number, seed = 7): Uint8Array => {
	const out = new Uint8Array(length);
	let x = seed;
	for (let i = 0; i < length; i += 1) {
		x = (x * 1103515245 + 12345) & 0x7fffffff;
		out[i] = x & 0xff;
	}
	return out;
};

const streamOf = (bytes: Uint8Array, chunk = 65536): ReadableStream<Uint8Array> => {
	let at = 0;
	return new ReadableStream({
		pull: (controller) => {
			if (at >= bytes.byteLength) { controller.close(); return; }
			controller.enqueue(bytes.subarray(at, Math.min(at + chunk, bytes.byteLength)));
			at += chunk;
		},
	});
};

const collect = async (stream: ReadableStream<Uint8Array>): Promise<Uint8Array> => {
	const chunks: Uint8Array[] = [];
	const reader = stream.getReader();
	for (let next = await reader.read(); !next.done; next = await reader.read()) chunks.push(next.value);
	const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
	let at = 0;
	for (const chunk of chunks) { out.set(chunk, at); at += chunk.byteLength; }
	return out;
};

const reasonOf = (error: unknown): unknown => (error as { reason?: unknown } | null)?.reason;

let minted = 0;
const key = (): string => `check${String(Date.now())}${String(minted += 1)}`;

/**
 * The obligations of an adapter, as named checks.
 *
 * Returns: the checks. Run each with a fresh adapter.
 *
 * Example:
 *   for (const c of adapterChecks()) test(c.name, () => c.run(() => directory(tmp)));
 */
export const adapterChecks = (): AdapterCheck[] => [
	{
		name: 'put then open answers the same bytes, and head their length',
		run: async (make) => {
			const adapter = await make();
			const k = key();
			const bytes = bytesOf(1000);
			await adapter.put(k, streamOf(bytes), { type: 'application/octet-stream', size: bytes.byteLength });
			assert.deepEqual(await adapter.head(k), { size: 1000 });
			const opened = await adapter.open(k);
			assert.notEqual(opened, undefined);
			assert.deepEqual(await collect(opened!), bytes);
		},
	},
	{
		name: 'a body over one stream chunk arrives byte for byte',
		run: async (make) => {
			const adapter = await make();
			const k = key();
			const bytes = bytesOf(3 * 65536 + 17, 11);
			await adapter.put(k, streamOf(bytes, 4096), { type: 'application/octet-stream', size: bytes.byteLength });
			assert.deepEqual(await collect((await adapter.open(k))!), bytes);
			assert.deepEqual(await adapter.head(k), { size: bytes.byteLength });
		},
	},
	{
		name: 'a key with no bytes answers undefined to open and head, and remove of it is not an error',
		run: async (make) => {
			const adapter = await make();
			const k = key();
			assert.equal(await adapter.open(k), undefined);
			assert.equal(await adapter.head(k), undefined);
			await adapter.remove(k);
		},
	},
	{
		name: 'remove takes the bytes away',
		run: async (make) => {
			const adapter = await make();
			const k = key();
			const bytes = bytesOf(64);
			await adapter.put(k, streamOf(bytes), { type: 'text/plain', size: 64 });
			await adapter.remove(k);
			assert.equal(await adapter.open(k), undefined);
			assert.equal(await adapter.head(k), undefined);
		},
	},
	{
		name: 'a put whose stream errors keeps nothing',
		run: async (make) => {
			const adapter = await make();
			const k = key();
			const broken = new ReadableStream<Uint8Array>({
				start: (controller) => { controller.enqueue(bytesOf(10)); },
				pull: (controller) => { controller.error(new Error('cut')); },
			});
			await assert.rejects(adapter.put(k, broken, { type: 'text/plain', size: 20 }));
			assert.equal(await adapter.open(k), undefined);
			assert.equal(await adapter.head(k), undefined);
		},
	},
	{
		name: 'a put over a key that has bytes replaces them',
		run: async (make) => {
			const adapter = await make();
			const k = key();
			await adapter.put(k, streamOf(bytesOf(10, 1)), { type: 'text/plain', size: 10 });
			const next = bytesOf(20, 2);
			await adapter.put(k, streamOf(next), { type: 'text/plain', size: 20 });
			assert.deepEqual(await collect((await adapter.open(k))!), next);
		},
	},
	{
		name: 'a key outside the rule is refused before it reaches a path or a URL',
		run: async (make) => {
			const adapter = await make();
			for (const bad of ['../etc', 'a/b', '', 'a b', 'x'.repeat(129)]) {
				await assert.rejects(adapter.put(bad, streamOf(bytesOf(1)), { type: 'text/plain', size: 1 }), (error) => reasonOf(error) === 'invalid-key');
				await assert.rejects(adapter.open(bad), (error) => reasonOf(error) === 'invalid-key');
				await assert.rejects(adapter.head(bad), (error) => reasonOf(error) === 'invalid-key');
				await assert.rejects(adapter.remove(bad), (error) => reasonOf(error) === 'invalid-key');
			}
		},
	},
];
