// A generated site served by the stack's own server, in one process.
//
// The job: the site from `recipes/ssg` is built and written out, and then the same program that
// wrote it is the host that serves it. There is no second server in front, no host configuration,
// and the reader still lands on a real file that comes alive where it stands.
//
// Run: AWEFT_DEFAULT_H=@aweftjs/ui node --import @aweftjs/build/loader recipes/static/main.ts

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'vite';
import { chromium } from 'playwright';

import { fromBundle } from '@aweftjs/modules';
import { fromDirectory } from '@aweftjs/modules/node';
import { createServer, open } from '@aweftjs/server';
import { node } from '@aweftjs/server/node';
import { createSite } from '@aweftjs/ssg';
import { files } from '@aweftjs/static';
import { h } from '@aweftjs/ui';

import { Page } from '../ssg/page.tsx';

const here = fileURLToPath(new URL('.', import.meta.url));
const ssg = fileURLToPath(new URL('../ssg/', import.meta.url));
const dist = join(here, 'dist');

// --- the site, built and written out ----------------------------------------------------------

// The bundle is `recipes/ssg`'s, built through its own config with the output sent here, so this
// recipe writes nothing into the directory that one owns.
console.log('building the client bundle and writing the pages');
await build({
	configFile: join(ssg, 'vite.config.ts'),
	logLevel: 'warn',
	build: { outDir: dist, emptyOutDir: true },
});

const site = createSite({
	page: (router) => h(Page, { router }),
	shell: readFileSync(join(dist, 'index.html'), 'utf8'),
	out: dist,
	base: 'https://example.com',
});
const written = await site.write();
console.log(`  ${String(written.urls.length)} pages, ${String(written.files.length)} files in ${dist}`);

// --- the same directory, served by the stack's own server -------------------------------------

/**
 * A server over the pages. `sources` is the application's own modules directory and the battery;
 * `over` is listed ahead of both, so its `config` wins the merge and the second server here is
 * the first one with one word changed.
 */
const boot = async (over: Record<string, unknown> = {}): Promise<{ url: string; stop(): Promise<void> }> => {
	const listener = node({ port: 0, host: '127.0.0.1' });
	const server = createServer({
		sources: [fromBundle({ './static/Files.ts': { config: over } }), fromDirectory(join(here, 'modules')), files],
		gate: open,
		listener,
	});
	await server.start();
	return { url: `http://127.0.0.1:${String(listener.port)}`, stop: () => server.stop() };
};

const host = await boot();
const shellHost = await boot({ unknown: 'shell' });

// The headers Node writes for itself, which are not this battery's answer.
const TRANSPORT = new Set(['connection', 'keep-alive', 'date']);

const headersOf = (answer: Response): Record<string, string> => {
	const held: Record<string, string> = {};
	answer.headers.forEach((value, name) => { if (!TRANSPORT.has(name)) held[name] = value; });
	return held;
};

// --- what the host answers ---------------------------------------------------------------------

const page = await fetch(`${host.url}/posts/hello`);
assert.equal(page.status, 200, 'a generated page is served at its own URL');
assert.equal(page.headers.get('content-type'), 'text/html; charset=utf-8');
const markup = await page.text();
assert.ok(markup.includes('data-aweft-ssg'), 'and it is the generated file, stamped for a hydration');

const head = await fetch(`${host.url}/posts/hello`, { method: 'HEAD' });
assert.equal(head.status, 200);
assert.deepEqual(headersOf(head), headersOf(page), 'HEAD carries the same headers');
assert.equal(await head.text(), '', 'and no body');

const etag = page.headers.get('etag');
assert.ok(etag !== null && etag.startsWith('W/"'), `a weak ETag, not ${String(etag)}`);
const repeat = await fetch(`${host.url}/posts/hello`, { headers: { 'if-none-match': etag } });
assert.equal(repeat.status, 304, 'a reader who already has the page is answered with headers alone');
assert.equal(await repeat.text(), '');

const missing = await fetch(`${host.url}/nope`);
assert.equal(missing.status, 404, 'a URL with no file says so with the status that means it');
assert.match(await missing.text(), /<title[^>]*>Not found<\/title>/, 'and the fallback act is the page it shows');

// A URL parser folds a bare climbing segment away, so the spelling that reaches a host at all is
// the encoded one. Neither it nor a dot path is ever a file here.
const climbing = await fetch(`${host.url}/..%2Fpackage.json`);
assert.equal(climbing.status, 404, 'a climbing path is not a file');
await climbing.text();
const dotted = await fetch(`${host.url}/.git/config`);
assert.equal(dotted.status, 404, 'and neither is a dot path');
await dotted.text();

