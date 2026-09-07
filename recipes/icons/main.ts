// Icons, three ways, built and driven: what a page pays for each way of naming one.
//
// The job is the ordinary one: install a set, name some icons, ship the page. What makes it a
// recipe is that it weighs the result. The bundle has to hold the icons the page named and not
// the one it looked up, because that is the whole claim: naming an icon in the source is what
// keeps the set out of the page.
//
// It also serves the icon route the page fetches from, in the shape the public icon APIs answer
// in, built out of the installed set. That is the mirror an application writes when it does not
// want its readers talking to somebody else's service.
//
// Run: node --import @aweftjs/build/loader recipes/icons/main.ts
// Serve it instead, to click around: npx vite recipes/icons

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'vite';
import { chromium } from 'playwright';

import { createDocument, parseHtml, toHtml } from '@aweftjs/dom';
import type { LightDocument, LightElement, NodeLike } from '@aweftjs/dom';
import { context, h, hydrate, render, standardIcons } from '@aweftjs/ui';
import { fromUrl } from '@aweftjs/icons';

import { Site, unnamed } from './page.tsx';

const here = fileURLToPath(new URL('.', import.meta.url));
const dist = join(here, 'dist');

interface SetIcon { readonly body: string }
interface Set {
	readonly prefix: string;
	readonly icons: Record<string, SetIcon>;
	readonly aliases?: Record<string, { readonly parent: string }>;
	readonly width?: number;
	readonly height?: number;
}

const set = JSON.parse(readFileSync(
	createRequire(import.meta.url).resolve('@iconify-json/lucide/icons.json'), 'utf8',
)) as Set;

const TYPES: Record<string, string> = {
	'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
};

/**
 * The built page, plus the icon route it fetches from.
 *
 * `/icons/<set>.json?icons=<name>` answers `{ prefix, icons, width, height }`, which is the shape
 * the page's resolver reads. Nothing about it is aweft's: it is the shape the services already
 * answer in, which is what makes a mirror a route rather than a port.
 */
const serve = async (): Promise<{ url: string; asked: string[]; close(): Promise<void> }> => {
	const asked: string[] = [];
	const server = createServer((request, response) => {
		const url = new URL(request.url ?? '/', 'http://127.0.0.1');

		if (url.pathname.startsWith('/icons/')) {
			const wanted = url.searchParams.get('icons') ?? '';
			asked.push(wanted);
			const found = set.icons[wanted];
			response.writeHead(200, { 'content-type': 'application/json' });
			response.end(JSON.stringify({
				prefix: set.prefix,
				icons: found === undefined ? {} : { [wanted]: found },
				width: set.width,
				height: set.height,
			}));
			return;
		}

		const file = join(dist, normalize(url.pathname === '/' ? '/index.html' : url.pathname));
		if (!file.startsWith(dist)) {
			response.writeHead(403).end();
			return;
		}
		try {
			const body = readFileSync(file);
			response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
			response.end(body);
		} catch {
			response.writeHead(404).end();
		}
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const port = (server.address() as { port: number }).port;
	return {
		url: `http://127.0.0.1:${port}`,
		asked,
		close: () => new Promise<void>((resolve) => { server.close(() => resolve()); }),
	};
};

/** The `d` of an icon's first path, which is what a bundle either carries or does not. */
const drawingOf = (name: string): string => {
	const found = set.icons[name];
	assert.ok(found !== undefined, `the installed set has ${name}`);
	const path = /d="([^"]+)"/.exec(found.body);
	assert.ok(path !== null, `${name} is drawn with a path`);
	return path[1]!;
};

/** Every element under a node, in order, by identity. */
const elementsIn = (from: NodeLike | null): NodeLike[] => {
	const found: NodeLike[] = [];
	for (let node = from; node !== null; node = node.nextSibling) {
		if (node.nodeType === 1) found.push(node);
		found.push(...elementsIn(node.firstChild));
	}
	return found;
};

/**
 * The page's own elements: everything outside an `<svg>`, and each `<svg>` itself. What is inside
 * one is the icon's group and the drawing in it, and a hydration replaces the drawing rather than
 * adopting it (design 131), so the two are counted apart.
 */
