// A publication whose pages are rendered on each request, with what they read handed to the
// browser.
//
// The job: a crawler that asks for a post gets the post in the markup, with the status that says
// what the URL is. A person who opens it gets a page that is live at once, and the browser does
// not ask the server again for what the page was rendered from. Nothing is written to disk but
// the bundle: every page is rendered when it is asked for.
//
// Run: AWEFT_DEFAULT_H=@aweftjs/ui node --import @aweftjs/build/loader recipes/pages-on-request/main.ts

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';
import { build } from 'vite';

import { fromDirectory } from '@aweftjs/modules/node';
import { createServer, open } from '@aweftjs/server';
import { node } from '@aweftjs/server/node';
import { files } from '@aweftjs/static';

import { called } from './modules/posts/List.ts';
import { asked } from './modules/site/Calls.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

// --- the bundle, and the server that renders the pages ----------------------------------------

console.log('building the client bundle');
await build({ configLoader: 'native', configFile: join(here, 'vite.config.ts'), logLevel: 'warn' });

const listener = node({ port: 0, host: '127.0.0.1' });
const server = createServer({
	// The application's modules first, so the pages answer before the files module does.
	sources: [fromDirectory(join(here, 'modules')), files],
	gate: open,
	listener,
});
await server.start();
const url = `http://127.0.0.1:${String(listener.port)}`;

// --- what a crawler is answered ----------------------------------------------------------------

const plain = (html: string): string => html.replace(/<!--[[\]]-->/g, '');

called.length = 0;
const index = await fetch(`${url}/`);
assert.equal(index.status, 200);
const indexHtml = await index.text();
assert.match(plain(indexHtml), /<a href="\/posts\/first-light">First light<\/a>/, 'the posts are in the markup a crawler reads');
assert.match(indexHtml, /<script type="application\/json" id="aweft-answers">/, 'and what the page read rides in its head');
assert.deepEqual(called, ['posts/List'], 'one render read the list once');

const post = await fetch(`${url}/posts/second-wind`);
assert.equal(post.status, 200);
assert.match(plain(await post.text()), /<h1 id="post-title">Second wind<\/h1>/);

const noPost = await fetch(`${url}/posts/third-time`);
assert.equal(noPost.status, 404, 'the post page said the id names nothing, so the status does');
assert.match(await noPost.text(), /<title[^>]*>No such post<\/title>/);

for (const path of ['/nowhere', '/posts/first-light/extra']) {
	const missing = await fetch(`${url}${path}`);
	assert.equal(missing.status, 404, `${path} is no page: nothing takes it whole`);
	assert.match(await missing.text(), /<title[^>]*>Not found<\/title>/, 'and the fallback act is the page it shows');
}

console.log('  the markup, the answers in the head, a 404 the page asked for, and two paths nothing takes');

// --- a person opening a post ---------------------------------------------------------------------

interface Box { readonly path: string; readonly x: number; readonly y: number; readonly width: number; readonly height: number }

interface Probe {
	readonly removed: string[];
	readonly added: string[];
	readonly before: Box[];
	shift: number;
}

const browser = await chromium.launch();
const view = await browser.newPage({ viewport: { width: 900, height: 600 } });
const problems: string[] = [];
view.on('pageerror', (error) => problems.push(String(error)));
view.on('console', (message) => { if (message.type() === 'error') problems.push(message.text()); });

