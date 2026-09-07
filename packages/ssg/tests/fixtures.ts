// The site the suite walks, written with `h` calls rather than JSX so the tests compile the same
// way whatever a process has set `AWEFT_DEFAULT_H` to.
//
// It is small on purpose and every part of it is here for a rule the suite states: a nested stage
// under a matched path, an act with `entries()`, one with an empty `entries()`, one with a
// parameter and none at all, and a page that asks to be left out of the sitemap.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Router } from '@aweftjs/dom/router';
import { Head, Meta, Stage, StageContext, Title, h } from '@aweftjs/ui';
import type { Act } from '@aweftjs/ui';

/** A page shell in the shape a bundler leaves behind: charset first, script in the head. */
export const SHELL = '<!doctype html>\n<html lang="en">\n\t<head>\n'
	+ '\t\t<meta charset="utf-8" />\n\t\t<title>the shell</title>\n'
	+ '\t\t<script type="module" src="/app.js"></script>\n\t</head>\n\t<body>\n\t</body>\n</html>\n';

const page = (id: string, title: string, ...rest: unknown[]): unknown =>
	h('main', { id }, h(Head, {}, h(Title, {}, title)), ...rest);

const Home = (): unknown => page('home', 'Home', h('a', { id: 'to-docs', href: '/docs' }, 'Docs'));

const DocsIndex = (): unknown => page('docs-index', 'The docs');

/** The nested stage's act. Its URLs are `docs/<page>`, from the prefix its parent matched. */
const DocsPage = Object.assign(
	StageContext.use((stage) => (): unknown =>
		page('docs-page', `Docs: ${String(stage!.params.get()['page'])}`,
			h('p', { id: 'docs-page-name' }, String(stage!.params.get()['page'])))),
	{ entries: async () => [{ page: 'install' }, { page: 'concepts' }] },
);

const Docs = (): unknown => h('main', { id: 'docs' },
	h(Head, {}, h(Title, {}, 'Docs')),
	h(StageContext, { acts: { '': DocsIndex, ':page': DocsPage }, initial: '' }, h(Stage, {})));

/** A nested stage with no catch-all in it, so a tail nothing matches shows its fallback. */
const GuideIndex = (): unknown => page('guide-index', 'The guide');
const GuideInstall = (): unknown => page('guide-install', 'Guide: install');
const GuideGone = (): unknown => page('guide-gone', 'No such guide page');

const Guide = (): unknown => h('main', { id: 'guide' },
	h(Head, {}, h(Title, {}, 'Guide')),
	h(StageContext, { acts: { '': GuideIndex, install: GuideInstall, gone: GuideGone }, initial: '', fallback: 'gone' },
		h(Stage, {})));

const Post = Object.assign(
	StageContext.use((stage) => (): unknown =>
		page('post', `Post ${String(stage!.params.get()['id'])}`,
			h('p', { id: 'post-id' }, String(stage!.params.get()['id'])))),
	{ entries: async () => [{ id: 'one' }, { id: 'two' }] },
);

/** A parameterised act with no `entries`. Only the client can render these. */
const Tag = StageContext.use((stage) => (): unknown =>
	page('tag', `Tag ${String(stage!.params.get()['tag'])}`));

/** A plain act whose `entries()` answers nothing, which is a site saying it has no drafts. */
const Draft = Object.assign((): unknown => page('draft', 'Drafts'), { entries: async () => [] });

/** A page that is written as a file and stays out of the sitemap. */
const Secret = (): unknown => h('main', { id: 'secret' },
	h(Head, {}, h(Title, {}, 'Secret'), h(Meta, { name: 'robots', content: 'noindex, nofollow' })));

const NotFound = (): unknown => page('not-found', 'Not found');

export const acts: Record<string, Act> = {
	'': Home,
	docs: Docs,
	guide: Guide,
	'posts/:id': Post,
	'tags/:tag': Tag,
	drafts: Draft,
	secret: Secret,
	missing: NotFound,
};

export const Site = (props: { router: Router }): unknown =>
	h(StageContext, { router: props.router, acts, fallback: 'missing' }, h(Stage, {}));

/** A temporary directory, removed when the suite is over. */
export const scratch = (): { dir: string; done(): void } => {
	const dir = mkdtempSync(join(tmpdir(), 'aweft-ssg-'));
	return { dir, done: () => rmSync(dir, { recursive: true, force: true }) };
};

/** A file path under a scratch directory. */
export const at = (dir: string, ...rest: string[]): string => join(dir, ...rest);
