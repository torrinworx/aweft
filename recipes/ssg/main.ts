// A routed site written out as files, served, and taken over in a real browser.
//
// The job: a site with real URLs is built once and served by anything that can serve a directory.
// Every page is a file, the pages nobody could enumerate are still reachable, and the page a
// reader lands on is live the moment its bundle runs, without being rebuilt underneath them.
//
// Run: AWEFT_DEFAULT_H=@aweftjs/ui node --import @aweftjs/build/loader recipes/ssg/main.ts
// Serve it instead, to click around: npx vite recipes/ssg

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'vite';
import { chromium } from 'playwright';

import { createSite } from '@aweftjs/ssg';
import { h } from '@aweftjs/ui';

import { Page } from './page.tsx';

const here = fileURLToPath(new URL('.', import.meta.url));
const dist = join(here, 'dist');

// --- the client bundle, and the shell it leaves behind -------------------------------------------

console.log('building the client bundle through aweft({ defaultH })');
await build({ configFile: join(here, 'vite.config.ts'), logLevel: 'warn' });

const shell = readFileSync(join(dist, 'index.html'), 'utf8');
const site = createSite({
	page: (router) => h(Page, { router }),
	shell,
	out: dist,
	base: 'https://example.com',
});

// --- every page, written out ---------------------------------------------------------------------

const written = await site.write();

const wanted = [
	'index.html',
	'docs/index.html',
	'docs/install/index.html',
	'docs/concepts/index.html',
	'posts/hello/index.html',
	'posts/second/index.html',
	'posts/third/index.html',
	'about/index.html',
	'dialog/index.html',
	'404.html',
	'shell.html',
	'sitemap.xml',
];
for (const name of wanted) assert.ok(existsSync(join(dist, name)), `${name} was written`);
assert.deepEqual([...written.files].sort(), [...wanted].sort(), 'and nothing else was');

// `tags/:tag` declares no `entries()`, so the walk cannot say which tags exist. It reports the act
// and writes nothing for it; the live shell is what answers those URLs.
assert.deepEqual(written.unenumerated, [{ prefix: '', name: 'tags/:tag' }],
	'the one act nothing could enumerate is reported');
assert.ok(!existsSync(join(dist, 'tags')), 'and no page was invented for it');

// An act reached by `open` rather than by a URL is still a declared act, so it is still a page.
assert.ok(existsSync(join(dist, 'dialog/index.html')), 'a declared act is a page even when nothing links to it');

// The stage's `fallback` is the one act that is not. It is written once, as 404.html.
assert.ok(!existsSync(join(dist, 'missing')), 'the fallback act is not a page of its own');

console.log(`  ${written.urls.length} pages, ${written.files.length} files, 1 act reported as unenumerated`);

// --- the sitemap ------------------------------------------------------------------------------------

const sitemap = readFileSync(join(dist, 'sitemap.xml'), 'utf8');
assert.ok(sitemap.includes('<loc>https://example.com/</loc>'), 'the sitemap has the site root');
assert.ok(sitemap.includes('<loc>https://example.com/posts/hello</loc>'), 'and a page from entries()');
assert.ok(!sitemap.includes('/dialog'), 'and not the page whose head says robots noindex');
assert.ok(!sitemap.includes('404'), 'and not the fallback, which is not a URL of the site');
assert.ok(!sitemap.includes('/missing'), 'and not the fallback act under its own name either');
assert.ok(!sitemap.includes('/tags/'), 'and not an act nothing enumerated');

// --- the 404 and the live shell ---------------------------------------------------------------------

const notFound = readFileSync(join(dist, '404.html'), 'utf8');
assert.match(notFound, /<title[^>]*>Not found<\/title>/, '404.html is the fallback act, with its own title');
assert.ok(notFound.includes('data-aweft-ssg'), 'and it is a generated page, so a host that serves it hydrates');
assert.ok(!notFound.includes('_aweft-404'), 'the URL it was rendered at is nowhere in it');

assert.equal(readFileSync(join(dist, 'shell.html'), 'utf8'), shell, 'shell.html is the shell, unchanged');
assert.ok(!shell.includes('data-aweft-ssg'), 'with no stamp on it, so attach mounts it live');

// --- one page at a time, which is what a running application does ------------------------------------

