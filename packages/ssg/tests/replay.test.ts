// `replay` and the hydration it serves (design 304), over the light tree `dom` ships.
//
// The client under it is a stand-in that writes down every ask that reaches it, so "no read ran
// twice" is a list that stays empty. The last test renders a page through `createPages` and takes
// it over, which is the whole hand-off with no browser in it. `recipes/pages-on-request` runs it
// in Chromium.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Client, ClientStatus, Handle } from '@aweftjs/client';
import { immutable } from '@aweftjs/core';
import { createDocument, parseHtml } from '@aweftjs/dom';
import { createRouter } from '@aweftjs/dom/router';
import { open } from '@aweftjs/server';
import { createPages } from '@aweftjs/ssg';
import { attach, replay } from '@aweftjs/ssg/client';
import { h, render } from '@aweftjs/ui';

import { STAMP } from '../src/stamp.ts';

import { SHELL, Site } from './answered.ts';
import { scratch } from './fixtures.ts';

const space = scratch();
after(() => space.done());

/** A client that answers every ask `live` and writes down what reached it. */
const recording = (): Client & { asked: string[]; others: string[] } => {
	const asked: string[] = [];
	const others: string[] = [];
	return {
		asked,
		others,
		status: immutable<ClientStatus>('open'),
		ask: async (name, args) => { asked.push(`${name} ${JSON.stringify(args)}`); return 'live'; },
		share: <T extends object>(name: string): Handle<T> => {
			others.push(`share ${name}`);
			return { document: undefined, ready: new Promise<T>(() => {}), stop: () => {} };
		},
		reconnect: () => { others.push('reconnect'); },
		close: () => { others.push('close'); },
	};
};

interface Walked { readonly firstChild: Walked | null; readonly nextSibling: Walked | null; readonly nodeType: number }

/** Every element under a node, in document order, as the objects they are. */
const elementsIn = (from: unknown): unknown[] => {
	const found: unknown[] = [];
	for (let node = from as Walked | null; node !== null; node = node.nextSibling) {
		if (node.nodeType === 1) found.push(node);
		found.push(...elementsIn(node.firstChild));
	}
	return found;
};

/** A document carrying recorded answers, as a page rendered on request does. */
const carrying = (answers: unknown): { getElementById(id: string): { textContent: string } | null } => ({
	getElementById: (id) => (id === 'aweft-answers' ? { textContent: JSON.stringify(answers) } : null),
});

test('each recorded answer is handed out once, in order, and then the client is asked', async () => {
	const under = recording();
	const client = replay(under, carrying({ 'posts/List null': [{ result: ['a'] }, { result: ['b'] }] }));

	assert.deepEqual(await client.ask('posts/List'), ['a'], 'undefined arguments are null, as on the socket');
	assert.deepEqual(await client.ask('posts/List', null), ['b']);
	assert.equal(await client.ask('posts/List'), 'live', 'a third ask has no answer left');
	assert.deepEqual(under.asked, ['posts/List undefined']);
});

test('the key reads the arguments the way the render wrote them: through JSON, keys sorted', async () => {
	const under = recording();
	const client = replay(under, carrying({ 'notes/Mine {"all":"of them","every":true}': [{ result: 'kept' }] }));
	assert.equal(await client.ask('notes/Mine', { every: true, all: 'of them', gone: undefined }), 'kept');
	assert.equal(await client.ask('notes/Other', { every: true }), 'live', 'another name is asked');
	assert.equal(under.asked.length, 1);
});

test('a recorded refusal rejects with its reason, its message and its reasons', async () => {
	const client = replay(recording(), carrying({
		'notes/Mine null': [{ error: { reason: 'refused', message: 'notes/Mine refused the call', reasons: [{ code: 'private', message: 'sign in' }] } }],
	}));
	await assert.rejects(client.ask('notes/Mine'), (error: Error & { reason?: string; reasons?: unknown }) => {
		assert.equal(error.reason, 'refused');
		assert.equal(error.message, 'notes/Mine refused the call', 'the far end\'s words, whole');
		assert.deepEqual(error.reasons, [{ code: 'private', message: 'sign in' }]);
		return true;
	});
});

