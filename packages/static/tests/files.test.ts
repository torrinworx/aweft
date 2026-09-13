// static/Files over a real server on a real port: the URL rule, how a file is served, and what
// the gate makes of it (design 249).

import test from 'node:test';
import assert from 'node:assert/strict';

import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { auth, paths } from '@aweftjs/auth';
import { fromBundle } from '@aweftjs/modules';
import { createServer, open } from '@aweftjs/server';
import type { Listener, ListenerHandlers } from '@aweftjs/server';
import { node } from '@aweftjs/server/node';
import { createStore, memoryDriver } from '@aweftjs/store';
import type { Store } from '@aweftjs/store';

import { files } from '../src/index.ts';

interface Booted {
	/** The origin the listener took, port and all. */
	readonly url: string;
	stop(): Promise<void>;
}

/**
 * A server with the battery in it, configured through a same-named entry in a source of the
 * test's own, listed first the way an application's own directory is.
 */
const boot = async (config: Record<string, unknown>, gated = false): Promise<Booted> => {
	const listener = node({ port: 0, host: '127.0.0.1' });
	const own = fromBundle({ './static/Files.ts': { config } });
	const store: Store | undefined = gated
		? createStore({ driver: memoryDriver(), declare: paths })
		: undefined;
	const server = createServer({
		sources: gated ? [own, files, auth] : [own, files],
		...(store === undefined ? {} : { store }),
		gate: gated ? 'auth/Gate' : open,
		listener,
	});
	await server.start();
	return {
		url: `http://127.0.0.1:${String(listener.port)}`,
		stop: async () => {
			await server.stop();
			if (store !== undefined) await store.stop();
		},
	};
};

const dirWith = (tree: Readonly<Record<string, string | Uint8Array>>): string => {
	const dir = mkdtempSync(join(tmpdir(), 'aweft-static-'));
	for (const [name, held] of Object.entries(tree)) {
		const file = join(dir, name);
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, held);
	}
	return dir;
};

/** A directory filled for one test, a server over it, and both gone when it ends. */
const serving = async (
	tree: Readonly<Record<string, string | Uint8Array>>,
	config: Record<string, unknown> = {},
	gated = false,
): Promise<Booted & { readonly dir: string }> => {
	const dir = dirWith(tree);
	const booted = await boot({ dir, ...config }, gated);
	return {
		dir,
		url: booted.url,
		stop: async () => {
			await booted.stop();
			rmSync(dir, { recursive: true, force: true });
		},
	};
};

/** A repeatable byte stream, so a failure over the large file reproduces exactly. */
const pseudoRandom = (bytes: number): Uint8Array => {
	const held = new Uint8Array(bytes);
	let seed = 0x2f6e2b1;
	for (let at = 0; at < bytes; at++) {
		seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
		held[at] = (seed >>> 16) & 0xff;
	}
	return held;
};

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

// The headers this module wrote. Node's own are left out: it closes the socket after a HEAD
// and keeps it after a GET, and the clock moves between two requests.
const TRANSPORT = new Set(['connection', 'keep-alive', 'date']);

const headersOf = (answer: Response): Record<string, string> => {
	const held: Record<string, string> = {};
	answer.headers.forEach((value, name) => { if (!TRANSPORT.has(name)) held[name] = value; });
	return held;
};

const reasonOf = (error: unknown): string => String((error as { reason?: unknown }).reason);
const causeOf = (error: unknown): string => reasonOf((error as { cause?: unknown }).cause);

// --- the URL rule ---------------------------------------------------------------------------

test('the exact file is served, with its type, its length and its bytes', async () => {
	const it = await serving({ 'about/team.html': '<p>team</p>', 'assets/app.js': 'export const a = 1;' });
	try {
		const page = await fetch(`${it.url}/about/team.html`);
		assert.equal(page.status, 200);
		assert.equal(page.headers.get('content-type'), 'text/html; charset=utf-8');
		assert.equal(page.headers.get('content-length'), '11');
		assert.equal(await page.text(), '<p>team</p>');

		const script = await fetch(`${it.url}/assets/app.js?v=2`);
		assert.equal(script.status, 200, 'the query is dropped rather than made part of the path');
		assert.equal(script.headers.get('content-type'), 'text/javascript; charset=utf-8');
		assert.equal(await script.text(), 'export const a = 1;');
	} finally {
		await it.stop();
	}
});

