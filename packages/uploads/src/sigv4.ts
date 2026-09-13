// Signature Version 4, the request signing an S3-compatible service reads (design 262).
//
// Written here rather than taken from a dependency: the adapter makes four kinds of request and
// each needs one header, and the published test vectors pin the arithmetic. The path is encoded
// once, as S3 reads it; the payload is whatever hash the caller names, so a body may go unsigned
// and stream.

import { createHash, createHmac } from 'node:crypto';

/** What a signature is made from. */
export interface Signing {
	readonly method: string;
	readonly url: URL;
	/** Every header the request will carry that the signature should cover; `host` is added. */
	readonly headers: Readonly<Record<string, string>>;
	/** Hex sha256 of the body, or `UNSIGNED-PAYLOAD`. */
	readonly payloadHash: string;
	readonly region: string;
	readonly service: string;
	readonly accessKey: string;
	readonly secretKey: string;
	/** When the request is made; `x-amz-date` is written from it. */
	readonly date: Date;
}

/** The headers to send: what was given, `host`, `x-amz-date`, and `authorization`. */
export type Signed = Readonly<Record<string, string>>;

export const sha256Hex = (text: string | Uint8Array): string => createHash('sha256').update(text).digest('hex');

const hmac = (key: string | Uint8Array, text: string): Buffer => createHmac('sha256', key).update(text).digest();

/** RFC 3986 unreserved characters kept, every other byte as `%XX`, upper case. */
const encode = (text: string): string =>
	encodeURIComponent(text).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** The path, each segment encoded once and `/` kept. */
const canonicalPath = (pathname: string): string => {
	const decoded = pathname.split('/').map((segment) => {
		try {
			return encode(decodeURIComponent(segment));
		} catch {
			return encode(segment);
		}
	});
	return decoded.join('/') || '/';
};

const canonicalQuery = (url: URL): string => {
	const pairs: [string, string][] = [];
	for (const [key, value] of url.searchParams) pairs.push([encode(key), encode(value)]);
	pairs.sort(([a, av], [b, bv]) => (a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0));
	return pairs.map(([k, v]) => `${k}=${v}`).join('&');
};

/** A header value as the canonical form wants it: trimmed, runs of spaces collapsed. */
const trimmed = (value: string): string => value.trim().replace(/ +/g, ' ');

const amzDate = (date: Date): string => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

/**
 * Sign a request.
 *
 * Params:
 *   signing: the request, the credentials, the region and service, and the payload hash
 *
 * Returns: the headers to send, `authorization` among them.
 *
 * Example:
 *   const headers = sign({ method: 'PUT', url, headers: { 'content-type': type, 'x-amz-content-sha256': 'UNSIGNED-PAYLOAD' }, payloadHash: 'UNSIGNED-PAYLOAD', region, service: 's3', accessKey, secretKey, date: new Date() });
 */
export const sign = (signing: Signing): Signed => {
	const stamp = amzDate(signing.date);
	const day = stamp.slice(0, 8);
	const headers: Record<string, string> = {};
	for (const [name, value] of Object.entries(signing.headers)) headers[name.toLowerCase()] = value;
	headers.host = signing.url.host;
	headers['x-amz-date'] = stamp;

	const names = Object.keys(headers).sort();
	const canonicalHeaders = names.map((name) => `${name}:${trimmed(headers[name]!)}\n`).join('');
	const signedHeaders = names.join(';');
	const canonicalRequest = [
		signing.method.toUpperCase(),
		canonicalPath(signing.url.pathname),
		canonicalQuery(signing.url),
		canonicalHeaders,
		signedHeaders,
		signing.payloadHash,
	].join('\n');

	const scope = `${day}/${signing.region}/${signing.service}/aws4_request`;
	const stringToSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256Hex(canonicalRequest)].join('\n');
	const kDate = hmac(`AWS4${signing.secretKey}`, day);
	const kRegion = hmac(kDate, signing.region);
	const kService = hmac(kRegion, signing.service);
	const kSigning = hmac(kService, 'aws4_request');
	const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');

	return {
		...headers,
		authorization: `AWS4-HMAC-SHA256 Credential=${signing.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
	};
};
