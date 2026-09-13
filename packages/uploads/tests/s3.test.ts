// The s3 adapter: the signer against the published Signature Version 4 vectors, the adapter
// suite over a bucket this file stands up, and a real bucket when the environment names one
// (design 262).
//
// The expected strings below are copied from the published suite (service `service`, region
// `us-east-1`, key `AKIDEXAMPLE`, the date 2015-08-30T12:36:00Z), never from the signer.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createServer as createHttpServer } from 'node:http';
import type { IncomingMessage, Server as HttpServer } from 'node:http';

import { adapterChecks } from '@aweftjs/testing';

import { sha256Hex, sign } from '../src/sigv4.ts';
import { s3 } from '../src/s3.ts';
import { collect, reasonOf, streamOf } from './helpers.ts';

const SUITE = {
	region: 'us-east-1',
	service: 'service',
	accessKey: 'AKIDEXAMPLE',
	secretKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
	date: new Date('2015-08-30T12:36:00Z'),
};

const vectors: { name: string; method: string; path: string; headers: Record<string, string>; body: string; authorization: string }[] = [
	{
		name: 'get-vanilla', method: 'GET', path: '/', headers: {}, body: '',
		authorization: 'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31',
	},
	{
		name: 'post-vanilla', method: 'POST', path: '/', headers: {}, body: '',
		authorization: 'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5da7c1a2acd57cee7505fc6676e4e544621c30862966e37dddb68e92efbe5d6b',
	},
	{
		name: 'get-header-value-trim', method: 'GET', path: '/', headers: { 'my-header1': ' value1 ', 'my-header2': ' "a   b   c" ' }, body: '',
		authorization: 'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;my-header1;my-header2;x-amz-date, Signature=acc3ed3afb60bb290fc8d2dd0098b9911fcaa05412b367055dee359757a9c736',
	},
	{
		name: 'post-x-www-form-urlencoded', method: 'POST', path: '/', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'Param1=value1',
		authorization: 'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=ff11897932ad3f4e8b18135d722051e5ac45fc38421b1da7b9d196a0fe09473a',
	},
	{
		name: 'get-unreserved', method: 'GET', path: '/-._~0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', headers: {}, body: '',
		authorization: 'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=07ef7494c76fa4850883e2b006601f940f8a34d404d0cfa977f52a65bbf5f24f',
	},
	{
		name: 'get-vanilla-query-order-key-case', method: 'GET', path: '/?Param2=value2&Param1=value1', headers: {}, body: '',
		authorization: 'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500',
	},
];

for (const vector of vectors) {
	test(`the signer matches the published vector ${vector.name}`, () => {
		const signed = sign({
			method: vector.method, url: new URL(`https://example.amazonaws.com${vector.path}`), headers: vector.headers,
			payloadHash: sha256Hex(vector.body), ...SUITE,
		});
		assert.equal(signed.authorization, vector.authorization);
		assert.equal(signed['x-amz-date'], '20150830T123600Z');
		assert.equal(signed.host, 'example.amazonaws.com');
	});
}

// --- a bucket in this process ----------------------------------------------------------------

interface Bucket { server: HttpServer; url: string; objects: Map<string, { type: string; bytes: Uint8Array }>; seen: { method: string; path: string; headers: IncomingMessage['headers']; length: number }[]; stop(): Promise<void> }

/** The four requests the adapter makes, answered the way a bucket answers them. */
const bucket = (): Promise<Bucket> => new Promise((ready) => {
	const objects = new Map<string, { type: string; bytes: Uint8Array }>();
	const seen: Bucket['seen'] = [];
	const server = createHttpServer((req, res) => {
		const chunks: Uint8Array[] = [];
		req.on('data', (chunk: Uint8Array) => { chunks.push(chunk); });
		req.on('end', () => {
			const path = req.url ?? '/';
			const authorization = req.headers.authorization ?? '';
			const body = Buffer.concat(chunks);
			seen.push({ method: req.method ?? '', path, headers: req.headers, length: body.byteLength });
			// A request with no signature, or one for another region's scope, is what a bucket refuses.
			if (!/^AWS4-HMAC-SHA256 Credential=key\/\d{8}\/nyc3\/s3\/aws4_request, SignedHeaders=(?:content-type;)?host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/.test(authorization)) {
				res.writeHead(403); res.end(); return;
			}
			if (req.method === 'PUT') {
				if (String(body.byteLength) !== req.headers['content-length']) { res.writeHead(400); res.end(); return; }
				objects.set(path, { type: String(req.headers['content-type'] ?? ''), bytes: new Uint8Array(body) });
				res.writeHead(200); res.end(); return;
			}
			const held = objects.get(path);
			if (req.method === 'DELETE') { objects.delete(path); res.writeHead(204); res.end(); return; }
			if (held === undefined) { res.writeHead(404); res.end(); return; }
			res.writeHead(200, { 'content-type': held.type, 'content-length': String(held.bytes.byteLength) });
			if (req.method === 'HEAD') { res.end(); return; }
			res.end(held.bytes);
		});
	});
	server.listen(0, '127.0.0.1', () => {
		const address = server.address() as { port: number };
		ready({
			server, url: `http://127.0.0.1:${String(address.port)}`, objects, seen,
			stop: () => new Promise((done) => { server.close(() => done()); }),
		});
	});
});

