// The page half, through a request object the test hands in (design 262).

import test from 'node:test';
import assert from 'node:assert/strict';

import { createUploads } from '../src/client.ts';
import type { RequestLike, UploadError } from '../src/client.ts';

/** A request that records what it was told and answers what the test says. */
const fake = (): { make(): RequestLike; sent: { method: string; url: string; headers: Record<string, string>; body: unknown } | undefined; answer(status: number, text: string): void; progress(loaded: number, total: number): void; abortCalls: number } => {
	const held = { sent: undefined as { method: string; url: string; headers: Record<string, string>; body: unknown } | undefined, abortCalls: 0 };
	let live: RequestLike & { status: number; responseText: string } | undefined;
	return {
		make: () => {
			const headers: Record<string, string> = {};
			let method = '';
			let url = '';
			const request = {
				status: 0,
				responseText: '',
				withCredentials: false,
				onload: null,
				onerror: null,
				onabort: null,
				upload: { onprogress: null },
				open: (m: string, u: string) => { method = m; url = u; },
				setRequestHeader: (name: string, value: string) => { headers[name] = value; },
				send: (body: unknown) => { held.sent = { method, url, headers, body }; },
				abort: () => { held.abortCalls += 1; request.onabort?.(); },
			} as RequestLike & { status: number; responseText: string };
			live = request;
			return request;
		},
		get sent() { return held.sent; },
		get abortCalls() { return held.abortCalls; },
		answer: (status, text) => { live!.status = status; live!.responseText = text; live!.onload?.(); },
		progress: (loaded, total) => { live!.upload.onprogress?.({ lengthComputable: true, loaded, total }); },
	};
};

const file = (name: string | undefined, type: string): { size: number; type: string; name?: string } => ({ size: 10, type, ...(name === undefined ? {} : { name }) });

test('a file is posted with its type and its percent-encoded name, and the record comes back', async () => {
	const seam = fake();
	const uploads = createUploads({ request: seam.make });
	const pending = uploads.upload(file('kép ok.png', 'image/png'));
	assert.equal(seam.sent?.method, 'POST');
	assert.equal(seam.sent?.url, '/api/uploads');
	assert.deepEqual(seam.sent?.headers, { 'Content-Type': 'image/png', 'X-Upload-Name': 'k%C3%A9p%20ok.png' });
	seam.answer(201, JSON.stringify({ id: 'abc', url: '/files/abc', size: 10 }));
	assert.deepEqual(await pending, { id: 'abc', url: '/files/abc', size: 10 });
});

test('name and type given win over the file\'s own; a file with no type is an octet stream; no name sends no header', async () => {
	const seam = fake();
	const uploads = createUploads({ request: seam.make });
	void uploads.upload(file('a.bin', ''), { name: 'b.png', type: 'image/png' });
	assert.deepEqual(seam.sent?.headers, { 'Content-Type': 'image/png', 'X-Upload-Name': 'b.png' });

	const second = fake();
	void createUploads({ request: second.make }).upload(file(undefined, ''));
	assert.deepEqual(second.sent?.headers, { 'Content-Type': 'application/octet-stream' });
});

test('progress reports the fraction sent', async () => {
	const seam = fake();
	const fractions: number[] = [];
	const pending = createUploads({ request: seam.make }).upload(file('a.png', 'image/png'), { progress: (f) => fractions.push(f) });
	seam.progress(5, 10);
	seam.progress(10, 10);
	seam.answer(201, '{}');
	await pending;
	assert.deepEqual(fractions, [0.5, 1]);
});

test('a refusal rejects with the status and the reasons', async () => {
	const seam = fake();
	const pending = createUploads({ request: seam.make }).upload(file('a.png', 'image/png'));
	seam.answer(415, JSON.stringify({ reasons: [{ code: 'unsupported-type', message: 'no' }] }));
	await assert.rejects(pending, (error: UploadError) => {
		assert.equal(error.reason, 'refused');
		assert.equal(error.status, 415);
		assert.deepEqual(error.reasons, [{ code: 'unsupported-type', message: 'no' }]);
		return true;
	});

	const html = fake();
	const gated = createUploads({ request: html.make }).upload(file('a.png', 'image/png'));
	html.answer(403, '<h1>no</h1>');
	await assert.rejects(gated, (error: UploadError) => error.status === 403 && error.reasons.length === 0);

	const broken = fake();
	const odd = createUploads({ request: broken.make }).upload(file('a.png', 'image/png'));
	broken.answer(201, 'not json');
	await assert.rejects(odd, (error: UploadError) => error.reason === 'network');
});

test('a signal aborts the request; one already aborted never sends', async () => {
	const seam = fake();
	const controller = new AbortController();
	const pending = createUploads({ request: seam.make }).upload(file('a.png', 'image/png'), { signal: controller.signal });
	controller.abort();
	await assert.rejects(pending, (error: UploadError) => error.reason === 'aborted');
	assert.equal(seam.abortCalls, 1);

	const never = fake();
	const done = new AbortController();
	done.abort();
	await assert.rejects(createUploads({ request: never.make }).upload(file('a.png', 'image/png'), { signal: done.signal }), (error: UploadError) => error.reason === 'aborted');
	assert.equal(never.sent, undefined);
});

test('an origin puts the request there with credentials, and url answers under it', async () => {
	const seam = fake();
	const uploads = createUploads({ origin: 'https://api.example', request: seam.make });
	void uploads.upload(file('a.png', 'image/png'));
	assert.equal(seam.sent?.url, 'https://api.example/api/uploads');
	assert.equal(uploads.url('abc'), 'https://api.example/files/abc');
	assert.equal(createUploads({ request: seam.make }).url('abc'), '/files/abc');
});

test('a request that errors rejects as network', async () => {
	let live: RequestLike | undefined;
	const seam = fake();
	const pending = createUploads({ request: () => { live = seam.make(); return live; } }).upload(file('a.png', 'image/png'));
	live!.onerror?.();
	await assert.rejects(pending, (error: UploadError) => error.reason === 'network');
});
