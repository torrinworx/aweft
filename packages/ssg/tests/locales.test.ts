// A site written once per language (design 279): the layout, the document's language, the
// alternates, the report, and the client half reading the language back.
//
// The expected files and tags are worked out from the note by hand: the source language stands
// where the site stood, every other under its tag, and a page in a language is the same page with
// its tokens looked up in that language's catalog.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Router } from '@aweftjs/dom/router';
import { createSite } from '@aweftjs/ssg';
import { languageOf } from '@aweftjs/ssg/client';
import { Head, Stage, StageContext, Title, h, text } from '@aweftjs/ui';
import type { Act, Catalog } from '@aweftjs/ui';

import { SHELL, scratch } from './fixtures.ts';

const space = scratch();
after(() => space.done());

// --- a site written with tokens -------------------------------------------------------------------

const Home = (): unknown => h('main', { id: 'home' },
	h(Head, {}, h(Title, {}, text('Home'))),
	h('h1', {}, text('Welcome')),
	h('p', {}, text('{n, plural, one {# item} other {# items}}', { n: 3 })));

const About = (props: { router: Router }): unknown => h('main', { id: 'about' },
	h(Head, {}, h(Title, {}, text('About'))),
	h('a', { id: 'home-link', href: `${props.router.base}/` }, text('Home')),
	h('p', {}, text('Untranslated line')));

const NotFound = (): unknown => h('main', { id: 'not-found' }, h(Head, {}, h(Title, {}, text('Not found'))));

const Site = (props: { router: Router }): unknown => {
	const acts: Record<string, Act> = { '': Home, about: () => About(props), missing: NotFound };
	return h(StageContext, { router: props.router, acts, fallback: 'missing' }, h(Stage, {}));
};

const fr: Catalog = {
	'Home': 'Accueil',
	'Welcome': 'Bienvenue',
	'About': 'À propos',
	'Not found': 'Introuvable',
	'{n, plural, one {# item} other {# items}}': '{n, plural, one {# élément} other {# éléments}}',
	'Never shown': 'Jamais',
};

const ar: Catalog = { 'Home': 'الرئيسية' };

const siteIn = (out: string, options: { base?: string; locale?: string; locales?: Record<string, Catalog> } = {}): ReturnType<typeof createSite> =>
	createSite({ page: (router) => h(Site, { router }), shell: SHELL, out, ...options });

const read = (dir: string, ...rest: string[]): string => readFileSync(join(dir, ...rest), 'utf8');

// --- the layout and the documents -----------------------------------------------------------------

test('a full write puts the source language where the site stood and every other under its tag', async () => {
	const out = join(space.dir, 'full');
	const written = await siteIn(out, { base: 'https://example.com', locale: 'en', locales: { fr, ar } }).write();

	assert.deepEqual([...written.files].sort(), [
		'404.html', 'about/index.html', 'ar/404.html', 'ar/about/index.html', 'ar/index.html', 'ar/shell.html',
		'fr/404.html', 'fr/about/index.html', 'fr/index.html', 'fr/shell.html',
		'index.html', 'shell.html', 'sitemap.xml',
	]);
	assert.deepEqual(written.urls, ['/', '/about', '/fr', '/fr/about', '/ar', '/ar/about']);

	const english = read(out, 'index.html');
	const french = read(out, 'fr', 'index.html');
	assert.match(english, /<html lang="en">/, 'the shell\'s own lang is replaced, not doubled');
	assert.match(french, /<html lang="fr">/);
	assert.ok(!english.includes('lang="en" lang'), 'one lang attribute');
	assert.match(english, /Welcome/);
	assert.match(french, /Bienvenue/);
	assert.ok(!french.includes('Welcome'), 'the French page holds no English where the catalog has an entry');
	assert.match(french, /3 éléments/, 'a plural in the catalog\'s own words');
	assert.match(french, /<title[^>]*>Accueil<\/title>/, 'the title is a token too');

	// A link written with the router's base stays in its language.
	assert.match(read(out, 'fr', 'about', 'index.html'), /href="\/fr\/"/);
	assert.match(read(out, 'about', 'index.html'), /href="\/"/);
});