test('a directory is its index.html, and a trailing slash is the same page', async () => {
	const it = await serving({
		'index.html': '<p>home</p>',
		'docs/index.html': '<p>docs</p>',
		'404.html': '<p>gone</p>',
	});
	try {
		assert.equal(await (await fetch(`${it.url}/`)).text(), '<p>home</p>', 'the site root');
		const bare = await fetch(`${it.url}/docs`);
		const slashed = await fetch(`${it.url}/docs/`);
		assert.equal(bare.status, 200);
		assert.equal(slashed.status, 200);
		assert.equal(await bare.text(), '<p>docs</p>');
		assert.equal(await slashed.text(), '<p>docs</p>', 'the bare path and the trailing slash are one page');
	} finally {
		await it.stop();
	}
});

test('a URL with no file gets 404.html with status 404', async () => {
	const it = await serving({ 'index.html': '<p>home</p>', '404.html': '<p>gone</p>' });
	try {
		const answer = await fetch(`${it.url}/no/such/page`);
		assert.equal(answer.status, 404);
		assert.equal(answer.headers.get('content-type'), 'text/html; charset=utf-8');
		assert.equal(await answer.text(), '<p>gone</p>');
		assert.equal(answer.headers.get('etag'), null, 'one page answers every unknown URL, so it carries no ETag');
	} finally {
		await it.stop();
	}
});

test('the shell setting answers the same URL with shell.html and status 200', async () => {
	const it = await serving(
		{ 'index.html': '<p>home</p>', '404.html': '<p>gone</p>', 'shell.html': '<p>shell</p>' },
		{ unknown: 'shell' },
	);
	try {
		const answer = await fetch(`${it.url}/tags/rust`);
		assert.equal(answer.status, 200);
		assert.equal(await answer.text(), '<p>shell</p>', 'the live shell, not the 404 page');
	} finally {
		await it.stop();
	}
});

test('with the page it names missing, the unknown answer is 404 with no body', async () => {
	const plain = await serving({ 'index.html': '<p>home</p>' });
	const shell = await serving({ 'index.html': '<p>home</p>' }, { unknown: 'shell' });
	try {
		const first = await fetch(`${plain.url}/nope`);
		assert.equal(first.status, 404);
		assert.equal(await first.text(), '');
		assert.equal(first.headers.get('content-type'), null);

		const second = await fetch(`${shell.url}/nope`);
		assert.equal(second.status, 404, 'a missing shell is 404, not a 200 with nothing in it');
		assert.equal(await second.text(), '');
	} finally {
		await plain.stop();
		await shell.stop();
	}
});

test('a dot segment and a climbing segment get the unknown answer, and never the file', async () => {
	const it = await serving({ 'index.html': '<p>home</p>', '404.html': '<p>gone</p>', '.env': 'SECRET=1' });
	const outside = join(it.dir, '..', 'aweft-static-outside.txt');
	writeFileSync(outside, 'outside');
	try {
		// A URL parser folds a bare climbing segment away before anything sees it. An encoded
		// slash is the spelling that survives it and arrives here as a real segment.
		const up = await fetch(`${it.url}/..%2Faweft-static-outside.txt`);
		assert.equal(up.status, 404);
		assert.equal(await up.text(), '<p>gone</p>', 'the file beside the directory was not served');

		const deeper = await fetch(`${it.url}/docs%2F..%2F..%2Faweft-static-outside.txt`);
		assert.equal(deeper.status, 404);
		assert.equal(await deeper.text(), '<p>gone</p>');

		const dotfile = await fetch(`${it.url}/.env`);
		assert.equal(dotfile.status, 404);
		assert.equal(await dotfile.text(), '<p>gone</p>', 'a dotfile that is there is still not a file to this');

		const under = await fetch(`${it.url}/docs/.git/config`);
		assert.equal(under.status, 404, 'a dot on any segment, not only the first');

		const broken = await fetch(`${it.url}/%ZZ`);
		assert.equal(broken.status, 404, 'a path whose escapes do not decode is not a file either');
		assert.equal(await broken.text(), '<p>gone</p>');
	} finally {
		rmSync(outside, { force: true });
		await it.stop();
	}
});

