// The uploads battery under the gate: a page uploads pictures, they paint from `/files/<id>`,
// each refusal reaches the page with its reason, a module makes a file of its own, and the
// static battery behind it never sees a file it did not write.
//
// Run: AWEFT_DEFAULT_H=@aweftjs/ui node --import @aweftjs/build/loader recipes/uploads/main.ts

import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

import { chromium } from 'playwright';
import { createServer as createViteServer } from 'vite';

import { records } from '@aweftjs/uploads';
import type { Files, UploadRecord } from '@aweftjs/uploads';

const here = fileURLToPath(new URL('.', import.meta.url));

let checks = 0;
let failed = 0;
const check = (ok: boolean, what: string): void => {
	checks += 1;
	if (!ok) failed += 1;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`);
};

// --- a picture a browser will paint --------------------------------------------------------------

const crcTable = Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});
const crc32 = (bytes: Uint8Array): number => {
	let c = 0xffffffff;
	for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Uint8Array): Uint8Array => {
	const out = new Uint8Array(12 + data.byteLength);
	const view = new DataView(out.buffer);
	view.setUint32(0, data.byteLength);
	out.set([...type].map((c) => c.charCodeAt(0)), 4);
	out.set(data, 8);
	view.setUint32(8 + data.byteLength, crc32(out.subarray(4, 8 + data.byteLength)));
	return out;
};
/** A square png `side` pixels wide, one colour or noise (noise does not compress, so it is large). */
const png = (side: number, rgb: [number, number, number] | 'noise'): Uint8Array => {
	const header = new Uint8Array(13);
	const view = new DataView(header.buffer);
	view.setUint32(0, side); view.setUint32(4, side);
	header.set([8, 2, 0, 0, 0], 8);
	const raw = rgb === 'noise' ? new Uint8Array(randomBytes(side * (1 + side * 3))) : new Uint8Array(side * (1 + side * 3));
	for (let y = 0; y < side; y += 1) {
		raw[y * (1 + side * 3)] = 0;
		if (rgb !== 'noise') for (let x = 0; x < side; x += 1) raw.set(rgb, y * (1 + side * 3) + 1 + x * 3);
	}
	const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', new Uint8Array(deflateSync(raw))), chunk('IEND', new Uint8Array(0))];
	const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
	let at = 0;
	for (const p of parts) { out.set(p, at); at += p.byteLength; }
	return out;
};
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

// --- the directories, the backend on a free port, the dev server in front of it ------------------

const uploadsDir = await mkdtemp(join(tmpdir(), 'aweft-recipe-uploads-'));
const siteDir = await mkdtemp(join(tmpdir(), 'aweft-recipe-site-'));
await writeFile(join(siteDir, '404.html'), '<h1>not here</h1>');
process.env.AWEFT_UPLOADS_DIR = uploadsDir;
process.env.AWEFT_SITE_DIR = siteDir;
process.env.PORT = '0';
const backend = await import('./backend/main.ts');
const api = `http://127.0.0.1:${String(backend.listener.port)}`;
process.env.AWEFT_BACKEND_PORT = String(backend.listener.port);

const dev = await createViteServer({
	configFile: join(here, 'page', 'vite.config.ts'),
	logLevel: 'warn',
	server: { port: 0 },
});
await dev.listen();
const origin = dev.resolvedUrls!.local[0]!;

// --- the page -----------------------------------------------------------------------------------

const browser = await chromium.launch();
const view = await browser.newPage({ viewport: { width: 900, height: 700 } });
const cat = png(16, [200, 40, 40]);
const big = png(300, 'noise');

const uploaded = (): Promise<UploadRecord[]> => view.evaluate(() => (globalThis as unknown as { __uploaded: UploadRecord[] }).__uploaded);
const drop = (name: string, mimeType: string, buffer: Uint8Array): Promise<void> =>
	view.setInputFiles('input[type=file]', { name, mimeType, buffer: Buffer.from(buffer) });

try {
	await view.goto(origin);
	await view.waitForSelector('#page');

	// Anonymous: the zone takes the file, the route refuses it, and the page shows why.
	await drop('early.png', 'image/png', cat);
	await view.locator('#refused', { hasText: '403' }).waitFor();
	check(true, 'an anonymous upload is refused with 403 and the page says so');

	await view.locator('input').first().fill('ada@example.com');
	await view.locator('input[type=password]').fill('zQpw77neverstored');
	await view.click('#sign-in');
	await view.locator('#who', { hasText: 'signed in as' }).waitFor();

	// The real job: a picture goes up with progress and comes back on the page.
	await drop('cat.png', 'image/png', cat);
	await view.locator('#progress', { hasText: '100%' }).waitFor();
	await view.waitForFunction(() => {
		const img = (globalThis as unknown as { document: { querySelector(s: string): { complete: boolean; naturalWidth: number } | null } }).document.querySelector('#picture');
		return img !== null && img.complete && img.naturalWidth > 0;
	});
	const [first] = await uploaded();
	check(first !== undefined && first.url === `/files/${first.id}`, 'the record came back with its url');
	check(first?.sha256 === sha256(cat), 'the record carries the hash of the bytes the page sent');
	check(first?.name === 'cat.png' && first.type === 'image/png' && first.size === cat.byteLength, 'the record carries name, type and size');
	check(typeof first?.user === 'string', 'the record carries the signed-in user');
	const painted = await view.evaluate(() => (globalThis as unknown as { document: { querySelector(s: string): { naturalWidth: number } } }).document.querySelector('#picture').naturalWidth);
	check(painted === 16, 'the picture painted from /files/<id>');

	// The file as the server sends it.
	const served = await fetch(`${api}${first!.url}`);
	check(served.status === 200 && served.headers.get('content-type') === 'image/png', 'served with its type');
	check(served.headers.get('cache-control') === 'public, max-age=31536000, immutable', 'served immutable');
	check(served.headers.get('x-content-type-options') === 'nosniff' && served.headers.get('content-security-policy') === 'sandbox', 'served with nosniff and a sandbox policy');
	check(served.headers.get('etag') === `"${first!.sha256}"`, 'the tag is the hash');
	check(Buffer.from(await served.arrayBuffer()).equals(Buffer.from(cat)), 'the bytes are the bytes');
	const cached = await fetch(`${api}${first!.url}`, { headers: { 'if-none-match': `"${first!.sha256}"` } });
	check(cached.status === 304, 'the same tag again is 304');

	// Each refusal, from the page, with the reason the route gave.
	await drop('page.html', 'text/html', new TextEncoder().encode('<script>alert(1)</script>'));
	await view.locator('#refused', { hasText: '415' }).waitFor();
	check(true, 'a type the site does not take is 415');
	await drop('not-really.jpg', 'image/jpeg', cat);
	await view.locator('#refused', { hasText: 'not-really.jpg: 415' }).waitFor();
	check(true, 'png bytes declared jpeg are 415');
	await drop('huge.png', 'image/png', big);
	await view.locator('#refused', { hasText: 'huge.png: 413' }).waitFor();
	check(true, 'a picture over the family cap is 413');
	await drop('nope.png', 'image/png', cat);
	await view.locator('#refused', { hasText: 'nope.png: 422' }).waitFor();
	check(true, 'the application\'s accept refuses with 422 and its own reason');
	check((await uploaded()).length === 1, 'none of the refused files made a record');

	// A module makes a file of its own through the trusted path.
	await view.click('#export');
	await view.locator('#exported', { hasText: '/files/' }).waitFor();
	const csvUrl = await view.locator('#exported').textContent();
	const csv = await fetch(`${api}${csvUrl!}`);
	const text = await csv.text();
	check(csv.headers.get('content-type') === 'text/csv' && text.startsWith('id,url,name,size\n') && text.includes(first!.id), 'the module\'s csv is served with its type and names the picture');

	// The readers, newest first.
	const hers = await records(backend.store, { user: first!.user! });
	check(hers.length === 2 && hers[0]!.type === 'text/csv' && hers[1]!.id === first!.id, 'records() lists the user\'s two files, newest first');

	// The static battery behind it: a URL nobody wrote gets its page, a file never reaches it.
	const nothing = await fetch(`${api}/nothing`);
	check(nothing.status === 404 && (nothing.headers.get('content-type') ?? '').startsWith('text/html'), 'an unknown URL gets the static 404 page');

	// Remove: bytes and record, and then the URL falls through to the static page.
	const keeper = backend.server.loader.get('uploads/Files') as Files;
	check(await keeper.remove(first!.id) === true, 'remove takes the file');
	const gone = await fetch(`${api}${first!.url}`);
	check(gone.status === 404 && (gone.headers.get('content-type') ?? '').startsWith('text/html'), 'a removed file is declined to the static page');
	check((await records(backend.store, { user: first!.user! })).length === 1, 'and its record is gone');

	// An anonymous post is answered before its body is read.
	let pulled = 0;
	const total = 20 * 1024 * 1024;
	const slow = new ReadableStream<Uint8Array>({
		pull: (controller) => {
			if (pulled >= total) { controller.close(); return; }
			pulled += 65536;
			controller.enqueue(new Uint8Array(65536));
		},
	});
	const anonymous = await fetch(`${api}/api/uploads`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: slow, duplex: 'half' } as RequestInit).catch(() => undefined);
	const seenAt = pulled;
	check(anonymous?.status === 403, 'an anonymous post is 403');
	check(seenAt < total / 2, `and it was answered with ${String(seenAt)} of ${String(total)} bytes read`);
} finally {
	await browser.close();
	await dev.close();
	await backend.server.stop();
	await rm(uploadsDir, { recursive: true, force: true });
	await rm(siteDir, { recursive: true, force: true });
}

console.log(`\n${checks - failed}/${checks} checks passed`);
process.exit(failed === 0 ? 0 : 1);
