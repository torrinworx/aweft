// Pages written while the application is running, not only while it is being built.
//
// The job: a small publication. Someone publishes a post over a socket, the module that takes it
// puts the row in the store and writes that one page, and the page is live and hydrating before
// the call has answered. A scheduled full write refreshes everything, which is how the sitemap
// learns about the posts published since the last one.
//
// Run: AWEFT_DEFAULT_H=@aweftjs/ui node --import @aweftjs/build/loader recipes/posts-to-pages/main.ts

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'vite';
import { chromium } from 'playwright';
import WebSocket from 'ws';

import { createArray, createObject } from '@aweftjs/core';
import { createScheduler } from '@aweftjs/jobs';
import type { Clock, Job } from '@aweftjs/jobs';
import { createLoader, fromBundle } from '@aweftjs/modules';
import type { ModuleExports, ModuleProps } from '@aweftjs/modules';
import { createServer as createAweftServer, open } from '@aweftjs/server';
import { node } from '@aweftjs/server/node';
import { createSite } from '@aweftjs/ssg';
import type { Site as SiteHandle } from '@aweftjs/ssg';
import { createStore, memoryDriver } from '@aweftjs/store';
import { requests } from '@aweftjs/sync';
import type { SocketLike } from '@aweftjs/sync';
import { h } from '@aweftjs/ui';

import { Site } from './site.tsx';
import type { Post } from './site.tsx';

const here = fileURLToPath(new URL('.', import.meta.url));
const dist = join(here, 'dist');

// --- the bundle and the shell ---------------------------------------------------------------------

console.log('building the client bundle');
await build({ configFile: join(here, 'vite.config.ts'), logLevel: 'warn' });
const shell = readFileSync(join(dist, 'index.html'), 'utf8');

// --- the store: the posts, as a document -----------------------------------------------------------

const store = createStore({ driver: memoryDriver() });
const handle = await store.open('posts', 'array');
const rows = handle.root as Post[];

/** The rows as the page reads them: plain objects, taken fresh for every render. */
const postsNow = (): Post[] =>
	[...rows].map((row) => ({ id: String(row.id), title: String(row.title), body: String(row.body) }));

// The browser needs the same rows the render had, before it hydrates, so they are written beside
// the pages and `entry.tsx` reads them first. A component that waited on the server would otherwise
// wait again on the client and render its loading state over the finished page.
const writeRows = (): void => {
	writeFileSync(join(dist, 'posts.json'), JSON.stringify(postsNow()), 'utf8');
};

const site = createSite({
	page: (router) => h(Site, { router, posts: postsNow() }),
	shell,
	out: dist,
	base: 'https://publication.example',
});

// --- the module that publishes -----------------------------------------------------------------------

const app = fromBundle({
	// Public, because this recipe has no accounts in it. A real one puts the gate in front.
	'./posts/Publish.ts': {
		default: ({ posts, pages }: ModuleProps) => ({
			public: true,
			call: async (args: unknown) => {
				const { id, title, body } = args as Post;
				(posts as Post[]).push(createObject<Post>({ id, title, body }) as Post);
				writeRows();
				// `posts/:id` matches any id, so `ssg` cannot tell a real slug from a typo: only this
				// module knows which rows exist. The row went in above, so the page is a page.
				assert.ok([...(posts as Post[])].some((row) => String(row.id) === id), 'the row is in the store');
				// One page, not the site. A publish inside a request cannot afford to render
				// everything the site has, and the sitemap is a full write's business (design 150).
				const written = await (pages as SiteHandle).write([`/posts/${id}`]);
				return written.files;
			},
		}),
	} satisfies ModuleExports,
});

const loader = createLoader({ sources: [app], props: { posts: rows, pages: site } });
await loader.load(['posts/Publish']);

const listener = node({ port: 0, host: '127.0.0.1' });
const backend = createAweftServer({ loader, gate: open, listener });
await backend.start();

// --- publishing one post ------------------------------------------------------------------------------

writeRows();
assert.ok(!existsSync(join(dist, 'posts', 'first-light', 'index.html')), 'nothing is published yet');

