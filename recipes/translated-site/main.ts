// A site written in one language, built once, written out in three, and taken over in a real
// browser in each (designs 277, 278, 279).
//
// The job: launch a site in English, French and Ukrainian at once. The build finds every string
// the pages show and writes the source catalog an agent fills; the same page component renders
// each language from its catalog; a static host serves the three trees; a reader who lands on the
// Ukrainian page gets Ukrainian from the first byte, and the page is live the moment its bundle
// runs. One act arrives from a document rather than a file, compiled where it runs.
//
// Run: AWEFT_DEFAULT_H=@aweftjs/ui AWEFT_TEXT=1 node --import @aweftjs/build/loader recipes/translated-site/main.ts

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'vite';
import { chromium } from 'playwright';

import { createSite } from '@aweftjs/ssg';
import { h } from '@aweftjs/ui';
import type { Catalog } from '@aweftjs/ui';

import { Site, sourcesWith } from './site.tsx';
import { compileWith, storedKeys } from './stored.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const dist = join(here, 'dist');
const read = (...rest: string[]): string => readFileSync(join(dist, ...rest), 'utf8');
const catalogOf = (tag: string): Catalog => JSON.parse(readFileSync(join(here, 'text', `${tag}.json`), 'utf8')) as Catalog;

// --- the bundle, and the source catalog the build writes ------------------------------------------

console.log('building the client bundle through aweft({ defaultH, text })');
const warned: string[] = [];
const warn = console.warn;
console.warn = (line: unknown): void => { warned.push(String(line)); };
try {
	await build({ configFile: join(here, 'vite.config.ts'), logLevel: 'warn' });
} finally {
	console.warn = warn;
}

const source = JSON.parse(readFileSync(join(here, 'text', 'source.json'), 'utf8')) as Record<string, string[]>;
const own = Object.entries(source).filter(([, files]) => files.some((file) => !file.startsWith('@aweftjs/')));
const expected = [
	'Translated site', 'Home', 'About', 'Notes', 'Welcome', 'A photo of the team', 'Save now', 'Save', 'Name',
	'Your name', 'Read <link>the docs</link> first', '{n, plural, one {# item} other {# items}}',
	'Written once, shown in three languages.', 'This line has no French entry', 'Not found', 'Nothing here.',
];
assert.deepEqual(own.map(([key]) => key).sort(), [...expected].sort(), 'every string the pages show is in the source catalog, once');
for (const machine of ['page', 'nav', 'to-home', 'p1', 'save', 'name', 'button', 'data:image/gif;base64,R0lGODlhAQABAAAAACw=']) {
	assert.ok(!(machine in source), `${machine} is a word for the machine and is not in the catalog`);
}
assert.ok(!('3' in source) && !("text('Save')" in source), 'no letters, and translate="no", stay out');
assert.deepEqual(source['Save'], ['site.tsx'], 'a key names the file it came from');
assert.ok(source['Previous']?.includes('@aweftjs/ui/text.json'), 'the library\'s own strings are folded in');
assert.ok(source['Sign in']?.includes('@aweftjs/auth/text.json'));

// The stored act's strings are not in the source catalog: they were never in a file the bundle
// read. They are what the transform answered when the source was stored, kept beside it.
assert.deepEqual(storedKeys(), ['Notes from the store', 'This act was stored as text and compiled where it ran.', 'Notes']);
assert.ok(!('Notes from the store' in source));

