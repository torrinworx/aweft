// The routed site, proved three ways: written out as pages with no browser, taken over in place,
// and then driven in a real one.
//
// Run: node --import @aweftjs/build/loader recipes/routed-site/main.ts
// Serve it instead, to click around: npx vite recipes/routed-site

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'vite';
import { chromium } from 'playwright';

import { createDocument, parseHtml } from '@aweftjs/dom';
import { createRouter } from '@aweftjs/dom/router';
import type { LightDocument } from '@aweftjs/dom';
import { context, h, hydrate, render } from '@aweftjs/ui';

import { Site, urls } from './site.tsx';

const here = fileURLToPath(new URL('.', import.meta.url));
const dist = join(here, 'dist');

// --- one process, every page, all at once -------------------------------------------------------

console.log(`rendering ${urls.length} pages at once, one context each`);

const pages = await Promise.all(urls.map(async (wanted) => {
	const own = context();
	// No window here, so the router runs from the URL it is given and every browser effect is off.
	const router = createRouter({ url: wanted.url });
	const body = await render(h(Site, { router }), { context: own });
	return { ...wanted, body, head: own.head.markup(), css: own.theme.markup() };
}));

for (const page of pages) {
	assert.ok(page.body.includes(`id="${page.id}"`), `${page.url} rendered the act it names`);
	assert.match(page.head, new RegExp(`<title[^>]*>${page.title}</title>`), `${page.url} has its own title`);
	// The layout writes a default title outside every Head and each act overrides it from inside
	// one. Seeing the default means the override did not reach the list.
	assert.ok(!page.head.includes('>Routed site<'), `${page.url} overrode the layout's title`);
}

// Nothing one page declared shows up in another. Each page had its own render object, so this is
// the check that two renders in one process cannot see each other (aweft design 109).
for (const page of pages) {
	for (const other of pages) {
		if (other === page) continue;
		assert.ok(!page.head.includes(`>${other.title}<`), `${page.url} carries no head tag of ${other.url}`);
		assert.ok(!page.body.includes(`id="${other.id}"`), `${page.url} carries no act id of ${other.url}`);
	}
}

// The classes the theme generated. Names are minted per render from a counter that starts again on
// every page, so the six pages share names rather than having disjoint ones. What has to hold is
// that a shared name means the same thing: every class a page uses is defined in that page's own
// stylesheet, and a name two pages both use carries the same rules on both.
const rulesOf = (css: string, name: string): string =>
	css.split('\n').filter((line) => new RegExp(`\\.${name}\\b`).test(line)).join('\n');

const meanings = new Map<string, { url: string; rules: string }>();
for (const page of pages) {
	let used = 0;
	for (const found of page.body.matchAll(/class="([^"]*)"/g)) {
		for (const name of found[1]!.split(' ').filter((one) => one !== '')) {
			used += 1;
			assert.ok(page.css.includes(`.${name}`), `${page.url} defines the class ${name} it uses`);
			const rules = rulesOf(page.css, name);
			const standing = meanings.get(name);
			if (standing === undefined) meanings.set(name, { url: page.url, rules });
			else assert.equal(rules, standing.rules, `${name} means on ${page.url} what it means on ${standing.url}`);
		}
	}
	// Without this the loop above passes on a page that carries no class at all, which is what it
	// used to do: the site declared no theme and every page had nothing to check.
	assert.ok(used > 0, `${page.url} carries generated classes, so the check above checked something`);
}
assert.ok(meanings.size > 2, 'and the act with a theme of its own brought a class the layout did not');

// The nested stage is what makes these two differ: the same act above, a different act below.
const docs = pages.find((page) => page.url === '/docs')!;
const install = pages.find((page) => page.url === '/docs/install')!;
assert.ok(docs.body.includes('id="docs"') && install.body.includes('id="docs"'), 'both are under the docs act');
assert.notEqual(docs.body, install.body, 'and the child stage put a different act inside it');
assert.ok(install.body.includes('>install<'), 'the parameter reached the nested act');

console.log('  every page differs where it should and shares nothing with the others');

// --- taking over the markup in place --------------------------------------------------------------

const target = install;
const light: LightDocument = createDocument();
for (const node of parseHtml(target.body, light)) light.body.appendChild(node);
// The page a server writes carries both: the theme's stylesheet and the head tags.
for (const node of parseHtml(`<style data-aweft>${target.css}</style>${target.head}`, light)) {
	light.head.appendChild(node);
}

/** Every element under a node, in order, by identity. */
const elementsIn = (from: { firstChild: unknown; nextSibling: unknown; nodeType: number } | null): unknown[] => {
	const found: unknown[] = [];
	for (let node = from; node !== null; node = node.nextSibling as typeof node) {
		if (node.nodeType === 1) found.push(node);
		found.push(...elementsIn(node.firstChild as never));
	}
	return found;
};

const before = elementsIn(light.body.firstChild as never);
const headBefore = elementsIn(light.head.firstChild as never);
assert.ok(before.length > 0 && headBefore.length > 0, 'the server wrote a page and a head');

const made: string[] = [];
const factory = light.createElement.bind(light);
(light as unknown as Record<string, unknown>)['createElement'] = (tag: string) => {
	made.push(tag);
	return factory(tag);
};

const stop = hydrate(light.body as never, h(Site, { router: createRouter({ url: target.url }) }));