test('dir="rtl" is written for a right-to-left script and for nothing else', async () => {
	const out = join(space.dir, 'rtl');
	await siteIn(out, { locale: 'en', locales: { fr, ar } }).write();
	assert.match(read(out, 'ar', 'index.html'), /<html lang="ar" dir="rtl">/);
	assert.ok(!read(out, 'fr', 'index.html').includes('dir='));
	assert.ok(!read(out, 'index.html').includes('dir='));
});

test('with a base, every page carries the alternates in its head, and so does the sitemap', async () => {
	const out = join(space.dir, 'alternates');
	await siteIn(out, { base: 'https://example.com/', locale: 'en', locales: { fr } }).write();

	const about = read(out, 'fr', 'about', 'index.html');
	assert.match(about, /<link rel="alternate" hreflang="en" href="https:\/\/example.com\/about">/);
	assert.match(about, /<link rel="alternate" hreflang="fr" href="https:\/\/example.com\/fr\/about">/);
	assert.match(about, /<link rel="alternate" hreflang="x-default" href="https:\/\/example.com\/about">/, 'the source language is the default');
	assert.ok(!read(out, 'fr', '404.html').includes('hreflang'), 'the fallback is no URL of the site\'s');

	const sitemap = read(out, 'sitemap.xml');
	assert.match(sitemap, /xmlns:xhtml="http:\/\/www.w3.org\/1999\/xhtml"/);
	assert.match(sitemap, /<loc>https:\/\/example.com\/fr\/about<\/loc>\n\t\t<xhtml:link rel="alternate" hreflang="en" href="https:\/\/example.com\/about"\/>/);
	assert.match(sitemap, /<loc>https:\/\/example.com\/about<\/loc>/);
});

test('without a base there are no alternates and no sitemap, and the pages are still per language', async () => {
	const out = join(space.dir, 'no-base');
	const written = await siteIn(out, { locale: 'en', locales: { fr } }).write();
	assert.equal(written.sitemap, null);
	assert.ok(!read(out, 'fr', 'index.html').includes('hreflang'));
	assert.ok(existsSync(join(out, 'fr', 'about', 'index.html')));
});

test('a language\'s shell is the shell with its lang and no stamp, so attach mounts it live', async () => {
	const out = join(space.dir, 'shell');
	await siteIn(out, { locale: 'en', locales: { fr } }).write();
	const shell = read(out, 'fr', 'shell.html');
	assert.match(shell, /<html lang="fr">/);
	assert.ok(!shell.includes('data-aweft-ssg'));
	assert.ok(!shell.includes('data-aweft'), 'no stylesheet either: the shell holds nothing a render wrote');
	assert.equal(read(out, 'shell.html'), SHELL, 'the source language\'s shell is the shell');
});

test('a site with one language writes lang on every document and nothing else changes', async () => {
	const out = join(space.dir, 'one');
	const written = await siteIn(out, { locale: 'uk' }).write();
	assert.deepEqual([...written.files].sort(), ['404.html', 'about/index.html', 'index.html', 'shell.html']);
	assert.match(read(out, 'index.html'), /<html lang="uk">/);
	assert.deepEqual(written.text, {});
});

test('a site with no language writes what it wrote before', async () => {
	const out = join(space.dir, 'none');
	const written = await siteIn(out).write();
	assert.deepEqual([...written.files].sort(), ['404.html', 'about/index.html', 'index.html', 'shell.html']);
	assert.match(read(out, 'index.html'), /<html lang="en">/, 'the shell\'s own lang stands');
	assert.deepEqual(written.text, {});
});

// --- one page at a time ----------------------------------------------------------------------------

test('page() reads the language off the URL', async () => {
	const site = siteIn(join(space.dir, 'page'), { locale: 'en', locales: { fr } });
	const french = await site.page('/fr/about');
	assert.equal(french.title, 'À propos');
	assert.match(french.html, /<html lang="fr">/);
	const english = await site.page('/about');
	assert.equal(english.title, 'About');
	assert.match(english.html, /<html lang="en">/);
	assert.equal((await site.page('/fr')).title, 'Accueil', 'the prefix alone is the home page in that language');
});