// The build's own report, for the two catalogs beside the source: French lacks the one string
// the pages show and it has no entry for, and holds one entry nothing uses. The stored act's two
// strings are in both catalogs and the build reports them unused as well: it reads files, and
// those strings were never in one. The write below, which reads what rendered, knows better.
const french = warned.find((line) => line.startsWith('aweft text: text/fr.json'));
assert.ok(french !== undefined, `the build said what French lacks: ${warned.join(' | ')}`);
assert.match(french, /lacks 1: "This line has no French entry"/);
assert.match(french, /holds 3 nothing uses: "An old entry", "Notes from the store", "This act was stored/);
assert.ok(!warned.some((line) => line.startsWith('aweft text: text/uk.json lacks')), 'Ukrainian lacks nothing the files show');
console.log(`  ${own.length} strings of the site's own in text/source.json, ${Object.keys(source).length} with the library's`);

// --- every page, in three languages ----------------------------------------------------------------

const bridge = import.meta.resolve('@aweftjs/ui');
const shell = readFileSync(join(dist, 'index.html'), 'utf8');
const site = createSite({
	page: (router) => h(Site, { router, sources: sourcesWith(compileWith(bridge)) }),
	shell,
	out: dist,
	base: 'https://example.com',
	locale: 'en',
	locales: { fr: catalogOf('fr'), uk: catalogOf('uk') },
});

const written = await site.write();
const perLanguage = ['index.html', 'about/index.html', 'notes/index.html', '404.html', 'shell.html'];
const wanted = [
	...perLanguage,
	...perLanguage.map((name) => `fr/${name}`),
	...perLanguage.map((name) => `uk/${name}`),
	'sitemap.xml',
];
assert.deepEqual([...written.files].sort(), [...wanted].sort(), 'three trees and one sitemap');
assert.deepEqual(written.urls, ['/', '/about', '/notes', '/fr', '/fr/about', '/fr/notes', '/uk', '/uk/about', '/uk/notes']);
// The write's report reads what rendered: the stored act's strings were looked up, so they are
// not unused here, and the library's strings were not, because no page shows a pagination or a
// sign-in form, so every one of them is.
const library = ['@aweftjs/ui/text.json', '@aweftjs/auth/text.json']
	.flatMap((name) => Object.keys(JSON.parse(readFileSync(fileURLToPath(import.meta.resolve(name)), 'utf8')) as Record<string, unknown>))
	.sort();
assert.deepEqual(written.text, {
	fr: { missing: ['This line has no French entry'], unused: ['An old entry', ...library].sort() },
	uk: { missing: [], unused: library },
}, 'the write\'s report is about what rendered');

const home = { en: read('index.html'), fr: read('fr', 'index.html'), uk: read('uk', 'index.html') };
assert.match(home.en, /<html lang="en">/);
assert.match(home.fr, /<html lang="fr">/);
assert.match(home.uk, /<html lang="uk">/);
for (const page of Object.values(home)) assert.ok(!page.includes('dir='), 'none of the three runs right to left');

// The French page is French: the heading, the title, the placeholder, the alt, the button, the
// sentence with the link in it, and the plural, with the modifier wrapping the French word.
assert.match(home.fr, /<title[^>]*>Accueil<\/title>/);
assert.match(home.fr, /id="welcome"[^>]*>(<!--\[-->)?Bienvenue/);
assert.match(home.fr, /placeholder="Votre nom"/);
assert.match(home.fr, /alt="Une photo de l&#39;équipe"|alt="Une photo de l'équipe"/);
assert.match(home.fr, /Lisez d&#39;abord <a id="docs-link" href="\/fr\/about">|Lisez d'abord <a id="docs-link" href="\/fr\/about">/);
assert.match(home.fr, /la documentation<\/a>/);
assert.match(home.fr, /1 élément/);
assert.match(home.fr, /Enregistrer <b id="now">maintenant<\/b>/, 'the modifier ran over the translated string');
assert.match(home.fr, /href="\/fr\/about"[^>]*>(<!--\[-->)?À propos/, 'a nav link carries the base and the translation');
// English stays only where the page said so.
assert.match(home.fr, /<code>text\('Save'\)<\/code> is the call the build writes/, 'translate="no" kept its subtree');
for (const english of ['Welcome', 'Your name', 'Save now', 'Read <a', 'the docs', 'A photo of the team', '>Home<', '>About<']) {
	assert.ok(!home.fr.includes(english), `${JSON.stringify(english)} is not on the French page`);
}
assert.match(home.uk, /3 елементи|1 елемент/, 'the Ukrainian plural');
assert.match(read('uk', 'notes', 'index.html'), /Нотатки зі сховища/, 'the stored act rendered in Ukrainian on the server');
assert.match(read('about', 'index.html'), /This line has no French entry/);
assert.match(read('fr', 'about', 'index.html'), /This line has no French entry/, 'a missing entry shows the source');

// The alternates, in every head and in the sitemap.
for (const page of ['index.html', 'fr/index.html', 'uk/about/index.html']) {
	const held = read(...page.split('/'));
	assert.match(held, /<link rel="alternate" hreflang="en" href="https:\/\/example.com\/[^"]*">/);
	assert.match(held, /<link rel="alternate" hreflang="uk" href="https:\/\/example.com\/uk[^"]*">/);
	assert.match(held, /<link rel="alternate" hreflang="x-default" href="https:\/\/example.com\/[^"]*">/);
}
const sitemap = read('sitemap.xml');
assert.match(sitemap, /<loc>https:\/\/example.com\/uk\/about<\/loc>\n\t\t<xhtml:link rel="alternate" hreflang="en" href="https:\/\/example.com\/about"\/>/);
assert.equal((sitemap.match(/<loc>/g) ?? []).length, 9, 'nine pages, every language');

// A site with no language shows the source everywhere: the same page, apart from the language.
const plain = createSite({ page: (router) => h(Site, { router, sources: sourcesWith(compileWith(bridge)) }), shell, out: dist });
const bare = (await plain.page('/')).html;
const english = (await site.page('/')).html.replace(/<link rel="alternate"[^>]*>/g, '');
assert.equal(bare, english, 'with no locale, the page is the English page with no alternates');
assert.match(bare, /Welcome/);
console.log(`  ${written.urls.length} pages in three languages, French lacks 1 and holds 1 unused`);

// --- serving the directory --------------------------------------------------------------------------

const TYPES: Record<string, string> = {
	'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.xml': 'application/xml', '.json': 'application/json',
};

/** The exact file, then the directory's index, then the language's live shell, then its 404. */
const serve = async (): Promise<{ url: string; close(): Promise<void> }> => {
	const server = createServer((request, response) => {
		const path = decodeURIComponent((request.url ?? '/').split('?')[0]!);
		const asked = join(dist, normalize(path));
		const language = /^\/(fr|uk)(\/|$)/.exec(path)?.[1];
		const own = language === undefined ? dist : join(dist, language);
		const tries = asked === dist || asked.startsWith(`${dist}/`)
			? [asked, join(asked, 'index.html'), join(own, 'shell.html'), join(own, '404.html')]
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

// --- the same site, in a real browser --------------------------------------------------------------

interface Probe {
	readonly removed: readonly string[];
	readonly added: readonly string[];
}

const host = await serve();
const browser = await chromium.launch();
const view = await browser.newPage({ viewport: { width: 900, height: 600 } });
const problems: string[] = [];
view.on('pageerror', (error) => problems.push(String(error)));

await view.addInitScript(() => {
	const removed: string[] = [];
	const added: string[] = [];
	new MutationObserver((records) => {
		if (document.readyState === 'loading') return;
		const body = document.body;
		if (body === null) return;
		for (const record of records) {
			if (!body.contains(record.target)) continue;
			for (const node of record.removedNodes) if (node.nodeType === 1) removed.push(node.nodeName.toLowerCase());
			for (const node of record.addedNodes) if (node.nodeType === 1) added.push(node.nodeName.toLowerCase());
		}
	}).observe(document, { childList: true, subtree: true });
	(globalThis as never as { probe: unknown }).probe = { removed, added };
});

const probeOf = (): Promise<Probe> => view.evaluate(() =>
	(globalThis as never as { probe: Probe }).probe);

try {
	// A deep link to the Ukrainian page, from a cold load.
	await view.goto(`${host.url}/uk/`);
	await view.waitForSelector('#home');
	await view.waitForFunction(() => (globalThis as never as { performance: { getEntriesByName(name: string): unknown[] } }).performance.getEntriesByName('attach-end').length > 0);
	assert.equal(await view.title(), 'Головна', 'the Ukrainian title from the first byte');
	assert.equal(await view.textContent('#welcome'), 'Ласкаво просимо');
	const probe = await probeOf();
	assert.deepEqual(probe.removed, [], 'the hydration removed no element the server wrote');
	assert.deepEqual(probe.added, [], 'and inserted none of its own');
	assert.equal(await view.getAttribute('#name-input, #name input, input[placeholder]', 'placeholder'), 'Ваше ім\'я');

	// The plural follows the cell through the categories Ukrainian has and English does not.
	assert.equal(await view.textContent('#items'), '1 елемент');
	await view.click('#three');
	assert.equal(await view.textContent('#items'), '3 елементи', 'few');
	await view.click('#five');
	assert.equal(await view.textContent('#items'), '5 елементів', 'many');

	// A link inside the translated sentence is a navigation the router took over, in Ukrainian.
	await view.click('#docs-link');
	await view.waitForSelector('#about');
	assert.equal(await view.title(), 'Про нас');
	assert.ok((await view.evaluate(() => (globalThis as never as { location: { pathname: string } }).location.pathname)) === '/uk/about');
	assert.equal(await view.textContent('#about-line'), 'Написано один раз, показано трьома мовами.');

	// The act from the document, compiled in the browser against the bridge, in Ukrainian.
	await view.click('#to-notes');
	await view.waitForSelector('#notes');
	assert.equal(await view.textContent('#notes-heading'), 'Нотатки зі сховища');
	// The stored act declares no <Title>, so the layout's default is the document's, translated.
	assert.equal(await view.title(), 'Перекладений сайт');

	// The same act as its own generated file, hydrated.
	await view.goto(`${host.url}/uk/notes`);
	await view.waitForSelector('#notes');
	assert.equal(await view.textContent('#stored-line'), 'Цей акт було збережено як текст і скомпільовано там, де він запустився.');
	const stored = await probeOf();
	assert.deepEqual(stored.removed, [], 'the stored act hydrates in place too');

	// A URL nothing enumerated, in French: the French shell, mounted live, showing the fallback.
	const answer = await view.goto(`${host.url}/fr/nowhere`);
	assert.ok(!(await answer!.text()).includes('data-aweft-ssg'), 'the shell was served, with no stamp on it');
	assert.match(await answer!.text(), /<html lang="fr">/);
	await view.waitForSelector('#not-found');
	assert.equal(await view.title(), 'Introuvable', 'the live mount read the language off the shell');
	assert.equal(await view.textContent('#not-found p'), 'Rien ici.');

	// And the English tree is English.
	await view.goto(`${host.url}/`);
	await view.waitForSelector('#home');
	assert.equal(await view.title(), 'Home');
	assert.equal(await view.textContent('#welcome'), 'Welcome');

	assert.deepEqual(problems, [], 'the pages threw nothing');
	console.log('recipes/translated-site: ok');
} finally {
	await browser.close();
	await host.close();
}