test('a record edited into something else is asked for live, never thrown out of an ask', async () => {
	const under = recording();
	const client = replay(under, carrying({ 'a null': 5, 'b null': [null, { error: 'no reason' }], 'c null': [{ result: 'kept' }] }));
	assert.equal(await client.ask('a'), 'live');
	assert.equal(await client.ask('b'), 'live');
	assert.equal(await client.ask('c'), 'kept');
	assert.deepEqual(under.asked, ['a undefined', 'b undefined']);
});

test('everything but ask goes to the client, and a page with no answers gets the client itself', () => {
	const under = recording();
	assert.equal(replay(under, { getElementById: () => null }), under);
	assert.equal(replay(under), under, 'a process with no document has no page to read');
	// A document that cannot look anything up would ask the server for every read, silently.
	assert.throws(() => replay(under, {} as never), { reason: 'no-lookup' });

	const client = replay(under, carrying({ 'x null': [{ result: 1 }] }));
	assert.equal(client.status, under.status);
	client.share('board');
	client.reconnect();
	client.close();
	assert.deepEqual(under.others, ['share board', 'reconnect', 'close']);
});

test('a page rendered on request is taken over with no read reaching the client', async () => {
	const dist = join(space.dir, 'dist');
	mkdirSync(dist, { recursive: true });
	writeFileSync(join(dist, 'index.html'), SHELL);
	const POSTS = [{ id: 'one', title: 'First light' }];
	const pages = createPages({
		page: (router, client) => h(Site, { router, client }),
		gate: open,
		modules: { 'posts/List': { call: () => POSTS } },
		dir: dist,
	});
	const html = await (await pages.request(new Request('http://site.test/')))!.text();

	// The page as a browser parses it: the body's markup, stamped, and the head's answers.
	const document = createDocument();
	document.body.setAttribute(STAMP, '');
	const body = html.slice(html.indexOf('>', html.indexOf('<body')) + 1, html.lastIndexOf('</body>'));
	for (const node of parseHtml(body, document)) document.body.appendChild(node);
	const script = /id="aweft-answers">([\s\S]*?)<\/script>/.exec(html)![1]!;
	const source = Object.assign(document, { getElementById: (id: string) => (id === 'aweft-answers' ? { textContent: script } : null) });

	const before = elementsIn(document.body.firstChild);
	assert.ok(before.length > 2, 'the server wrote a page');

	const under = recording();
	const client = replay(under, source);
	const stop = attach(document.body as never, h(Site, { router: createRouter({ url: '/' }), client }));
	await (stop as unknown as { ready: Promise<void> }).ready;
	assert.deepEqual(under.asked, [], 'the hydration asked nothing the render had asked');
	assert.deepEqual(elementsIn(document.body.firstChild), before, 'and adopted every element the server wrote');
	assert.ok(document.body.textContent?.includes('First light'), 'and the page is the one the server wrote');

	// The hydration has settled, so what was left is gone and the next ask is live.
	assert.equal(await client.ask('posts/List'), 'live');
	stop();
});

test('attach drops what the hydration did not use, so a later ask is live', async () => {
	// A page that asks nothing, so the recorded answer is still there when the hydration settles.
	const Quiet = (): unknown => h('p', {}, 'quiet');
	const document = createDocument();
	document.body.setAttribute(STAMP, '');
	for (const node of parseHtml(await render(h(Quiet, {})), document)) document.body.appendChild(node);
	const source = Object.assign(document, carrying({ 'posts/List null': [{ result: ['recorded'] }] }));
	const under = recording();
	const client = replay(under, source);
	const stop = attach(document.body as never, h(Quiet, {}));
	await (stop as unknown as { ready: Promise<void> }).ready;
	await Promise.resolve();
	assert.equal(await client.ask('posts/List'), 'live');
	stop();
});