const socket = new WebSocket(`ws://127.0.0.1:${listener.port!}/`);
const asks = requests(socket as unknown as SocketLike);
const files = await asks.ask('posts/Publish', {
	id: 'first-light',
	title: 'First light',
	body: 'The first post this publication ever had.',
});
assert.deepEqual(files, ['posts/first-light/index.html'], 'the module wrote exactly the page it published');

const published = readFileSync(join(dist, 'posts', 'first-light', 'index.html'), 'utf8');
assert.match(published, /<title[^>]*>First light<\/title>/, 'the page carries the post\'s title');
assert.ok(published.includes('The first post this publication ever had.'), 'and its body');
assert.ok(published.includes('data-aweft-ssg'), 'and it is stamped, so a browser takes it over');
assert.ok(!existsSync(join(dist, 'sitemap.xml')), 'and no sitemap yet: a list writes those pages and nothing else');

console.log('  a post pushed over a socket became a page');

socket.close();
await new Promise<void>((done) => { socket.once('close', () => done()); });
await backend.stop();

// --- the page, in a real browser -------------------------------------------------------------------------

const TYPES: Record<string, string> = {
	'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.xml': 'application/xml',
};

// `server`'s routes are exact, so serving a directory through it would be a route per file. A host
// serves the files; this is the smallest one that can.
const host = createServer((request, response) => {
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
await new Promise<void>((done) => host.listen(0, '127.0.0.1', done));
const port = (host.address() as { port: number }).port;

const browser = await chromium.launch();
const view = await browser.newPage();
const problems: string[] = [];
view.on('pageerror', (error) => problems.push(String(error)));

try {
	await view.goto(`http://127.0.0.1:${port}/posts/first-light`);
	await view.waitForSelector('#post');
	assert.equal(await view.textContent('#post-title'), 'First light');
	assert.equal(await view.title(), 'First light', 'the head tags in the file are the document\'s');
	// The page is live: the router takes a link click rather than the browser fetching a document.
	assert.equal(await view.getAttribute('#post', 'data-post'), 'first-light');
	assert.deepEqual(problems, [], 'and the hydration found the two renders agreeing');
	console.log('  and the page hydrates in a browser with no mismatch');
} finally {
	await browser.close();
	await new Promise<void>((done) => { host.close(() => done()); });
}

// --- the scheduled full write --------------------------------------------------------------------------

const HOUR = 3_600_000;

/** An operator's clock, so a nightly job can be watched without waiting until night. */
const driven = (start: number) => {
	let now = start;
	let id = 0;
	const timers = new Map<number, { at: number; fn: () => void }>();
	const clock: Clock = {
		now: () => now,
		setTimeout: (fn, ms) => { timers.set(++id, { at: now + ms, fn }); return id; },
		clearTimeout: (held) => { timers.delete(held as number); },
	};
	const breathe = async (): Promise<void> => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setImmediate(r)); };
	const advance = async (ms: number): Promise<void> => {
		const target = now + ms;
		for (;;) {
			let next: [number, { at: number; fn: () => void }] | undefined;
			for (const pair of timers) if (pair[1].at <= target && (next === undefined || pair[1].at < next[1].at)) next = pair;
			if (next === undefined) break;
			now = Math.max(now, next[1].at);
			timers.delete(next[0]);
			next[1].fn();
			await breathe();
		}
		now = target;
		await breathe();
	};
	return { clock, advance };
};

const { clock, advance } = driven(Date.UTC(2026, 8, 7, 3, 0));
const jobs = createArray<Job>([createObject<Job>({ kind: 'refresh', every: HOUR })]);
let refreshes = 0;
const scheduler = createScheduler({
	jobs,
	clock,
	run: async () => { refreshes += 1; writeRows(); await site.write(); },
});

await advance(HOUR);
await scheduler.stop();

assert.equal(refreshes, 1, 'the scheduled refresh ran once in the hour');
const sitemap = readFileSync(join(dist, 'sitemap.xml'), 'utf8');
assert.ok(sitemap.includes('<loc>https://publication.example/posts/first-light</loc>'),
	'and the full write put the published post in the sitemap');
assert.ok(!sitemap.includes('/missing'), 'while the noindex page stayed out of it');
assert.ok(existsSync(join(dist, '404.html')) && existsSync(join(dist, 'shell.html')),
	'and the full write is what makes the 404 and the live shell');

await store.close(handle);
await store.stop();

console.log('recipes/posts-to-pages: ok');