test('a symlink inside dir is followed, even to a file outside it', async () => {
	const it = await serving({ 'index.html': '<p>home</p>' });
	const outside = join(it.dir, '..', 'aweft-static-linked.txt');
	writeFileSync(outside, 'linked');
	symlinkSync(outside, join(it.dir, 'link.txt'));
	try {
		const answer = await fetch(`${it.url}/link.txt`);
		assert.equal(answer.status, 200);
		assert.equal(await answer.text(), 'linked', 'what a link may reach is settled by what goes in the directory');
	} finally {
		rmSync(outside, { force: true });
		await it.stop();
	}
});

test('a dir that is not there is a bare 404, for a refused path and an ordinary miss alike', async () => {
	// A refused path answers before the directory is reached and an ordinary miss answers after
	// finding nothing in it. Both end at the unknown page, which is missing too, so both are the
	// bare 404 that leaves. A directory that is not there is not an error to report.
	const missing = join(tmpdir(), 'aweft-static-no-such-directory', 'dist');
	const it = await boot({ dir: missing });
	try {
		for (const path of ['/.env', '/missing']) {
			const answer = await fetch(`${it.url}${path}`);
			assert.equal(answer.status, 404, `${path} is 404, and a directory that is not there is not a 500`);
			assert.equal(await answer.text(), '', `${path} carries no body`);
			assert.equal(answer.headers.get('content-type'), null, `${path} names no page`);
		}
	} finally {
		await it.stop();
	}
});

interface Answering {
	/** The answer the module built, as the server handed it to the listener. */
	ask(path: string, init?: RequestInit): Promise<Response>;
	stop(): Promise<void>;
}

/**
 * The same battery, over a listener this test holds rather than a port. An HTTP round trip
 * rebuilds the answer: a client reports a body for a HEAD it never received and reads a stream
 * and a whole buffer alike, so neither is visible from the far end of a socket.
 */
const answering = async (
	tree: Readonly<Record<string, string | Uint8Array>>,
	config: Record<string, unknown> = {},
): Promise<Answering> => {
	const dir = dirWith(tree);
	let handlers: ListenerHandlers | undefined;
	const listener: Listener = {
		start: async (given) => { handlers = given; },
		stop: async () => {},
	};
	const own = fromBundle({ './static/Files.ts': { config: { dir, ...config } } });
	const server = createServer({ sources: [own, files], gate: open, listener });
	await server.start();
	return {
		ask: async (path, init) => {
			assert.ok(handlers !== undefined, 'the server started and handed its handlers over');
			return await handlers.request(new Request(`http://app.test${path}`, init), { address: '127.0.0.1' });
		},
		stop: async () => {
			await server.stop();
			rmSync(dir, { recursive: true, force: true });
		},
	};
};

// --- how a file is served -------------------------------------------------------------------

test('HEAD carries the same headers as GET and no body', async () => {
	const it = await serving({ 'index.html': '<p>home</p>' });
	try {
		const got = await fetch(`${it.url}/`);
		const head = await fetch(`${it.url}/`, { method: 'HEAD' });
		assert.equal(head.status, 200);
		assert.deepEqual(headersOf(head), headersOf(got), 'the same headers, content-length included');
		assert.equal(await head.text(), '');
		assert.equal(await got.text(), '<p>home</p>');
	} finally {
		await it.stop();
	}
});

test('the HEAD answer holds no body, and the GET body is a stream over the file', async () => {
	const page = '<p>home</p>';
	const written = pseudoRandom(256 * 1024);
	const it = await answering({ 'index.html': page, 'big.bin': written, '404.html': '<p>gone</p>' });
	try {
		const head = await it.ask('/', { method: 'HEAD' });
		assert.equal(head.status, 200);
		assert.equal(head.headers.get('content-length'), String(new TextEncoder().encode(page).length),
			'the length the file would have carried');
		assert.equal(head.body, null, 'HEAD is the headers alone');

		const missing = await it.ask('/nope', { method: 'HEAD' });
		assert.equal(missing.status, 404);
		assert.equal(missing.body, null, 'the unknown page is a body a HEAD does not carry either');

		const got = await it.ask('/big.bin');
		assert.ok(got.body instanceof ReadableStream, 'a stream, not bytes already read');
		const reader = got.body.getReader();
		const first = await reader.read();
		assert.ok(!first.done, 'the body has a chunk to read');
		// The whole file read into one buffer arrives as one chunk of its full size; a stream over
		// the file arrives in chunks the size of a read.
		assert.ok(first.value.length < written.length,
			`a chunk of ${String(first.value.length)} bytes is the file whole, not a read of it`);

		const chunks: Uint8Array[] = [first.value];
		for (;;) {
			const next = await reader.read();
			if (next.done) break;
			chunks.push(next.value);
		}
		const read = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
		let at = 0;
		for (const chunk of chunks) {
			read.set(chunk, at);
			at += chunk.length;
		}
		assert.equal(sha256(read), sha256(written), 'every chunk, in order, is the file');
	} finally {
		await it.stop();
	}
});

