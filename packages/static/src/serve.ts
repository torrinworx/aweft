// Finding the file and building the answer over it (design 249).
//
// The body is always a stream. A page is small and a bundle is not, and reading either one
// whole holds it in memory for as long as the socket takes.

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { typeOf } from './types.ts';

/** A file that is there, with the two numbers the answer is built from. */
export interface Found {
	readonly file: string;
	readonly size: number;
	readonly mtimeMs: number;
}

/** The file at this exact path, or undefined when it is missing or is not a file. */
export const fileOf = async (file: string): Promise<Found | undefined> => {
	try {
		const info = await stat(file);
		return info.isFile() ? { file, size: info.size, mtimeMs: info.mtimeMs } : undefined;
	} catch {
		return undefined;
	}
};

/**
 * The file a path names: the path itself, then `<path>/index.html`.
 *
 * Params:
 *   dir: the served directory, absolute
 *   path: the path under it, as `pathOf` answered
 *
 * Returns: what to serve, or undefined when neither is a file. `docs` and `docs/` find the
 * same `docs/index.html`, so the two are one page.
 *
 * Example:
 *   await fileAt('/srv/dist', 'docs/install');
 */
export const fileAt = async (dir: string, path: string): Promise<Found | undefined> =>
	await fileOf(join(dir, path)) ?? await fileOf(join(dir, path, 'index.html'));

/**
 * The Cache-Control for a path, from the configured prefixes.
 *
 * Params:
 *   headers: the configuration's prefix to value table
 *   path: the path under the served directory, with no leading slash
 *
 * Returns: the value of the longest prefix the path starts with, or undefined when none
 * matches, which is a page with no cache header at all.
 *
 * Example:
 *   cacheFor({ 'assets/': 'public, max-age=31536000, immutable' }, 'assets/app.js');
 */
export const cacheFor = (headers: Readonly<Record<string, string>>, path: string): string | undefined => {
	let value: string | undefined;
	let longest = -1;
	for (const [prefix, held] of Object.entries(headers)) {
		if (path.startsWith(prefix) && prefix.length > longest) {
			longest = prefix.length;
			value = held;
		}
	}
	return value;
};

const body = (file: string): ReadableStream => Readable.toWeb(createReadStream(file)) as ReadableStream;

// Weak, because size and modification time say the file was replaced and not that its bytes
// differ. It costs nothing: the stat it is built from was already paid for.
const etagOf = (found: Found): string => `W/"${found.size.toString(16)}-${Math.trunc(found.mtimeMs).toString(16)}"`;

const opaque = (tag: string): string => tag.startsWith('W/') ? tag.slice(2) : tag;

// If-None-Match's own rule, and not this module's: `*` matches whatever representation there
// is, and every listed tag is compared weakly, so a tag spelled without `W/` is the same tag as
// one spelled with it. A reader that stored the strong spelling still gets its 304.
const carries = (header: string | null, etag: string): boolean => {
	if (header === null) return false;
	if (header.trim() === '*') return true;
	const held = opaque(etag);
	return header.split(',').some((one) => opaque(one.trim()) === held);
};

/**
 * The answer for a file the URL named: 200 with the bytes, or 304 when the request already
 * carries its ETag.
 *
 * Params:
 *   request: the request, read for its method and its `If-None-Match`
 *   found: the file
 *   cache: the Cache-Control to write, or undefined to write none
 *
 * Returns: 304 with the ETag and no body, or 200 with the type, the length, the ETag and a
 * stream over the file. HEAD carries the same headers and no body.
 *
 * Example:
 *   served(request, found, 'public, max-age=31536000, immutable');
 */
/** On every answer: a browser that guesses a file's type from its bytes turns a text file into a script (design 276). */
export const NOSNIFF: Readonly<Record<string, string>> = { 'x-content-type-options': 'nosniff' };

export const served = (request: Request, found: Found, cache: string | undefined): Response => {
	const etag = etagOf(found);
	const headers: Record<string, string> = { ...NOSNIFF, etag };
	if (cache !== undefined) headers['cache-control'] = cache;
	if (carries(request.headers.get('if-none-match'), etag)) return new Response(null, { status: 304, headers });

	headers['content-type'] = typeOf(found.file);
	headers['content-length'] = String(found.size);
	return new Response(request.method === 'HEAD' ? null : body(found.file), { status: 200, headers });
};

/**
 * The answer for a URL no file matched, over the page the configuration names.
 *
 * Params:
 *   request: the request, read for its method
 *   found: `404.html` or `shell.html`
 *   status: 404 for the first, 200 for the second
 *
 * Returns: the page, with its type and its length and no ETag: one page answers every unknown
 * URL, so an ETag off it would tell a reader their cached copy of one is the answer for
 * another.
 *
 * Example:
 *   answered(request, found, 404);
 */
export const answered = (request: Request, found: Found, status: number): Response =>
	new Response(request.method === 'HEAD' ? null : body(found.file), {
		status,
		headers: { ...NOSNIFF, 'content-type': typeOf(found.file), 'content-length': String(found.size) },
	});
