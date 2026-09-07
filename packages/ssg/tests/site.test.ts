// What a site is, through the three things a caller does with it.
//
// Every expected answer here is worked out from designs 148, 149 and 150 rather than read off a
// run: the URL list is the act table with the rules applied by hand, and the document is the shell
// with the four changes those notes name.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createRouter } from '@aweftjs/dom/router';
import { createSite } from '@aweftjs/ssg';
import { context as uiContext, h, render as uiRender } from '@aweftjs/ui';

import { SHELL, Site, scratch } from './fixtures.ts';

const space = scratch();
after(() => space.done());

const siteIn = (out: string, base?: string): ReturnType<typeof createSite> => createSite({
	page: (router) => h(Site, { router }),
	shell: SHELL,
	out,
	...(base === undefined ? {} : { base }),
});

test('the walk finds every act, follows a nested stage, and reports what it cannot list', async () => {
	const found = await siteIn(join(space.dir, 'walk')).walk();

	// Worked out from the act table: `/` and the plain acts, two posts from `entries()`, and nothing
	// for `drafts` because its `entries()` answers nothing. The nested pages appear only after the
	// page holding their stage has been rendered, which is why the walk is a queue and not one pass.
	// `missing` and `gone` are the two stages' fallbacks and are pages nowhere: that is `404.html`.
	assert.deepEqual([...found.urls].sort(), [
		'/', '/docs', '/docs/concepts', '/docs/install', '/guide', '/guide/install',
		'/posts/one', '/posts/two', '/secret',
	]);
	assert.ok(!found.urls.includes('/missing'), 'the root stage\'s fallback is not a page');
	assert.ok(!found.urls.includes('/guide/gone'), 'and neither is a nested stage\'s');

	// `/` is rendered first, because a walk starts at the site root.
	assert.equal(found.urls[0], '/');

	// The nested acts come after the page that holds them, and their prefix is what the parent
	// matched rather than the pattern.
	assert.ok(found.urls.indexOf('/docs') < found.urls.indexOf('/docs/install'));

	assert.deepEqual(found.unenumerated, [{ prefix: '', name: 'tags/:tag' }]);
	assert.ok(!found.urls.some((url) => url.startsWith('/tags')), 'and it invents no URL for one');
	assert.ok(!found.urls.includes('/drafts'), 'an entries() that answers nothing writes nothing');
});

