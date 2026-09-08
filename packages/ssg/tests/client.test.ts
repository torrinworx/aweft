// `attach`: which of the two modes a target gets, and that it really is that mode.
//
// The light tree `dom` ships is enough to tell them apart, because the two modes differ in what
// they do to the nodes that are already there: a hydration keeps them and a mount adds beside them.
// `tests/browser.test.ts` runs the same two cases in Chromium.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createDocument, parseHtml, toHtml } from '@aweftjs/dom';
import type { LightDocument } from '@aweftjs/dom';
import { createRouter } from '@aweftjs/dom/router';
import { context, h, render } from '@aweftjs/ui';
import { createSite } from '@aweftjs/ssg';
import { attach } from '@aweftjs/ssg/client';

import { STAMP } from '../src/stamp.ts';

import { SHELL, Site } from './fixtures.ts';

/** A document holding one generated page, as a browser would have parsed it. */
const opened = async (url: string, stamp: boolean): Promise<LightDocument> => {
	const site = createSite({ page: (router) => h(Site, { router }), shell: SHELL, out: '/dev/null' });
	const html = (await site.page(url)).html;
	const body = html.slice(html.indexOf('>', html.indexOf('<body')) + 1, html.lastIndexOf('</body>'));

	const document = createDocument();
	if (stamp) document.body.setAttribute(STAMP, '');
	for (const node of parseHtml(body, document)) document.body.appendChild(node);
	return document;
};

const elementsIn = (from: { firstChild: unknown; nextSibling: unknown; nodeType: number } | null): unknown[] => {
	const found: unknown[] = [];
	for (let node = from; node !== null; node = node.nextSibling as typeof node) {
		if (node.nodeType === 1) found.push(node);
		found.push(...elementsIn(node.firstChild as never));
	}
	return found;
};

test('a stamped target is hydrated: every element the server wrote is the one that stays', async () => {
	const document = await opened('/posts/one', true);
	const before = elementsIn(document.body.firstChild as never);
	assert.ok(before.length > 0, 'the server wrote a page');

	const stop = attach(document.body as never, h(Site, { router: createRouter({ url: '/posts/one' }) }));

	assert.deepEqual(elementsIn(document.body.firstChild as never), before, 'the same objects, in the same order');
	assert.ok(document.body.textContent?.includes('one'), 'and it is still the page');
	stop();
});

test('an unstamped target is mounted: what was there stays and the page goes in after it', async () => {
	// The live shell has nothing in its body, so what a mount is proved by here is that a mount
	// does not claim: put something in front of it and the page is added, not paired.
	const document = createDocument();
	for (const node of parseHtml('<p id="already">already</p>', document)) document.body.appendChild(node);

	const stop = attach(document.body as never, h(Site, { router: createRouter({ url: '/posts/one' }) }));

	const text = document.body.textContent ?? '';
	assert.ok(text.startsWith('already'), 'what was there is untouched');
	assert.ok(text.includes('one'), 'and the page was mounted after it');

	stop();
	assert.equal(toHtml(document.body.childNodes), '<p id="already">already</p>',
		'and the removal takes back only what it mounted');
});

test('what a mount renders is what the page it hydrates was rendered from', async () => {
	// The two modes have to agree or a hydration is meaningless, so this pins them against each
	// other rather than against a recorded string.
	const own = context();
	const markup = await render(h(Site, { router: createRouter({ url: '/docs/install' }) }), { context: own });

	const document = await opened('/docs/install', true);
	assert.equal(toHtml(document.body.childNodes), markup);
});

test('a maker is wrapped the same way whichever page it lands on', async () => {
	// One entry file has to work on both, so `attach` makes a component call of a bare function
	// before it picks a mode: `hydrate` would wrap it and `mount` would read it as a mounter.
	const Greeting = () => h('p', {}, 'hello');
	const maker = (): unknown => h(Greeting, {});
	const markup = await render(h(maker));

	const generated = createDocument();
	generated.body.setAttribute(STAMP, '');
	for (const node of parseHtml(markup, generated)) generated.body.appendChild(node);
	const sent = elementsIn(generated.body.firstChild as never);
	assert.equal(sent.length, 1, 'the server wrote the paragraph');

	const stopGenerated = attach(generated.body as never, maker);
	assert.deepEqual(elementsIn(generated.body.firstChild as never), sent, 'adopted in place, not rebuilt');
	stopGenerated();

	const live = createDocument();
	const stopLive = attach(live.body as never, maker);
	assert.equal(toHtml(live.body.childNodes), '<p>hello</p>', 'the same maker renders on a live page');
	stopLive();
	assert.equal(toHtml(live.body.childNodes), '', 'and the removal takes back what it mounted');
});