test('any method but GET and HEAD is 405 with Allow, and only over a file', async () => {
	const it = await serving({ 'index.html': '<p>home</p>', '404.html': '<p>gone</p>' });
	try {
		for (const method of ['PUT', 'DELETE', 'PATCH']) {
			const answer = await fetch(`${it.url}/index.html`, { method });
			assert.equal(answer.status, 405, method);
			assert.equal(answer.headers.get('allow'), 'GET, HEAD', method);
			assert.equal(await answer.text(), '', method);
		}
		const nowhere = await fetch(`${it.url}/no/such/page`, { method: 'PUT' });
		assert.equal(nowhere.status, 404, 'a 405 there would say the URL exists, which the files decide');
		assert.equal(await nowhere.text(), '<p>gone</p>');
	} finally {
		await it.stop();
	}
});

test('under the shell setting a URL with no file gets the shell with 200, whatever the method', async () => {
	const it = await serving({ 'index.html': '<p>home</p>', 'shell.html': '<p>shell</p>' }, { unknown: 'shell' });
	try {
		const put = await fetch(`${it.url}/no/such/page`, { method: 'PUT' });
		assert.equal(put.status, 200, 'the unknown answer, for the same reason a 405 is not given there');
		assert.equal(await put.text(), '<p>shell</p>');

		const over = await fetch(`${it.url}/index.html`, { method: 'PUT' });
		assert.equal(over.status, 405, 'and a file that is there still refuses the method');
	} finally {
		await it.stop();
	}
});

test('a weak ETag rides on every file, and a request carrying it is 304 with no body', async () => {
	const it = await serving({ 'index.html': '<p>home</p>' }, { headers: { '': 'no-cache' } });
	try {
		const first = await fetch(`${it.url}/`);
		const etag = first.headers.get('etag');
		assert.ok(etag !== null && etag.startsWith('W/"'), `a weak ETag, not ${String(etag)}`);
		await first.text();

		const again = await fetch(`${it.url}/`, { headers: { 'if-none-match': etag } });
		assert.equal(again.status, 304);
		assert.equal(await again.text(), '');
		assert.equal(again.headers.get('etag'), etag);
		assert.equal(again.headers.get('cache-control'), 'no-cache',
			'a 304 still says what may be cached, and the empty prefix this test configures matches every path');
		assert.equal(again.headers.get('content-length'), null);

		const any = await fetch(`${it.url}/`, { headers: { 'if-none-match': '*' } });
		assert.equal(any.status, 304, 'a star matches any representation there is');
		await any.text();

		const strong = await fetch(`${it.url}/`, { headers: { 'if-none-match': etag.slice(2) } });
		assert.equal(strong.status, 304, 'the comparison is weak, so the same tag without its W/ is the same tag');
		await strong.text();

		const listed = await fetch(`${it.url}/`, { headers: { 'if-none-match': `W/"other", ${etag}, "third"` } });
		assert.equal(listed.status, 304, 'the header is a list and any entry matching is enough');
		await listed.text();

		const stale = await fetch(`${it.url}/`, { headers: { 'if-none-match': 'W/"something-else"' } });
		assert.equal(stale.status, 200);
		assert.equal(await stale.text(), '<p>home</p>');
	} finally {
		await it.stop();
	}
});