const pageElements = (from: NodeLike | null): NodeLike[] => {
	const found: NodeLike[] = [];
	for (let node = from; node !== null; node = node.nextSibling) {
		if (node.nodeType !== 1) continue;
		found.push(node);
		if ((node as unknown as LightElement).localName === 'svg') continue;
		found.push(...pageElements(node.firstChild));
	}
	return found;
};

console.log('building the page through aweft()');
await build({ configFile: join(here, 'vite.config.ts'), logLevel: 'warn' });

const site = await serve();

// --- what the bundle carries ---------------------------------------------------------------

const scripts = readdirSync(join(dist, 'assets')).filter((name) => name.endsWith('.js'));
assert.equal(scripts.length, 1, 'one page, one script');
const bundle = readFileSync(join(dist, 'assets', scripts[0]!), 'utf8');

// Which of the set's icons are in the bundle, asked of the set rather than of the page: every
// icon that is drawn with a path, looked for by that path. A page that named ten icons has to
// carry ten, and the one it looks up at run time has to be absent, or naming icons bought
// nothing.
const wanted = [...new Set(['check', 'star', ...standardIcons])].sort();
const carried = Object.entries(set.icons)
	.flatMap(([name, icon]) => {
		const path = /d="([^"]+)"/.exec(icon.body);
		return path !== null && bundle.includes(path[1]!) ? [name] : [];
	})
	.sort();

assert.deepEqual(carried, wanted, 'the bundle carries the icons the page named, and no others');
assert.ok(!carried.includes(unnamed.slice('lucide:'.length)),
	'and not the icon the page only asks for when it runs');

const iconBytes = carried.reduce((n, name) => n + JSON.stringify(set.icons[name]).length, 0);
const wholeSet = readFileSync(
	createRequire(import.meta.url).resolve('@iconify-json/lucide/icons.json'), 'utf8',
).length;
console.log(`  bundle ${String(bundle.length)} bytes, of which ${String(iconBytes)} is icon data`);
console.log(`  ${String(carried.length)} icons of the set's ${String(Object.keys(set.icons).length)}; `
	+ `the whole set is ${String(wholeSet)} bytes`);
assert.ok(iconBytes * 20 < wholeSet, 'the icons the page carries are a fraction of the set');

// --- the same page with no browser at all ------------------------------------------------------

const own = context();
const markup = await render(h(Site, { icons: fromUrl(`${site.url}/icons`) }), { context: own });

