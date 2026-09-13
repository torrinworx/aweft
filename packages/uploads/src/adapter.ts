// Where the bytes go: the adapter, and the one rule every adapter applies to a key
// (design 262).

import { codecError } from '@aweftjs/codec';

/** What an adapter is told about the bytes it is handed. */
export interface PutOptions {
	readonly type: string;
	/** The byte length, known before the stream is read, because a bucket asks for it up front. */
	readonly size: number;
}

/**
 * Where uploaded bytes are kept, by opaque key. `directory` and `s3` ship; an application
 * writes another and proves it with `adapterChecks()` from `@aweftjs/testing`.
 *
 * A key is URL-safe text (`keyOf`), and an adapter refuses any other before it becomes a
 * path or a URL. `put` reads the stream to its end and keeps nothing when the stream errors.
 * `open` and `head` answer undefined for a key with no bytes. `remove` of a key with no bytes
 * is not an error.
 */
export interface Adapter {
	/** A short name, written into the record so a reader knows where the bytes are. */
	readonly name: string;
	put(key: string, stream: ReadableStream<Uint8Array>, options: PutOptions): Promise<void>;
	open(key: string): Promise<ReadableStream<Uint8Array> | undefined>;
	head(key: string): Promise<{ readonly size: number } | undefined>;
	remove(key: string): Promise<void>;
}

/** The key rule, as a pattern: letters, digits, `_` and `-`, at most 128 of them. */
export const KEY_RULE = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * The key rule: letters, digits, `_` and `-`, at most 128 of them. An id the keeper mints is
 * sixteen of those, and an object recorded from a bucket by hand keeps whatever key it had, as
 * long as it is one of these.
 *
 * Throws: `invalid-key` for anything else, before it reaches a path or a URL.
 */
export const keyOf = (key: string): string => {
	if (!KEY_RULE.test(key)) {
		throw codecError('invalid-key', `${JSON.stringify(key)} is not a key`, 'Use letters, digits, _ and -, at most 128 characters.');
	}
	return key;
};

/** Every chunk of a stream, as one array. */
export const collect = async (stream: ReadableStream<Uint8Array>): Promise<Uint8Array> => {
	const chunks: Uint8Array[] = [];
	let length = 0;
	const reader = stream.getReader();
	for (let next = await reader.read(); !next.done; next = await reader.read()) {
		chunks.push(next.value);
		length += next.value.byteLength;
	}
	const out = new Uint8Array(length);
	let at = 0;
	for (const chunk of chunks) {
		out.set(chunk, at);
		at += chunk.byteLength;
	}
	return out;
};

/** A stream over bytes already in hand. */
export const streamOf = (bytes: Uint8Array): ReadableStream<Uint8Array> =>
	new ReadableStream({ start: (controller) => { controller.enqueue(bytes); controller.close(); } });