const scratch = mkdtempSync(join(tmpdir(), 'aweft-ssg-one-'));
try {
	const one = createSite({ page: (router) => h(Page, { router }), shell, out: scratch });
	const partial = await one.write(['/posts/second']);
	assert.deepEqual(partial.files, ['posts/second/index.html'], 'a list writes those pages');
	assert.equal(partial.sitemap, null, 'and no sitemap, because a sitemap is about every page');
	assert.deepEqual(partial.unenumerated, [], 'and it does not walk, so it reports nothing');
	assert.ok(!existsSync(join(scratch, 'index.html')), 'and nothing else is touched');

	// A URL the site's routing does not match is refused by name rather than written out as the
	// fallback page, which would publish a "not found" page at a URL the site claims to have.
	await assert.rejects(() => one.write(['/no/such/route']),
		(error: Error & { reason?: string }) => {
			assert.equal(error.reason, 'not-a-page');
			return true;
		});
	assert.ok(!existsSync(join(scratch, 'no')), 'and nothing was written for it');

	// `posts/:id` matches any id, so a slug that names no post is a page as far as the routing is
	// concerned. What that page shows is the act's business, and no build tool can see it.
	const typo = await one.write(['/posts/a-slug-with-a-typo']);
	assert.deepEqual(typo.files, ['posts/a-slug-with-a-typo/index.html'],
		'a matched route with an unknown parameter is written, because only the act knows better');
} finally {
	rmSync(scratch, { recursive: true, force: true });
}

// --- one .tsx, two compilers -------------------------------------------------------------------------

// `banner.tsx` binds no `h` at all. The bundler was told `defaultH` in `vite.config.ts` and this
// process was told the same thing in `AWEFT_DEFAULT_H`, so both give it `ui`'s. Compiled against
// `dom`'s instead, `theme` would be written out as a literal attribute and the class would be
// missing, and the hydration below would find the two documents disagreeing.
const install = readFileSync(join(dist, 'docs/install/index.html'), 'utf8');
const banner = /<p id="banner"[^>]*>/.exec(install);
assert.ok(banner !== null, 'the banner is on the generated page');
assert.match(banner[0], /class="[^"]+"/, 'the server compiled it with ui\'s h, so theme became a class');
assert.ok(!banner[0].includes('theme='), 'and theme is not sitting on the element as an attribute');

console.log('  one .tsx with no h of its own, compiled the same way on both sides');

// --- serving the directory -------------------------------------------------------------------------

const TYPES: Record<string, string> = {
	'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.xml': 'application/xml',
};

/**
 * A host, as simply as a host can be: the exact file, then the directory's `index.html`, then the
 * live shell for a URL only the client can render, then the 404. `server`'s routes are exact, so
 * a directory would be a route per file there.
 */