const options = (url: string, more: Partial<Parameters<typeof s3>[0]> = {}): Parameters<typeof s3>[0] =>
	({ endpoint: url, region: 'nyc3', bucket: 'app', accessKey: 'key', secretKey: 'secret', ...more });

for (const check of adapterChecks()) {
	test(`the s3 adapter passes: ${check.name}`, async () => {
		const held = await bucket();
		try {
			await check.run(() => s3(options(held.url)));
		} finally {
			await held.stop();
		}
	});
}

test('a put is one signed PUT with the type, the length and an unsigned payload, under the bucket and prefix', async () => {
	const held = await bucket();
	try {
		const adapter = s3(options(held.url, { prefix: 'site1/' }));
		const bytes = new Uint8Array([1, 2, 3, 4, 5]);
		await adapter.put('abc', streamOf(bytes, 2), { type: 'image/png', size: 5 });
		const put = held.seen[0]!;
		assert.equal(put.method, 'PUT');
		assert.equal(put.path, '/app/site1/abc');
		assert.equal(put.headers['content-type'], 'image/png');
		assert.equal(put.headers['content-length'], '5');
		assert.equal(put.headers['x-amz-content-sha256'], 'UNSIGNED-PAYLOAD');
		assert.match(String(put.headers['x-amz-date']), /^\d{8}T\d{6}Z$/);
		assert.deepEqual(held.objects.get('/app/site1/abc')?.bytes, bytes);
		assert.deepEqual(await collect((await adapter.open('abc'))!), bytes);
		assert.equal(held.seen[1]!.headers['x-amz-content-sha256'], sha256Hex(''));
	} finally {
		await held.stop();
	}
});

test('a bucket that refuses is storage-failed with its status, and nothing else is read', async () => {
	const held = await bucket();
	try {
		const wrong = s3(options(held.url, { region: 'elsewhere' }));
		await assert.rejects(wrong.put('abc', streamOf(new Uint8Array(3)), { type: 'text/plain', size: 3 }), (error) => reasonOf(error) === 'storage-failed');
		await assert.rejects(wrong.open('abc'), (error) => reasonOf(error) === 'storage-failed');
		await assert.rejects(wrong.head('abc'), (error) => reasonOf(error) === 'storage-failed');
		await assert.rejects(wrong.remove('abc'), (error) => reasonOf(error) === 'storage-failed');
	} finally {
		await held.stop();
	}
});

test('an endpoint nothing answers rejects rather than hangs', async () => {
	const adapter = s3(options('http://127.0.0.1:1'));
	await assert.rejects(adapter.head('abc'));
});

test('the options are refused at load when one is missing or the endpoint is not a URL', () => {
	for (const bad of [{ endpoint: '' }, { region: '' }, { bucket: undefined as never }, { accessKey: '' }, { secretKey: 7 as never }, { endpoint: 'nyc3.digitaloceanspaces.com' }, { endpoint: 'ftp://x' }, { prefix: 'a?b#c/' }, { prefix: 'a b/' }]) {
		assert.throws(() => s3(options('http://127.0.0.1:9000', bad)), (error) => reasonOf(error) === 'invalid-config');
	}
});

// --- a real bucket, when the environment names one ----------------------------------------------

const env = process.env;
const real = env.AWEFT_S3_ENDPOINT !== undefined && env.AWEFT_S3_REGION !== undefined && env.AWEFT_S3_BUCKET !== undefined
	&& env.AWEFT_S3_KEY !== undefined && env.AWEFT_S3_SECRET !== undefined;

if (!real) {
	test('a real bucket: skipped, AWEFT_S3_ENDPOINT, AWEFT_S3_REGION, AWEFT_S3_BUCKET, AWEFT_S3_KEY and AWEFT_S3_SECRET are not all set', { skip: true }, () => {});
} else {
	for (const check of adapterChecks()) {
		test(`a real bucket passes: ${check.name}`, () => check.run(() => s3({
			endpoint: env.AWEFT_S3_ENDPOINT!, region: env.AWEFT_S3_REGION!, bucket: env.AWEFT_S3_BUCKET!,
			accessKey: env.AWEFT_S3_KEY!, secretKey: env.AWEFT_S3_SECRET!, prefix: 'aweft-checks/',
		})));
	}
}