// The registered type per extension, written here from the registry rather than read off the
// package, so the table in the README is checked against something other than itself. The text
// types carry the charset the note says they carry.
const TEXT = '; charset=utf-8';
const REGISTERED: Readonly<Record<string, string>> = {
	html: `text/html${TEXT}`, htm: `text/html${TEXT}`, css: `text/css${TEXT}`,
	js: `text/javascript${TEXT}`, mjs: `text/javascript${TEXT}`,
	json: `application/json${TEXT}`, map: `application/json${TEXT}`,
	webmanifest: `application/manifest+json${TEXT}`, xml: `application/xml${TEXT}`,
	txt: `text/plain${TEXT}`, md: `text/markdown${TEXT}`, csv: `text/csv${TEXT}`,
	svg: `image/svg+xml${TEXT}`,
	png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
	avif: 'image/avif', ico: 'image/x-icon',
	woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
	wasm: 'application/wasm', pdf: 'application/pdf', zip: 'application/zip',
	mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', mp4: 'video/mp4', webm: 'video/webm',
};

test('the content type comes from the table, and an extension it does not name is octet-stream', async () => {
	const tree: Record<string, string> = { 'notes.rst': 'notes', 'LICENSE': 'text', 'photo.JPG': 'bytes' };
	for (const extension of Object.keys(REGISTERED)) tree[`file.${extension}`] = 'x';
	const it = await serving(tree);
	try {
		for (const [extension, type] of Object.entries(REGISTERED)) {
			assert.equal((await fetch(`${it.url}/file.${extension}`)).headers.get('content-type'), type, extension);
		}
		assert.equal((await fetch(`${it.url}/photo.JPG`)).headers.get('content-type'), 'image/jpeg',
			'the extension is read without regard to its case');
		assert.equal((await fetch(`${it.url}/notes.rst`)).headers.get('content-type'), 'application/octet-stream');
		assert.equal((await fetch(`${it.url}/LICENSE`)).headers.get('content-type'), 'application/octet-stream',
			'a name with no extension is unnamed too');
	} finally {
		await it.stop();
	}
});

test('Cache-Control is the longest matching prefix, and absent where none matches', async () => {
	const it = await serving(
		{ 'index.html': 'home', 'assets/app.js': 'app', 'assets/img/logo.png': 'png' },
		{ headers: { 'assets/': 'public, max-age=600', 'assets/img/': 'public, max-age=31536000, immutable' } },
	);
	try {
		assert.equal((await fetch(`${it.url}/assets/app.js`)).headers.get('cache-control'), 'public, max-age=600');
		assert.equal((await fetch(`${it.url}/assets/img/logo.png`)).headers.get('cache-control'),
			'public, max-age=31536000, immutable', 'the longer prefix wins wherever both match');
		assert.equal((await fetch(`${it.url}/`)).headers.get('cache-control'), null,
			'a page with no matching prefix carries no cache header at all');
	} finally {
		await it.stop();
	}
});

test('a prefix with a leading slash matches nothing, and an empty prefix matches every path', async () => {
	const slashed = await serving(
		{ 'index.html': 'home', 'assets/app.js': 'app' },
		{ headers: { '/assets/': 'public, max-age=600' } },
	);
	const every = await serving(
		{ 'index.html': 'home', 'assets/app.js': 'app' },
		{ headers: { '': 'public, max-age=60', 'assets/': 'public, max-age=600' } },
	);
	try {
		assert.equal((await fetch(`${slashed.url}/assets/app.js`)).headers.get('cache-control'), null,
			'the path is matched with its leading slash removed, so a prefix that keeps one matches nothing');

		assert.equal((await fetch(`${every.url}/`)).headers.get('cache-control'), 'public, max-age=60',
			'the empty prefix is the start of every path, which is the way to set a default');
		assert.equal((await fetch(`${every.url}/assets/app.js`)).headers.get('cache-control'), 'public, max-age=600',
			'and a longer prefix still wins over that default');
	} finally {
		await slashed.stop();
		await every.stop();
	}
});

test('a file larger than one stream chunk arrives byte-identical', async () => {
	const written = pseudoRandom(200 * 1024);
	const it = await serving({ 'assets/big.bin': written });
	try {
		const answer = await fetch(`${it.url}/assets/big.bin`);
		assert.equal(answer.status, 200);
		assert.equal(answer.headers.get('content-length'), String(written.length));
		const read = new Uint8Array(await answer.arrayBuffer());
		assert.equal(read.length, written.length);
		assert.equal(sha256(read), sha256(written), 'the same bytes, over more than three 64 KiB chunks');
	} finally {
		await it.stop();
	}
});