test('a listed URL with no prefix is written in every language, and a prefixed one in its own', async () => {
	const out = join(space.dir, 'list');
	const both = await siteIn(out, { locale: 'en', locales: { fr } }).write(['/about']);
	assert.deepEqual(both.files, ['about/index.html', 'fr/about/index.html']);
	assert.deepEqual(both.urls, ['/about', '/fr/about']);

	const one = await siteIn(join(space.dir, 'list-one'), { locale: 'en', locales: { fr } }).write(['/fr/about']);
	assert.deepEqual(one.files, ['fr/about/index.html']);
	assert.deepEqual(one.urls, ['/fr/about']);
});

test('the source language in locales, and a tag Intl cannot read, are refused by name', () => {
	assert.throws(() => siteIn(join(space.dir, 'twice'), { locale: 'fr', locales: { fr } }), (error: Error & { reason?: string }) => {
		assert.equal(error.reason, 'locale-twice');
		return true;
	});
	assert.throws(() => siteIn(join(space.dir, 'invalid'), { locale: 'en', locales: { '!!!': fr } }), (error: Error & { reason?: string; fix?: string }) => {
		assert.equal(error.reason, 'locale-invalid');
		assert.match(error.fix ?? '', /BCP 47/);
		return true;
	});
	assert.throws(() => siteIn(join(space.dir, 'empty'), { locale: '' }), (error: Error & { reason?: string }) => {
		assert.equal(error.reason, 'locale-invalid');
		return true;
	});
});

test('a listed URL is written once however it is spelled', async () => {
	const out = join(space.dir, 'spelled');
	const written = await siteIn(out, { locale: 'en', locales: { fr } }).write(['/fr', '/fr/', 'fr']);
	assert.deepEqual(written.files, ['fr/index.html']);
	assert.deepEqual(written.urls, ['/fr']);
});

test('locales with no locale is refused by name', () => {
	assert.throws(() => siteIn(join(space.dir, 'refused'), { locales: { fr } }), (error: Error & { reason?: string; fix?: string }) => {
		assert.equal(error.reason, 'locale-needed');
		assert.match(error.fix ?? '', /Name the language the pages are written in/);
		return true;
	});
});

// --- the report --------------------------------------------------------------------------------------

test('the report says what each catalog lacks and what it holds that no page looked up', async () => {
	const written = await siteIn(join(space.dir, 'report'), { locale: 'en', locales: { fr, ar } }).write();
	assert.deepEqual(written.text, {
		fr: { missing: ['Untranslated line'], unused: ['Never shown'] },
		ar: { missing: ['About', 'Not found', 'Untranslated line', 'Welcome', '{n, plural, one {# item} other {# items}}'], unused: [] },
	});
});

// --- the client half ---------------------------------------------------------------------------------

test('languageOf reads the language and the base off a page, by the prefix rule', () => {
	const page = (lang: string | null, pathname: string): { documentElement: { getAttribute(name: string): string | null }; location: { pathname: string } } => ({
		documentElement: { getAttribute: (name) => (name === 'lang' ? lang : null) },
		location: { pathname },
	});
	assert.deepEqual(languageOf(page('fr', '/fr/about')), { locale: 'fr', base: '/fr' });
	assert.deepEqual(languageOf(page('fr', '/fr')), { locale: 'fr', base: '/fr' });
	assert.deepEqual(languageOf(page('en', '/about')), { locale: 'en', base: '' }, 'the source language carries no prefix');
	assert.deepEqual(languageOf(page('fr', '/french/about')), { locale: 'fr', base: '' }, 'a segment that only starts with the tag is not the prefix');
	assert.deepEqual(languageOf(page(null, '/about')), { locale: '', base: '' }, 'a page with no lang is a site with one language');
	assert.deepEqual(languageOf(page('fr', '/fr/tags/rust')), { locale: 'fr', base: '/fr' }, 'the shell served for an unenumerated URL');
});