const sitemap = await fetch(`${host.url}/sitemap.xml`);
assert.equal(sitemap.status, 200);
assert.ok(String(sitemap.headers.get('content-type')).startsWith('application/xml'), 'the sitemap is served as XML');
assert.ok((await sitemap.text()).includes('<loc>https://example.com/posts/hello</loc>'));

const shellAnswer = await fetch(`${shellHost.url}/nope`);
assert.equal(shellAnswer.status, 200, 'the same URL under the shell setting is a page, not a miss');
assert.ok(!(await shellAnswer.text()).includes('data-aweft-ssg'), 'and it is the plain shell, with no stamp on it');

console.log('  the exact file, HEAD, the 304, the 404, the climbing and dot paths, the sitemap, the shell');

// --- the same site, in a real browser -----------------------------------------------------------

interface Probe {
	readonly removed: readonly string[];
	readonly added: readonly string[];
}

const browser = await chromium.launch();
const view = await browser.newPage({ viewport: { width: 900, height: 600 } });
const problems: string[] = [];
view.on('pageerror', (error) => problems.push(String(error)));

// Installed before the page's own scripts, so it is watching before the bundle runs.
await view.addInitScript(() => {
	const removed: string[] = [];
	const added: string[] = [];

	new MutationObserver((records) => {
		// While the parser is writing the page every node it puts in is a mutation. The hydration
		// runs after that, when the document is interactive, and that is the only part this watches.
		if (document.readyState === 'loading') return;
		const body = document.body;
		if (body === null) return;
		for (const record of records) {
			if (!body.contains(record.target)) continue;
			for (const gone of record.removedNodes) if (gone.nodeType === 1) removed.push(gone.nodeName.toLowerCase());
			for (const put of record.addedNodes) if (put.nodeType === 1) added.push(put.nodeName.toLowerCase());
		}
	}).observe(document, { childList: true, subtree: true });

	(globalThis as never as { probe: unknown }).probe = { removed, added };
});

const probeOf = (): Promise<Probe> => view.evaluate(() =>
	(globalThis as never as { probe: Probe }).probe);

try {
	// A deep link to a generated page, from a cold load rather than a navigation.
	const landed = await view.goto(`${host.url}/posts/hello`);
	assert.equal(landed?.status(), 200);
	await view.waitForSelector('#post');
	assert.equal(await view.title(), 'Post hello', 'the head tags the served file carries are the document\'s');

	const probe = await probeOf();
	// Nothing the server wrote was thrown away and rebuilt. That is the whole promise of serving a
	// generated page: no flash, no lost scroll position, no focus taken off an element mid-read.
	assert.deepEqual(probe.removed, [], 'the hydration removed no element the server wrote');
	assert.deepEqual(probe.added, [], 'and replaced none of them with one of its own');

	// A link is a navigation the router took over: a new act and a new title, no page load.
	await view.click('#to-install');
	await view.waitForSelector('#docs-page');
	assert.equal(await view.title(), 'Docs: install', 'the act change moved the title');

	// The unknown answer, as a reader meets it: the fallback page, at the status that means it.
	const notFound = await view.goto(`${host.url}/nope`);
	assert.equal(notFound?.status(), 404);
	await view.waitForSelector('#not-found');
	assert.equal(await view.title(), 'Not found');

	// The same URL from the second server: the plain shell, mounted live rather than hydrated.
	const shelled = await view.goto(`${shellHost.url}/nope`);
	assert.equal(shelled?.status(), 200, 'the shell setting answers with a page');
	await view.waitForSelector('#not-found');
	assert.equal(await view.title(), 'Not found', 'and the client rendered the act from the URL');

	assert.deepEqual(problems, [], 'the pages threw nothing');
	console.log('  a deep link hydrates in place, a link changes the act, the 404 and the shell both render');
	console.log('recipes/static: ok');
} finally {
	await browser.close();
	await host.stop();
	await shellHost.stop();
}

// What this does NOT do for you. It keeps nothing in memory, so a hot page is read from disk on
// every request that does not carry its ETag; it compresses nothing; and it answers no range, so
// seeking inside a video is not something this serves. A separate host in front is still an
// option, and everything above is unchanged by putting one there: nothing here decides what the
// generator writes.