// --- the configuration ----------------------------------------------------------------------

test('an invalid configuration is refused at load, with the fix on the error', async () => {
	const cases: Array<readonly [string, Record<string, unknown>]> = [
		['a dir that is not a string', { dir: 42 }],
		['an empty dir', { dir: '' }],
		['an unknown that is neither word', { dir: 'dist', unknown: 'shell.html' }],
		['a public that is not a boolean', { dir: 'dist', public: 'yes' }],
		['headers that are not a table', { dir: 'dist', headers: ['assets/'] }],
		['a headers value that is not a string', { dir: 'dist', headers: { 'assets/': 600 } }],
	];
	for (const [what, config] of cases) {
		await assert.rejects(() => boot(config), (error: Error) => {
			assert.equal(reasonOf(error), 'failed', what);
			assert.equal(causeOf(error), 'invalid-config', what);
			assert.match((error.cause as Error).message, /^invalid-config: static\/Files was given /, what);
			return true;
		}, what);
	}
});

test('the defaults are the ones the note gives, and dir alone is enough to boot', async () => {
	const it = await serving({ 'index.html': '<p>home</p>', '404.html': '<p>gone</p>' });
	try {
		assert.equal(await (await fetch(`${it.url}/`)).text(), '<p>home</p>');
		const answer = await fetch(`${it.url}/nope`);
		assert.equal(answer.status, 404, 'the unknown answer is the 404 page unless it is configured otherwise');
		await answer.text();
		assert.equal((await fetch(`${it.url}/`)).headers.get('cache-control'), null, 'and no prefix carries a header');
	} finally {
		await it.stop();
	}
});

// --- the gate -------------------------------------------------------------------------------

test('public is true by default, so a gate that reads it serves a reader with no cookie', async () => {
	const it = await serving({ 'index.html': '<p>home</p>' }, {}, true);
	try {
		const answer = await fetch(`${it.url}/`);
		assert.equal(answer.status, 200);
		assert.equal(await answer.text(), '<p>home</p>');
	} finally {
		await it.stop();
	}
});

test('every answer carries nosniff: the file, the 304, the unknown page, the bare 404 and the 405', async () => {
	const it = await serving({ 'index.html': '<p>home</p>', 'notes.txt': '<script>alert(1)</script>', '404.html': '<p>gone</p>' });
	try {
		const file = await fetch(`${it.url}/notes.txt`);
		assert.equal(file.status, 200);
		assert.equal(file.headers.get('x-content-type-options'), 'nosniff', 'the file');
		const again = await fetch(`${it.url}/notes.txt`, { headers: { 'if-none-match': file.headers.get('etag')! } });
		assert.equal(again.status, 304);
		assert.equal(again.headers.get('x-content-type-options'), 'nosniff', 'the 304');
		const unknown = await fetch(`${it.url}/no/such/page`);
		assert.equal(unknown.status, 404);
		assert.equal(unknown.headers.get('x-content-type-options'), 'nosniff', 'the unknown page');
		const refused = await fetch(`${it.url}/index.html`, { method: 'PUT' });
		assert.equal(refused.status, 405);
		assert.equal(refused.headers.get('x-content-type-options'), 'nosniff', 'the 405');
	} finally {
		await it.stop();
	}
	const bare = await serving({ 'index.html': '<p>home</p>' });
	try {
		const answer = await fetch(`${bare.url}/no/such/page`);
		assert.equal(answer.status, 404);
		assert.equal(await answer.text(), '');
		assert.equal(answer.headers.get('x-content-type-options'), 'nosniff', 'the bare 404');
	} finally {
		await bare.stop();
	}
});

test('setting public to false makes the same request 403, carrying the gate\'s reasons', async () => {
	const it = await serving({ 'index.html': '<p>home</p>' }, { public: false }, true);
	try {
		const answer = await fetch(`${it.url}/`);
		assert.equal(answer.status, 403);
		assert.equal(answer.headers.get('content-type'), 'application/json');
		assert.deepEqual(await answer.json(), {
			reasons: [{ code: 'private', message: 'static/Files needs a signed-in user' }],
		}, 'a private site does not read as an empty one');
	} finally {
		await it.stop();
	}
});
