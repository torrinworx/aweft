// The S3 adapter: bytes kept as objects in an S3-compatible bucket, reached by path-style URLs
// and signed requests over Node's own http (design 262).
//
// Node's `http` rather than `fetch`, because a PUT with a streaming body has to carry its
// `Content-Length`, and a bucket refuses a chunked body it was not told the length of.

import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { IncomingMessage } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { codecError } from '@aweftjs/codec';

import { type Adapter, keyOf } from './adapter.ts';
import { sha256Hex, sign } from './sigv4.ts';

export interface S3Options {
	/** `https://nyc3.digitaloceanspaces.com`, `http://127.0.0.1:9000`: the service, not the bucket. */
	readonly endpoint: string;
	readonly region: string;
	readonly bucket: string;
	readonly accessKey: string;
	readonly secretKey: string;
	/** Put in front of every key, so one bucket serves several applications. */
	readonly prefix?: string | undefined;
}

const EMPTY = sha256Hex('');

const refuse = (detail: string, fix: string): Error => codecError('invalid-config', `s3 was given ${detail}`, fix);

const OPTIONS_FIX = 'Give s3 an endpoint URL, a region, a bucket, an accessKey and a secretKey, each a non-empty string.';

const failed = (method: string, status: number): Error =>
	codecError('storage-failed', `the bucket answered ${String(status)} to ${method}`, 'Check the endpoint, the bucket, the region and the keys the s3 adapter was given.');

const drained = (response: IncomingMessage): Promise<void> => new Promise((done) => { response.resume(); response.on('end', done); response.on('error', () => done()); });

/**
 * Bytes kept as objects in a bucket.
 *
 * Params:
 *   options: where the bucket is and how to sign for it
 *
 * Returns: the adapter. Every request is signed with Signature Version 4; a put streams its
 * body with the payload unsigned, so the bytes are read once.
 *
 * Throws: `invalid-config` for a missing or empty option. At use, `storage-failed` with the
 * status the bucket answered.
 *
 * Example:
 *   // modules/uploads/Files.ts
 *   export const config = {
 *   	storage: s3({ endpoint: process.env.SPACES_ENDPOINT!, region: 'nyc3', bucket: 'app', accessKey: process.env.SPACES_KEY!, secretKey: process.env.SPACES_SECRET! }),
 *   };
 */
export const s3 = (options: S3Options): Adapter => {
	for (const name of ['endpoint', 'region', 'bucket', 'accessKey', 'secretKey'] as const) {
		if (typeof options[name] !== 'string' || options[name] === '') throw refuse(`${name} ${JSON.stringify(options[name])}`, OPTIONS_FIX);
	}
	let base: URL;
	try {
		base = new URL(options.endpoint);
	} catch {
		throw refuse(`endpoint ${JSON.stringify(options.endpoint)}`, OPTIONS_FIX);
	}
	if (base.protocol !== 'http:' && base.protocol !== 'https:') throw refuse(`endpoint ${JSON.stringify(options.endpoint)}`, OPTIONS_FIX);
	const prefix = options.prefix ?? '';
	if (typeof prefix !== 'string' || !/^[A-Za-z0-9_./-]*$/.test(prefix)) {
		throw refuse(`prefix ${JSON.stringify(prefix)}`, 'Give prefix letters, digits, _ . / and -, such as "site1/", or leave it out.');
	}
	const urlOf = (key: string): URL => new URL(`${base.pathname.replace(/\/$/, '')}/${options.bucket}/${prefix}${keyOf(key)}`, base);

	const send = (method: string, url: URL, headers: Record<string, string>, body?: ReadableStream<Uint8Array>): Promise<IncomingMessage> =>
		new Promise((resolve, reject) => {
			const make = url.protocol === 'https:' ? httpsRequest : httpRequest;
			const outgoing = make(url, { method, headers }, resolve);
			outgoing.on('error', reject);
			if (body === undefined) { outgoing.end(); return; }
			pipeline(Readable.fromWeb(body as import('node:stream/web').ReadableStream), outgoing).catch(reject);
		});

	const signed = (method: string, url: URL, headers: Record<string, string>, payloadHash: string): Record<string, string> => ({
		...sign({
			method, url, headers: { ...headers, 'x-amz-content-sha256': payloadHash }, payloadHash,
			region: options.region, service: 's3', accessKey: options.accessKey, secretKey: options.secretKey, date: new Date(),
		}),
	});

	return {
		name: 's3',
		put: async (key, stream, { type, size }) => {
			const url = urlOf(key);
			const headers = signed('PUT', url, { 'content-type': type }, 'UNSIGNED-PAYLOAD');
			const response = await send('PUT', url, { ...headers, 'content-length': String(size) }, stream);
			await drained(response);
			if (response.statusCode === undefined || response.statusCode < 200 || response.statusCode >= 300) throw failed('PUT', response.statusCode ?? 0);
		},
		open: async (key) => {
			const url = urlOf(key);
			const response = await send('GET', url, signed('GET', url, {}, EMPTY));
			if (response.statusCode === 404) { await drained(response); return undefined; }
			if (response.statusCode !== 200) { await drained(response); throw failed('GET', response.statusCode ?? 0); }
			return Readable.toWeb(response) as ReadableStream<Uint8Array>;
		},
		head: async (key) => {
			const url = urlOf(key);
			const response = await send('HEAD', url, signed('HEAD', url, {}, EMPTY));
			await drained(response);
			if (response.statusCode === 404) return undefined;
			if (response.statusCode !== 200) throw failed('HEAD', response.statusCode ?? 0);
			return { size: Number(response.headers['content-length'] ?? 0) };
		},
		remove: async (key) => {
			const url = urlOf(key);
			const response = await send('DELETE', url, signed('DELETE', url, {}, EMPTY));
			await drained(response);
			const status = response.statusCode ?? 0;
			if (status !== 200 && status !== 204 && status !== 404) throw failed('DELETE', status);
		},
	};
};