const serve = async (): Promise<{ url: string; close(): Promise<void> }> => {
	const server = createServer((request, response) => {
		const path = decodeURIComponent((request.url ?? '/').split('?')[0]!);
		const asked = join(dist, normalize(path));
		const tries = asked === dist || asked.startsWith(`${dist}/`)
			? [asked, join(asked, 'index.html'), join(dist, 'shell.html'), join(dist, '404.html')]
			: [];
		for (const file of tries) {
			if (!existsSync(file) || !statSync(file).isFile()) continue;
			response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
			response.end(readFileSync(file));
			return;
		}
		response.writeHead(404).end();
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const port = (server.address() as { port: number }).port;
	return {
		url: `http://127.0.0.1:${port}`,
		close: () => new Promise<void>((resolve) => { server.close(() => resolve()); }),
	};
};

// --- the same site, in a real browser ------------------------------------------------------------

interface Probe {
	readonly removed: readonly string[];
	readonly added: readonly string[];
	readonly makes: number;
	readonly ms: number;
}

const host = await serve();
const browser = await chromium.launch();
const view = await browser.newPage({ viewport: { width: 900, height: 600 } });
const problems: string[] = [];
view.on('pageerror', (error) => problems.push(String(error)));

// Installed before the page's own scripts, so it is watching before the bundle runs.
await view.addInitScript(() => {
	const makes: number[] = [];
	const removed: string[] = [];
	const added: string[] = [];

	const real = document.createElement;
	document.createElement = (tag: string) => {
		makes.push(performance.now());
		return real.call(document, tag);
	};

	new MutationObserver((records) => {
		// While the parser is writing the page, every node it puts in is a mutation. The hydration
		// runs after that, when the document is interactive, and that is the only part this watches.
		if (document.readyState === 'loading') return;
		const body = document.body;
		if (body === null) return;
		for (const record of records) {
			if (!body.contains(record.target)) continue;
			for (const node of record.removedNodes) if (node.nodeType === 1) removed.push(node.nodeName.toLowerCase());
			for (const node of record.addedNodes) if (node.nodeType === 1) added.push(node.nodeName.toLowerCase());
		}
	}).observe(document, { childList: true, subtree: true });

	(globalThis as never as { probe: unknown }).probe = { makes, removed, added };
});

const probeOf = (): Promise<Probe> => view.evaluate(() => {
	const held = (globalThis as never as {
		probe: { makes: number[]; removed: string[]; added: string[] };
	}).probe;
	const from = performance.getEntriesByName('attach-start')[0]!.startTime;
	const to = performance.getEntriesByName('attach-end')[0]!.startTime;
	return {
		removed: held.removed,
		added: held.added,
		makes: held.makes.filter((at) => at >= from && at <= to).length,
		ms: performance.getEntriesByName('attach')[0]!.duration,
	};
});

try {
	// A deep link to a generated page, from a cold load rather than a navigation.
	await view.goto(`${host.url}/posts/hello`);
	await view.waitForSelector('#post');
	assert.equal(await view.title(), 'Post hello', 'the head tags the file carries are the document\'s');

	const probe = await probeOf();
	// Nothing the server wrote was thrown away and rebuilt. This is the whole promise of a
	// hydration: no flash, no lost scroll position, no focus taken off an element mid-read.
	assert.deepEqual(probe.removed, [], 'the hydration removed no element the server wrote');
	assert.deepEqual(probe.added, [], 'and inserted none of its own: this page has no popup sink, '
		+ 'and the live region is part of the markup the server wrote');
	console.log(`  hydrating /posts/hello: ${probe.makes} createElement calls in ${probe.ms.toFixed(1)} ms`);

	assert.match(String(await view.getAttribute('#banner', 'class')), /\S/,
		'the bundle compiled banner.tsx with ui\'s h as well');
	assert.equal(await view.getAttribute('#banner', 'theme'), null);

	// A plain onClick on the page the server wrote answers a real click.
	assert.equal(await view.textContent('#query'), '{}');
	await view.click('#sort');
	await view.waitForFunction(() =>
		(globalThis as never as { location: { search: string } }).location.search === '?sort=new');
	assert.equal(await view.textContent('#query'), '{"sort":"new"}', 'a click on the hydrated page is answered');

	// A link is a navigation the router took over: a new act and a new title, no page load.
	await view.click('#to-install');
	await view.waitForSelector('#docs-page');
	assert.equal(await view.textContent('#docs-page-name'), 'install');
	assert.equal(await view.title(), 'Docs: install', 'the act change moved the title');

	// The nested act again, this time as its own generated file.
	await view.goto(`${host.url}/docs/install`);
	await view.waitForSelector('#docs-page');
	const nested = await probeOf();
	assert.deepEqual(nested.removed, [], 'the page under a nested stage hydrates in place too');
	assert.equal(await view.textContent('#docs-page-name'), 'install');
	console.log(`  hydrating /docs/install: ${nested.makes} createElement calls in ${nested.ms.toFixed(1)} ms`);

	// The 404, as a host that has one serves it.
	await view.goto(`${host.url}/404.html`);
	await view.waitForSelector('#not-found');
	assert.equal(await view.title(), 'Not found');

	// A URL nothing enumerated: the live shell, mounted rather than hydrated, and a real page.
	const answer = await view.goto(`${host.url}/tags/rust`);
	assert.ok(!(await answer!.text()).includes('data-aweft-ssg'), 'the shell was served, with no stamp on it');
	await view.waitForSelector('#tag');
	assert.equal(await view.textContent('#tag-name'), 'rust', 'and the client rendered the act from the URL');
	assert.equal(await view.title(), 'Tag rust');

	assert.deepEqual(problems, [], 'the pages threw nothing');
	console.log('recipes/ssg: ok');
} finally {
	await browser.close();
	await host.close();
}
