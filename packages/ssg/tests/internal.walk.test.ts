// The walk's rules (design 148), over stage entries written by hand.
//
// A hand-written registry rather than a rendered site, so each rule is checked on its own and a
// failure names the rule rather than the page it happened to be on. `tests/site.test.ts` is the
// same rules through a real render.

import test from 'node:test';
import assert from 'node:assert/strict';

import type { StageAct, StageEntry } from '@aweftjs/ui';

import { walkSite } from '../src/walk.ts';

const act = (name: string, entries?: StageAct['entries']): StageAct =>
	({ name, loader: false, entries: entries ?? null });

const stage = (prefix: string, acts: StageAct[], over: Partial<StageEntry> = {}): StageEntry =>
	({ acts, prefix, parent: null, fallback: null, current: acts[0]?.name ?? null, ...over });


/** One stage declaring one act, with the parameter answers a case wants to try. */
const placeStage = (key: string, rows: unknown): StageEntry =>
	stage('', [act(key, (async () => rows) as StageAct['entries'])]);

/** A registry that answers the same entries for every URL. */
const flat = (entries: StageEntry[]) => async (): Promise<readonly StageEntry[]> => entries;

test('a plain act is one URL, under its stage\'s prefix', async () => {
	const found = await walkSite(flat([stage('', [act(''), act('about')]), stage('posts/3', [act('edit')])]));
	assert.deepEqual([...found.urls].sort(), ['/', '/about', '/posts/3/edit']);
});

test('a parameterised act is one URL per answered object, escaped a segment at a time', async () => {
	const found = await walkSite(flat([stage('', [
		act('posts/:id', async () => [{ id: 'one' }, { id: 'a b' }]),
		act('files/*rest', async () => [{ rest: 'deep/in a/tree' }]),
	])]));

	assert.deepEqual([...found.urls].sort(), [
		'/', '/files/deep/in%20a/tree', '/posts/a%20b', '/posts/one',
	]);
});

test('a parameterised act with no entries is reported once, whatever it was reached from', async () => {
	const found = await walkSite(flat([stage('', [act(''), act('tags/:tag'), act('*rest')])]));
	assert.deepEqual(found.urls, ['/']);
	assert.deepEqual(found.unenumerated, [{ prefix: '', name: 'tags/:tag' }, { prefix: '', name: '*rest' }]);
});

test('an entries that answers nothing writes nothing, parameterised or not', async () => {
	const found = await walkSite(flat([stage('', [
		act('drafts', async () => []),
		act('posts/:id', async () => []),
		act('archive', async () => [{}, {}]),
	])]));
	// `/` is always walked: it is where a walk starts. `archive` takes no parameter, so two
	// answers are still the one page it is.
	assert.deepEqual(found.urls, ['/', '/archive']);
	assert.deepEqual(found.unenumerated, []);
});

test('an entries that does not answer a name in the key is refused, naming the key and the answer', async () => {
	await assert.rejects(
		() => walkSite(flat([stage('', [act('posts/:id/:part', async () => [{ id: 'one' }])])])),
		(error: Error & { reason?: string; fix?: string }) => {
			assert.equal(error.reason, 'missing-parameter');
			assert.match(error.message, /posts\/:id\/:part takes part and entries\(\) answered \{"id":"one"\}/);
			assert.match(String(error.fix), /Answer every :name and \*name/);
			return true;
		},
	);
});

test('the walk stops when a render adds no URL, and renders each URL once', async () => {
	// A nested stage appears only under the page that holds it, so the second round is what finds
	// `/docs/install`, and the third has to add nothing or this never ends.
	const rendered: string[] = [];
	const found = await walkSite(async (url) => {
		rendered.push(url);
		const root = stage('', [act(''), act('docs')]);
		return url.startsWith('/docs') ? [root, stage('docs', [act('install')])] : [root];
	});

	assert.deepEqual(found.urls, ['/', '/docs', '/docs/install']);
	assert.deepEqual(rendered, ['/', '/docs', '/docs/install'], 'each URL was rendered exactly once');
});

test('a stage that names the same URL twice adds it once', async () => {
	const found = await walkSite(flat([
		stage('', [act('docs')]),
		stage('', [act('docs'), act('docs/')]),
	]));
	assert.deepEqual(found.urls, ['/', '/docs']);
});

test('an entries value that names a place rather than a page is refused', async () => {
	for (const [value, key] of [['..', 'posts/:id'], ['.', 'posts/:id'], ['', 'posts/:id']] as const) {
		await assert.rejects(
			() => walkSite(async () => [placeStage(key, [{ id: value }])]),
			(error: Error & { reason?: string; fix?: string }) => {
				assert.equal(error.reason, 'bad-entry-value');
				assert.ok(error.message.includes(`${key} was answered id=${JSON.stringify(value)}`), error.message);
				assert.match(String(error.fix), /no empty, \. or \.\. segment/);
				return true;
			});
	}

	// A `*rest` is several segments and every one of them is checked, so a `..` in the middle of
	// one is caught as well: `a/../b` is `b`, which is another page's path.
	await assert.rejects(
		() => walkSite(async () => [placeStage('files/*rest', [{ rest: 'a/../b' }])]),
		(error: Error & { reason?: string }) => {
			assert.equal(error.reason, 'bad-entry-value');
			return true;
		});
});

test('an entries that answers something other than an array is refused by name', async () => {
	await assert.rejects(
		() => walkSite(async () => [placeStage('posts/:id', { id: 'one' } as never)]),
		(error: Error & { reason?: string; fix?: string }) => {
			assert.equal(error.reason, 'bad-entries');
			assert.match(error.message, /posts\/:id answered an object/);
			assert.match(String(error.fix), /Answer an array of objects/);
			return true;
		});
});