// Every element the server wrote is the same object it was: nothing was replaced, in the page or
// in the head. The head is the stricter half, and it is the one this step added: a stamped tag is
// taken over in place, so no `title`, `meta` or `link` is made at all. (The page's own elements
// are a different story: `dom` builds the client tree and pairs it with the server's, so the
// element it made is discarded rather than inserted. What matters is which one stays.)
assert.deepEqual(elementsIn(light.body.firstChild as never), before, 'every page element was adopted');
assert.deepEqual(elementsIn(light.head.firstChild as never), headBefore, 'every head tag was adopted');
assert.deepEqual(made.filter((tag) => ['title', 'meta', 'link', 'script', 'style'].includes(tag)), [],
	'and no head tag was made: the stamped ones were taken over');
assert.ok(light.body.textContent?.includes('install'), 'and the page is still the page');
stop();

console.log('  the rendered page hydrates in place, adopting every element the server wrote');

// --- the same site, in a real browser ------------------------------------------------------------

const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

/** Serve the built page, answering every path with it so a deep link loads. */
const serve = async (): Promise<{ url: string; close(): Promise<void> }> => {
	const server = createServer((request, response) => {
		const path = (request.url ?? '/').split('?')[0]!;
		const file = join(dist, normalize(path === '/' ? '/index.html' : path));
		const wanted = file.startsWith(dist) && extname(file) !== '' ? file : join(dist, 'index.html');
		try {
			const body = readFileSync(wanted);
			response.writeHead(200, { 'content-type': TYPES[extname(wanted)] ?? 'text/html' });
			response.end(body);
		} catch {
			response.writeHead(404).end();
		}
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const port = (server.address() as { port: number }).port;
	return {
		url: `http://127.0.0.1:${port}`,
		close: () => new Promise<void>((resolve) => { server.close(() => resolve()); }),
	};
};

console.log('building the site through aweft()');
await build({ configFile: join(here, 'vite.config.ts'), logLevel: 'warn' });

const site = await serve();
const browser = await chromium.launch();
const view = await browser.newPage({ viewport: { width: 900, height: 600 } });
const problems: string[] = [];
view.on('pageerror', (error) => problems.push(String(error)));

const live = (): Promise<string> => view.textContent('[aria-live]').then((text) => text ?? '');

try {
	// A deep link opens the nested act, from a cold load rather than a navigation.
	await view.goto(`${site.url}/docs/install`);
	await view.waitForSelector('#docs-page');
	assert.equal(await view.textContent('#docs-page-name'), 'install');
	assert.equal(await view.title(), 'Docs: install', 'the head tags reached the real document');

	// A click on an anchor is a navigation the router took over: no page load, new act, new title.
	await view.click('#to-post');
	await view.waitForSelector('#post');
	assert.equal(new URL(view.url()).pathname, '/posts/hello');
	assert.equal(await view.title(), 'Post hello');
	assert.equal(await live(), 'Post hello', 'the live region announced the new title');

	// Focus is on the act's root, which is what a keyboard user needs after everything changed.
	const focused = await view.evaluate(() =>
		(globalThis as unknown as { document: { activeElement: { id: string } | null } }).document.activeElement?.id ?? '');
	assert.equal(focused, 'page', 'focus is on the root of what the template rendered');

	// The query cell round trips through the URL, on the entry that was already there.
	assert.equal(await view.textContent('#query'), '{}');
	const before = view.url();
	await view.click('#sort');
	await view.waitForFunction(() => (globalThis as unknown as { location: { search: string } }).location.search === '?sort=new');
	assert.equal(await view.textContent('#query'), '{"sort":"new"}');
	await view.goBack();
	await view.waitForFunction(() => (globalThis as unknown as { location: { pathname: string } }).location.pathname === '/docs/install');
	assert.notEqual(view.url(), before, 'a query write left one entry, not two, so back went a whole page');
	await view.goForward();
	await view.waitForSelector('#post');

	// A dialog on a history entry of its own: the URL does not move, and back dismisses it.
	const url = view.url();
	await view.click('#open-dialog');
	await view.waitForSelector('#dialog');
	assert.equal(view.url(), url, 'the address bar did not move');
	assert.equal(await view.textContent('#dialog-from'), 'the post', 'the props reached the act');
	assert.equal(await view.title(), 'The dialog');
	await view.goBack();
	await view.waitForSelector('#post');
	assert.equal(view.url(), url);

	// Scroll on a long page, leave it, come back: the position is restored before paint.
	await view.click('#to-home');
	await view.waitForSelector('#home');
	await view.evaluate(() => (globalThis as unknown as { scrollTo(x: number, y: number): void }).scrollTo(0, 900));
	await view.waitForFunction(() => (globalThis as unknown as { scrollY: number }).scrollY === 900);
	// Clicked through the DOM: Playwright scrolls an element into view before clicking it, which
	// would throw away the position under test.
	await view.evaluate(() => {
		(globalThis as unknown as { document: { getElementById(id: string): { click(): void } | null } })
			.document.getElementById('to-about')!.click();
	});
	await view.waitForSelector('#about');
	assert.equal(await view.evaluate(() => (globalThis as unknown as { scrollY: number }).scrollY), 0,
		'a new act starts at the top');
	assert.equal(await view.title(), 'About', 'the lazy act arrived and brought its title');
	await view.goBack();
	await view.waitForSelector('#home');
	await view.waitForFunction(() => (globalThis as unknown as { scrollY: number }).scrollY === 900);

	// Nothing matched is the fallback, and it is a real page rather than a blank one.
	await view.click('#to-nowhere');
	await view.waitForSelector('#not-found');
	assert.equal(await view.title(), 'Not found');

	assert.deepEqual(problems, [], 'the page threw nothing');
	console.log('recipes/routed-site: ok');
} finally {
	await browser.close();
	await site.close();
}