// The browser objects the callbacks below reach, in narrow shapes: this file is typechecked
// without the DOM library, and Chromium supplies the real ones.
interface Element {
	readonly tagName: string;
	readonly nodeType: number;
	readonly nodeName: string;
	readonly children: ArrayLike<Element>;
	getBoundingClientRect(): { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
	contains(node: unknown): boolean;
}
interface Mutation {
	readonly target: Element;
	readonly addedNodes: Iterable<Element>;
	readonly removedNodes: Iterable<Element>;
}
interface Page {
	readonly document: {
		readonly readyState: string;
		readonly body: Element | null;
		addEventListener(type: 'readystatechange', listener: () => void): void;
	};
	readonly MutationObserver: new (callback: (records: readonly Mutation[]) => void) => {
		observe(target: unknown, options: { childList: boolean; subtree: boolean }): void;
		takeRecords(): unknown[];
	};
	readonly PerformanceObserver: new (callback: (list: { getEntries(): readonly { value?: number }[] }) => void) => {
		observe(options: { type: string; buffered: boolean }): void;
	};
	probe: Probe;
	boxes: () => Box[];
	hydrated: Promise<void>;
}

// Installed before the page's own scripts, so it is watching before the bundle runs.
await view.addInitScript(() => {
	const { document, MutationObserver, PerformanceObserver } = globalThis as never as Page;
	const removed: string[] = [];
	const added: string[] = [];
	const before: Box[] = [];
	const probe = { removed, added, before, shift: 0 };

	// Every element in the body, named by its position in the tree, with its bounding box.
	const boxes = (): Box[] => {
		const out: Box[] = [];
		const walk = (node: Element, path: string): void => {
			const box = node.getBoundingClientRect();
			out.push({ path, x: box.x, y: box.y, width: box.width, height: box.height });
			Array.from(node.children).forEach((child, at) => walk(child, `${path}/${child.tagName.toLowerCase()}[${String(at)}]`));
		};
		if (document.body !== null) walk(document.body, 'body');
		return out;
	};

	let parsed = false;
	const watcher = new MutationObserver((records) => {
		if (!parsed) return;
		for (const record of records) {
			if (document.body === null || !document.body.contains(record.target)) continue;
			for (const gone of record.removedNodes) if (gone.nodeType === 1) removed.push(gone.nodeName.toLowerCase());
			for (const put of record.addedNodes) if (put.nodeType === 1) added.push(put.nodeName.toLowerCase());
		}
	});
	watcher.observe(document, { childList: true, subtree: true });
	// The parser is done and the bundle has not run: what is on screen is what the server sent.
	document.addEventListener('readystatechange', () => {
		if (document.readyState !== 'interactive') return;
		watcher.takeRecords();
		parsed = true;
		before.push(...boxes());
	});
	new PerformanceObserver((list) => {
		for (const entry of list.getEntries()) probe.shift += entry.value ?? 0;
	}).observe({ type: 'layout-shift', buffered: true });

	const page = globalThis as never as Page;
	page.probe = probe;
	page.boxes = boxes;
});

try {
	called.length = 0;
	asked.length = 0;
	const landed = await view.goto(`${url}/posts/first-light`);
	assert.equal(landed?.status(), 200);
	await view.evaluate(() => (globalThis as never as Page).hydrated);
	assert.equal(await view.title(), 'First light');

	const probe = await view.evaluate(() => (globalThis as never as Page).probe);
	const after = await view.evaluate(() => (globalThis as never as Page).boxes());
	assert.deepEqual(called, ['posts/Read first-light'], 'the server read the post once, for the render');
	assert.deepEqual(asked, [], 'and the browser asked the server for nothing while it took the page over');
	assert.deepEqual(probe.removed, [], 'no element the server wrote was removed');
	assert.deepEqual(probe.added, [], 'and none was put in its place');
	assert.ok(probe.before.length > 3, 'the boxes were measured before the bundle ran');
	assert.deepEqual(after, probe.before, 'every box is where the server\'s markup put it');
	assert.equal(probe.shift, 0, 'and Chromium saw no layout shift');

	// The client still works: a navigation reads over the socket, because the recorded answers were
	// thrown away after the hydration.
	await view.click('#home');
	await view.waitForSelector('#index');
	assert.equal(await view.title(), 'The publication');
	assert.deepEqual(asked, ['posts/List'], 'the next page asked the server, once');

	assert.deepEqual(problems, [], 'the page threw nothing and logged no error');
	console.log('  a deep link taken over with no read asked again, no element replaced and no box moved; the next page reads live');
	console.log('recipes/pages-on-request: ok');
} finally {
	await browser.close();
	await server.stop();
}

// What this does NOT do for you. It caches nothing: every request renders, and a cache in front
// of the process is yours. It renders as nobody, so a signed-in visitor gets the page anyone
// gets, and whatever is theirs loads after the page is live. It writes no sitemap. And it renders
// one language.
