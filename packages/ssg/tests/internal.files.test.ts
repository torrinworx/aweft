// How a URL is spelled, where it lands on disk, what the sitemap says, and what a write refuses.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { FALLBACK, fileOf, normalise, urlOf } from '../src/url.ts';
import { sitemapOf } from '../src/sitemap.ts';
import { writeFiles } from '../src/write.ts';

import { scratch } from './fixtures.ts';

const space = scratch();
after(() => space.done());

test('a URL is a leading slash and no trailing one, with the query and hash off', () => {
	assert.equal(normalise(''), '/');
	assert.equal(normalise('/'), '/');
	assert.equal(normalise('///'), '/');
	assert.equal(normalise('docs'), '/docs');
	assert.equal(normalise('/docs/'), '/docs');
	assert.equal(normalise('/docs?page=2#top'), '/docs');
});

test('an act key sits under its stage\'s prefix', () => {
	assert.equal(urlOf('', ''), '/');
	assert.equal(urlOf('', 'about'), '/about');
	assert.equal(urlOf('docs', ''), '/docs');
	assert.equal(urlOf('posts/3', 'edit'), '/posts/3/edit');
});

test('every page is <url>/index.html, and the root is index.html', () => {
	assert.equal(fileOf('/'), 'index.html');
	assert.equal(fileOf('/docs'), 'docs/index.html');
	assert.equal(fileOf('/posts/hello/'), 'posts/hello/index.html');
});

test('the fallback URL is not a path a site would declare', () => {
	assert.equal(normalise(FALLBACK), FALLBACK, 'it is already spelled the one way');
	assert.match(FALLBACK, /^\/_/, 'and it starts with an underscore, which no act key here does');
});

test('the sitemap lists each URL under the base, once, with the base\'s trailing slash off', () => {
	assert.equal(
		sitemapOf('https://example.com/', ['/', '/about']),
		'<?xml version="1.0" encoding="UTF-8"?>\n'
		+ '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
		+ '\t<url>\n\t\t<loc>https://example.com/</loc>\n\t</url>\n'
		+ '\t<url>\n\t\t<loc>https://example.com/about</loc>\n\t</url>\n'
		+ '</urlset>\n',
	);
});

test('a sitemap with nothing in it is still a sitemap, and XML is escaped', () => {
	assert.ok(sitemapOf('https://example.com', []).includes('<urlset'));
	assert.ok(sitemapOf('https://example.com', ['/a&b']).includes('<loc>https://example.com/a&amp;b</loc>'));
});

test('a write makes the directories it needs', async () => {
	const out = join(space.dir, 'deep');
	await writeFiles(out, [['a/b/c/index.html', 'hello']]);
	assert.equal(readFileSync(join(out, 'a/b/c/index.html'), 'utf8'), 'hello');
});

test('a path that climbs out of the output directory is refused', async () => {
	const out = join(space.dir, 'guarded');
	await assert.rejects(
		() => writeFiles(out, [['../escaped.html', 'no']]),
		(error: Error & { reason?: string; fix?: string }) => {
			assert.equal(error.reason, 'outside-out');
			assert.ok(String(error.fix).includes('page URL'));
			return true;
		},
	);
	assert.ok(!existsSync(join(space.dir, 'escaped.html')));
});

test('a path holding a . or a .. is refused, even when it lands inside the output', async () => {
	// `posts/../index.html` resolves inside `out`, so the guard on climbing out never fires and the
	// site root's own page is overwritten. The path has to be the path its URL names.
	const out = join(space.dir, 'places');
	await writeFiles(out, [['index.html', 'the root']]);

	for (const name of ['posts/../index.html', './index.html', 'a/./b/index.html']) {
		await assert.rejects(
			() => writeFiles(out, [[name, 'not the root']]),
			(error: Error & { reason?: string; fix?: string }) => {
				assert.equal(error.reason, 'not-a-path');
				assert.ok(String(error.fix).includes('names a place rather than a page'));
				return true;
			},
		);
	}
	assert.equal(readFileSync(join(out, 'index.html'), 'utf8'), 'the root', 'and the page that was there is untouched');
});
