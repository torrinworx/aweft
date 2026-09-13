// The directory adapter: one file per key under a directory, written beside its final name and
// renamed over it (design 262).

import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { codecError, createId, idToText } from '@aweftjs/codec';

import { type Adapter, keyOf } from './adapter.ts';

/**
 * Bytes kept as files in a directory, one per key.
 *
 * Params:
 *   path: the directory, resolved from the working directory and made when it is missing
 *
 * Returns: the adapter. A put goes to a temporary name in the same directory and is renamed
 * over the key once every byte is written, so a reader never opens a partial file and a put
 * that fails leaves nothing behind.
 *
 * Example:
 *   // modules/uploads/Files.ts
 *   export const config = { storage: directory('var/uploads') };
 */
export const directory = (path: string): Adapter => {
	if (typeof path !== 'string' || path === '') {
		throw codecError('invalid-config', `directory was given ${JSON.stringify(path)}`, 'Give directory the path of the directory to keep files in.');
	}
	const dir = resolve(path);
	const fileOf = (key: string): string => join(dir, keyOf(key));

	return {
		name: 'directory',
		put: async (key, stream, _options) => {
			const file = fileOf(key);
			await mkdir(dir, { recursive: true });
			// A name a key can never be, so a crash mid-write leaves a file no `open` will find.
			const part = `${file}.part.${idToText(createId())}`;
			try {
				await pipeline(Readable.fromWeb(stream as import('node:stream/web').ReadableStream), createWriteStream(part));
				await rename(part, file);
			} catch (error) {
				await rm(part, { force: true });
				throw error;
			}
		},
		open: async (key) => {
			const file = fileOf(key);
			try {
				if (!(await stat(file)).isFile()) return undefined;
			} catch {
				return undefined;
			}
			return Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>;
		},
		head: async (key) => {
			const file = fileOf(key);
			try {
				const info = await stat(file);
				return info.isFile() ? { size: info.size } : undefined;
			} catch {
				return undefined;
			}
		},
		remove: async (key) => { await rm(fileOf(key), { force: true }); },
	};
};