test('a page is the shell with the head run in front, the shell title gone and the body stamped', async () => {
	const made = await siteIn(join(space.dir, 'page')).page('/posts/one');

	assert.equal(made.title, 'Post one');
	assert.equal(made.noindex, false);

	const head = made.html.slice(made.html.indexOf('<head'), made.html.indexOf('</head>'));
	assert.deepEqual([...head.matchAll(/<title[^>]*>([^<]*)</g)].map((one) => one[1]), ['Post one'],
		'the page declared a title, so the shell\'s is gone and exactly one is left');
	assert.match(head, /<head>\s*<meta charset="utf-8" \/><style data-aweft>/,
		'the run goes behind the charset the shell wrote first, and nowhere else');
	assert.ok(head.includes('<script type="module" src="/app.js">'), 'and the shell keeps its own script');

	assert.match(made.html, /<body data-aweft-ssg=""><!--\[-->/, 'the markup is the body, stamped');
	assert.ok(made.html.includes('id="post-id"'), 'and it is this page\'s markup');
	assert.ok(made.html.endsWith('</html>'),
		'with no character data after </body>, which a parser would move back into the body');
});

test('a URL with a trailing slash is the same page as one without', async () => {
	const site = siteIn(join(space.dir, 'slash'));
	assert.equal((await site.page('/docs/')).html, (await site.page('docs')).html);
});

test('a page whose head says robots noindex says so, and one without does not', async () => {
	const site = siteIn(join(space.dir, 'robots'));
	assert.equal((await site.page('/secret')).noindex, true);
	assert.equal((await site.page('/docs')).noindex, false);
});

test('a full write puts every page on disk, with the 404, the shell and the sitemap', async () => {
	const out = join(space.dir, 'full');
	const written = await siteIn(out, 'https://example.com/').write();

	assert.deepEqual([...written.files].sort(), [
		'404.html',
		'docs/concepts/index.html',
		'docs/index.html',
		'docs/install/index.html',
		'guide/index.html',
		'guide/install/index.html',
		'index.html',
		'posts/one/index.html',
		'posts/two/index.html',
		'secret/index.html',
		'shell.html',
		'sitemap.xml',
	]);
	assert.ok(!existsSync(join(out, 'missing')), 'no page is written for the fallback act');
	for (const name of written.files) assert.ok(existsSync(join(out, name)), `${name} is on disk`);

	assert.deepEqual(written.unenumerated, [{ prefix: '', name: 'tags/:tag' }]);
	assert.equal(written.sitemap, 'sitemap.xml');

	// The fallback is the site rendered at a URL it declares nothing for.
	const notFound = readFileSync(join(out, '404.html'), 'utf8');
	assert.match(notFound, /<title[^>]*>Not found<\/title>/);
	assert.ok(notFound.includes('data-aweft-ssg'), 'and it is a page a browser takes over');

	// The shell is untouched, so `attach` finds no stamp and mounts live.
	assert.equal(readFileSync(join(out, 'shell.html'), 'utf8'), SHELL);
});

test('the sitemap lists the indexable pages under the base, and nothing else', async () => {
	const out = join(space.dir, 'sitemap');
	await siteIn(out, 'https://example.com/').write();
	const sitemap = readFileSync(join(out, 'sitemap.xml'), 'utf8');

	assert.ok(sitemap.includes('<loc>https://example.com/</loc>'), 'the root, with the base\'s slash taken off');
	assert.ok(sitemap.includes('<loc>https://example.com/posts/one</loc>'));
	assert.ok(!sitemap.includes('/secret'), 'the noindex page is written as a file and left out of this');
	assert.ok(!sitemap.includes('404'), 'and so is the fallback, which is not a URL of the site');
	assert.ok(!sitemap.includes('/missing'), 'and neither is the fallback act');
	assert.equal([...sitemap.matchAll(/<loc>/g)].length, 8, 'nine pages, one of them noindex');
});

test('with no base there is no sitemap, and the result says so', async () => {
	const out = join(space.dir, 'nobase');
	const written = await siteIn(out).write();
	assert.equal(written.sitemap, null);
	assert.ok(!written.files.includes('sitemap.xml'));
	assert.ok(!existsSync(join(out, 'sitemap.xml')));
});

test('a write with a list writes those pages and touches nothing else', async () => {
	const out = join(space.dir, 'list');
	const written = await siteIn(out, 'https://example.com').write(['/posts/two', 'docs/install/']);

	assert.deepEqual(written.files, ['posts/two/index.html', 'docs/install/index.html'],
		'in the order they were asked for, and spelled the one way');
	assert.deepEqual(written.urls, ['/posts/two', '/docs/install']);
	assert.deepEqual(written.unenumerated, [], 'it does not walk, so it has nothing to report');
	assert.equal(written.sitemap, null, 'and no sitemap: a sitemap is a statement about every page');

	assert.ok(!existsSync(join(out, 'index.html')));
	assert.ok(!existsSync(join(out, '404.html')));
	assert.ok(!existsSync(join(out, 'shell.html')));
	assert.ok(readFileSync(join(out, 'posts/two/index.html'), 'utf8').includes('id="post-id"'));
});

test('a URL the site has no page for is refused by name, and nothing is written', async () => {
	const out = join(space.dir, 'not-a-page');
	const site = siteIn(out);

	// The root stage falls back, which is the site saying it has no such page. Writing the fallback
	// out at this path would publish a "not found" page on a URL the site claims to have, and the
	// call a running application makes is exactly this one, with a slug in it.
	await assert.rejects(() => site.page('/a-url-the-walk-would-never-produce'),
		(error: Error & { reason?: string; fix?: string }) => {
			assert.equal(error.reason, 'not-a-page');
			assert.match(error.message, /\/a-url-the-walk-would-never-produce left the stage at "" showing "missing"/);
			assert.match(String(error.fix), /walk\(\) answers the list/);
			return true;
		});

	await assert.rejects(() => site.write(['/posts/one', '/nope']), (error: Error & { reason?: string }) => {
		assert.equal(error.reason, 'not-a-page');
		return true;
	});
	assert.ok(!existsSync(join(out, 'nope')), 'and the refusal came before anything was written');
	assert.ok(!existsSync(join(out, 'posts')), 'including the pages in front of it in the list');
});

test('a nested stage showing its fallback refuses the page too', async () => {
	const site = siteIn(join(space.dir, 'nested-fallback'));
	// The root stage matched `guide` and is showing an act; the child stage matched nothing and is
	// showing `gone`. A check that only looked at the root would write this page.
	await assert.rejects(() => site.page('/guide/nope'), (error: Error & { reason?: string }) => {
		assert.equal(error.reason, 'not-a-page');
		assert.match(error.message, /the stage at "guide" showing "gone"/);
		return true;
	});
	// And the URLs the nested stage does have are pages.
	assert.equal((await site.page('/guide/install')).title, 'Guide: install');
});

test('the 404 is still written, because that is the one render the fallback is for', async () => {
	const out = join(space.dir, 'fallback-ok');
	const written = await siteIn(out).write();
	assert.ok(written.files.includes('404.html'));
	assert.match(readFileSync(join(out, '404.html'), 'utf8'), /<title[^>]*>Not found<\/title>/);
});

test('a render object is for one page, and a second render on it is refused', async () => {
	// The head list and the stage list are held for the length of a render, which is what keeps
	// them readable afterwards and what makes a second render on the same object accumulate.
	const own = uiContext();
	await uiRender(h(Site, { router: createRouter({ url: '/' }) }), { context: own });
	await assert.rejects(
		() => uiRender(h(Site, { router: createRouter({ url: '/docs' }) }), { context: own }),
		/already rendered a page.*one context\(\) per page/s,
	);
	assert.equal(own.stage.items.length, 1, 'and the first page\'s stages are the only ones in it');
});