assert.match(markup, new RegExp(drawingOf('check')), 'the named icon is in the markup');
assert.match(markup, new RegExp(drawingOf('chevron-down')), 'and so is the standard one');
assert.match(markup, new RegExp(drawingOf('anchor').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
	'and the render waited for the one it had to fetch');
assert.deepEqual(site.asked, ['anchor'], 'one name was fetched, and it is the one the page named late');

console.log('  the page renders to markup with no browser, fetch included');

// --- taking over that markup in place -----------------------------------------------------------

const page: LightDocument = createDocument();
for (const node of parseHtml(markup, page)) page.body.appendChild(node as LightElement);
for (const node of parseHtml(`<style data-aweft>${own.theme.markup()}</style>`, page)) {
	page.head.appendChild(node as LightElement);
}

const before = pageElements(page.body.firstChild);
const svgs = before.filter((node) => (node as unknown as LightElement).localName === 'svg');
assert.equal(svgs.length, 5, 'five icons on the page');
/** The icon's group, which `Icon` builds through `dom` and a hydration therefore adopts. */
const groupOf = (svg: NodeLike): NodeLike => {
	const group = elementsIn(svg.firstChild)[0];
	assert.ok(group !== undefined, 'an icon has a group inside it');
	return group;
};

const groupsBefore = svgs.map(groupOf);
// What the `body` parsed to. These nodes never went through `dom`'s factory, so they are the one
// thing a hydration cannot pair (design 131).
const drawnBefore = svgs.flatMap((svg) => elementsIn(groupOf(svg).firstChild));
assert.ok(drawnBefore.length >= svgs.length, 'each icon has a drawing inside it');

const made: string[] = [];
const factory = page.createElement.bind(page);
(page as unknown as Record<string, unknown>)['createElement'] = (tag: string) => {
	made.push(tag);
	return factory(tag);
};

// A server that fetched an icon has to hand the answer to the client. A hydration does not wait
// for anything, so a page taken over with the resolver still in front of it starts one drawing
// short of the markup it is taking over, and `dom` says so. What an application ships instead is
// what its server resolved, as a pack.
const resolved = { prefix: set.prefix, icons: { anchor: set.icons['anchor']! }, width: set.width, height: set.height };
const stop = hydrate(page.body as never, h(Site, { icons: resolved }));

// Every element the server wrote is the object it was, checked by identity: two elements with the
// same attributes are equal and are still two elements, so only `===` can tell an adoption from a
// rebuild. The drawings inside each `<svg>` are the exception, and they are the client's, which is
// what design 131 says a body written as markup costs.
const after = pageElements(page.body.firstChild);
assert.equal(after.length, before.length, 'the page has the elements the server wrote, and no more');
for (let at = 0; at < before.length; at += 1) {
	assert.ok(after[at] === before[at],
		`element ${String(at)} (<${(before[at] as unknown as LightElement).localName}>) is the server's own object`);
}
assert.deepEqual(svgs.map(groupOf), groupsBefore, 'each icon\'s group is the server\'s too');
const drawnAfter = svgs.flatMap((svg) => elementsIn(groupOf(svg).firstChild));
assert.equal(drawnAfter.length, drawnBefore.length, 'each icon still has its drawing');
assert.ok(drawnAfter.every((node, at) => node !== drawnBefore[at]),
	'and every node of the drawing is the client\'s, put where the server\'s was');
assert.equal(made.filter((tag) => tag === 'svg').length, 0, 'and no <svg> was made through the document');

assert.equal(toHtml(page.body.childNodes), markup, 'and the page is the page the server sent');
assert.deepEqual(site.asked, ['anchor'], 'the client fetched nothing: it was handed what the server got');
stop();

console.log('  the rendered page hydrates in place, adopting every element the server wrote');

// --- the same page in a real browser -------------------------------------------------------------

const browser = await chromium.launch();
const view = await browser.newPage({ viewport: { width: 900, height: 700 } });
const problems: string[] = [];
view.on('pageerror', (error) => problems.push(String(error)));

try {
	await view.goto(`${site.url}/`);
	await view.waitForSelector('#icon-fetched path');

	const drawn = await view.evaluate(() => Object.fromEntries(
		['icon-named', 'icon-named-big', 'icon-standard', 'icon-fetched']
			.map((id) => [id, document.querySelector(`#${id} path`)?.getAttribute('d') ?? null]),
	)) as Record<string, string | null>;

	assert.equal(drawn['icon-named'], drawingOf('check'), 'the icon named in the source drew');
	assert.equal(drawn['icon-named-big'], drawingOf('star'), 'including a name no standard list has');
	assert.equal(drawn['icon-standard'], drawingOf('triangle-alert'), 'the standard name drew');
	assert.equal(drawn['icon-fetched'], drawingOf('anchor'), 'and the one fetched by name drew');

	const inside = await view.evaluate(() => {
		const svg = document.querySelector('#icon-named');
		return { box: svg?.getAttribute('viewBox') ?? null, fill: svg?.getAttribute('fill') ?? null };
	});
	assert.equal(inside.box, '0 0 24 24', 'the set\'s root size is the box every icon is drawn in');
	assert.equal(inside.fill, 'currentColor');

	const button = await view.evaluate(() =>
		document.querySelector('#button-standard svg') !== null);
	assert.ok(button, 'a standard name inside a component resolved through the pack the page put up');

	assert.deepEqual(problems, [], 'the page ran without an error');
} finally {
	await browser.close();
	await site.close();
}

console.log('  every icon drew in Chromium, from all three ways of naming one');

console.log('\nwhat this recipe does NOT do for you:');
console.log('  it does not choose your set. `npm install @iconify-json/<set>` is yours, and a set');
console.log('  that is not installed is a refusal at build time saying exactly that.');
console.log('  it does not cache the fetched names. A name you know at build time should be');
console.log('  written out, and then nothing is fetched at all.');
console.log('  it does not decide what a standard name draws. A pack in front of `Icons` wins,');
console.log('  which is how you give `chevron-down` a drawing of your own.');
console.log('  it does not carry a fetched icon across a hydration for you. A page whose server');
console.log('  fetched an icon has to ship what the server got, as a pack, or the client starts');
console.log('  a drawing short of the markup it is taking over.');
