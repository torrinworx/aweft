// The head system: which tag of a group wins, what order they come out in, what a page adopts,
// and what two renders in one process can see of each other (design 127).

import test from 'node:test';
import assert from 'node:assert/strict';

import { mutable } from '@aweftjs/core';
import { createDocument, parseHtml, toHtml } from '@aweftjs/dom';
import type { LightDocument } from '@aweftjs/dom';
import { recordingDocument } from '@aweftjs/testing';
import {
	Head, Link, Meta, Script, Style, Title,
	context, h, hydrate, mount, render,
} from '@aweftjs/ui';

/** The head markup of one static render of an item. */
const headOf = async (item: unknown): Promise<string> => {
	const own = context();
	await render(item, { context: own });
	return own.head.markup();
};

/** Let one round of deliveries run: a cell reaches its watchers on the next job, not the next line. */
const settle = async (): Promise<void> => {
	for (let i = 0; i < 4; i += 1) await Promise.resolve();
};

/** One tag in the head, by name. */
const headTag = (document: LightDocument, name: string): { localName: string; textContent: string | null } => {
	for (let node = document.head.firstChild; node !== null; node = node.nextSibling) {
		const element = node as unknown as { localName: string; textContent: string | null };
		if (node.nodeType === 1 && element.localName === name) return element;
	}
	throw new Error(`no <${name}> in the head`);
};

/** The tag names in the head, in order, ignoring the theme's stylesheet. */
const tagsIn = (document: LightDocument): string[] => {
	const found: string[] = [];
	for (let node = document.head.firstChild; node !== null; node = node.nextSibling) {
		if (node.nodeType !== 1) continue;
		const element = node as unknown as { localName: string; getAttribute(name: string): string | null };
		if (element.getAttribute('data-aweft') !== null) continue;
		found.push(element.localName);
	}
	return found;
};

test('a title written in the page reaches the head list and nothing else', async () => {
	const own = context();
	const body = await render(h(Title, {}, 'Home'), { context: own });
	assert.equal(own.head.title(), 'Home');
	assert.equal(own.head.markup(), '<title data-aweft-head="title">Home</title>');
	// A head component renders nothing where it is written: the body holds its marker region only.
	assert.equal(body.replace(/<!--\[-->|<!--\]-->/g, ''), '');
});

test('the deepest Head wins, and sequence breaks a tie', async () => {
	const layout = (inner: unknown): unknown => [h(Title, {}, 'Layout'), inner];

	assert.match(
		await headOf(layout(h(Head, {}, h(Title, {}, 'Page')))),
		/>Page</,
		'a page inside one Head beats a title written outside every Head',
	);

	assert.match(
		await headOf(layout(h(Head, {}, h(Head, {}, h(Title, {}, 'Deeper'))))),
		/>Deeper</,
	);

	// Same depth: the one added later wins.
	assert.match(
		await headOf([h(Head, {}, h(Title, {}, 'First')), h(Head, {}, h(Title, {}, 'Second'))]),
		/>Second</,
	);

	// Depth beats sequence, so a shallower title written afterwards does not take it back.
	assert.match(
		await headOf([h(Head, {}, h(Title, {}, 'Deep')), h(Title, {}, 'Shallow')]),
		/>Deep</,
	);
});

test('a group comes from the tag identity, one kind at a time', async () => {
	// meta by name
	assert.equal(
		await headOf([h(Meta, { name: 'description', content: 'one' }), h(Meta, { name: 'description', content: 'two' })]),
		'<meta name="description" content="two" data-aweft-head="meta:name=description">',
	);
	// meta by property, which is a different group from meta by name
	assert.match(
		await headOf([h(Meta, { name: 'x', content: 'a' }), h(Meta, { property: 'x', content: 'b' })]),
		/name="x"[^>]*>.*property="x"/s,
	);
	// meta by charset, and by http-equiv
	assert.equal(
		await headOf([h(Meta, { charset: 'utf-8' }), h(Meta, { charset: 'utf-16' })]),
		'<meta charset="utf-16" data-aweft-head="meta:charset">',
	);
	assert.equal(
		await headOf([h(Meta, { httpEquiv: 'refresh', content: '1' }), h(Meta, { httpEquiv: 'refresh', content: '2' })]),
		'<meta http-equiv="refresh" content="2" data-aweft-head="meta:http-equiv=refresh">',
	);
	// a meta with none of the four is additive
	assert.equal(
		(await headOf([h(Meta, { content: 'a' }), h(Meta, { content: 'b' })])).match(/<meta/g)?.length,
		2,
	);

	// link by rel and href together, so two stylesheets both survive
	assert.equal(
		(await headOf([
			h(Link, { rel: 'stylesheet', href: '/a.css' }),
			h(Link, { rel: 'stylesheet', href: '/b.css' }),
		])).match(/<link/g)?.length,
		2,
	);
	assert.equal(
		(await headOf([
			h(Link, { rel: 'stylesheet', href: '/a.css' }),
			h(Link, { rel: 'stylesheet', href: '/a.css' }),
		])).match(/<link/g)?.length,
		1,
	);
	// canonical is one per page whatever it points at
	assert.equal(
		await headOf([
			h(Link, { rel: 'canonical', href: '/a' }),
			h(Link, { rel: 'canonical', href: '/b' }),
		]),
		'<link rel="canonical" href="/b" data-aweft-head="link:canonical">',
	);
	// a link with no rel is additive
	assert.equal((await headOf([h(Link, { href: '/a' }), h(Link, { href: '/b' })])).match(/<link/g)?.length, 2);

	// script by src, and inline by type
	assert.equal(
		(await headOf([h(Script, { src: '/a.js' }), h(Script, { src: '/a.js' }), h(Script, { src: '/b.js' })]))
			.match(/<script/g)?.length,
		2,
	);
	assert.equal(
		await headOf([h(Script, {}, 'one()'), h(Script, {}, 'two()')]),
		'<script data-aweft-head="script:inline|">two()</script>',
	);
	// style by media
	assert.equal(
		(await headOf([h(Style, {}, 'a{}'), h(Style, { media: 'print' }, 'b{}')])).match(/<style/g)?.length,
		2,
	);
	assert.equal((await headOf([h(Style, {}, 'a{}'), h(Style, {}, 'b{}')])).match(/<style/g)?.length, 1);
});

test('an explicit key makes a group where the format gives none, and splits one it gives', async () => {
	// Two inline scripts are one group; a key each keeps both.
	assert.equal(
		(await headOf([h(Script, { key: 'one' }, 'a()'), h(Script, { key: 'two' }, 'b()')])).match(/<script/g)?.length,
		2,
	);
	// Two metas with no identity are additive; one key over both makes them compete.
	assert.equal(
		(await headOf([h(Meta, { key: 'note', content: 'a' }), h(Meta, { key: 'note', content: 'b' })]))
			.match(/<meta/g)?.length,
		1,
	);
});

test('tags come out in one fixed order however they were written', async () => {
	const markup = await headOf([
		h(Script, { src: '/late.js' }),
		h(Link, { rel: 'stylesheet', href: '/a.css' }),
		h(Style, {}, 'a{}'),
		h(Link, { rel: 'preconnect', href: 'https://cdn.example.com' }),
		h(Title, {}, 'Ordered'),
		h(Meta, { name: 'description', content: 'x' }),
		h(Meta, { name: 'viewport', content: 'width=device-width' }),
		h(Meta, { charset: 'utf-8' }),
	]);
	const order = [...markup.matchAll(/<(title|meta|link|style|script)[^>]*>/g)]
		.map((found) => {
			const tag = found[0];
			if (tag.includes('charset')) return 'charset';
			if (tag.includes('viewport')) return 'viewport';
			if (tag.includes('preconnect')) return 'preconnect';
			return found[1]!;
		});
	assert.deepEqual(order, ['charset', 'viewport', 'meta', 'title', 'preconnect', 'style', 'link', 'script']);
});

test('a cell in a tag rewrites it in place rather than replacing the element', async () => {
	const title = mutable('First');
	const { document, ops } = recordingDocument();
	const stop = mount(document.body as never, h(Title, {}, title));

	const made = headTag(document as unknown as LightDocument, 'title');
	assert.equal(made.textContent, 'First');

	ops.length = 0;
	title.set('Second');
	await settle();

	assert.equal(made.textContent, 'Second');
	assert.equal(headTag(document as unknown as LightDocument, 'title'), made, 'the same element, rewritten');
	assert.deepEqual(ops.filter((line) => line.includes('<head>')), [],
		'nothing was taken out of the head or put into it');
	stop();
});

test('mount writes the tags into the head in order and takes them back out', () => {
	const document = createDocument();
	const stop = mount(document.body as never, [
		h(Script, { src: '/a.js' }),
		h(Title, {}, 'Page'),
		h(Meta, { charset: 'utf-8' }),
	]);
	assert.deepEqual(tagsIn(document), ['meta', 'title', 'script']);
	stop();
	assert.deepEqual(tagsIn(document), []);
});

test('hydration adopts the stamped tags the server wrote, with no remove and no createElement', () => {
	const page = (): unknown => [
		h(Title, {}, 'Adopted'),
		h(Meta, { name: 'description', content: 'a page' }),
		h(Link, { rel: 'stylesheet', href: '/a.css' }),
		h('p', {}, 'body'),
	];

	const server = context();
	const { document, ops } = recordingDocument();
	const light = document as unknown as LightDocument;

	return render(h(page), { context: server }).then((body) => {
		const head = server.head.markup();
		for (const node of parseHtml(body, light)) light.body.appendChild(node);
		for (const node of parseHtml(head, light)) light.head.appendChild(node);
		assert.deepEqual(tagsIn(light), ['meta', 'title', 'link']);

		// The client builds its own body tree and pairs it with the server's (design 077), so the
		// `p` is made here. No head tag is: those are claimed off the server's <head>.
		const made: string[] = [];
		const factory = light.createElement.bind(light);
		(light as unknown as Record<string, unknown>)['createElement'] = (tag: string) => {
			made.push(tag);
			return factory(tag);
		};

		ops.length = 0;
		const stop = hydrate(document.body as never, page);

		assert.deepEqual(made, ['p'], 'every head tag was adopted rather than made');
		assert.deepEqual(ops.filter((line) => line.includes('from <head>')), [],
			'no tag was removed and put back');
		assert.deepEqual(tagsIn(light), ['meta', 'title', 'link']);
		assert.equal(toHtml(light.head.childNodes).includes('data-aweft-head="title"'), true);
		stop();
		assert.deepEqual(tagsIn(light), [], 'unmounting takes the adopted tags out too');
	});
});

test('two renders in one process share no head tags', async () => {
	const a = context();
	const b = context();
	const [one, two] = await Promise.all([
		render(h(Title, {}, 'One'), { context: a }),
		render([h(Title, {}, 'Two'), h(Meta, { name: 'description', content: 'only b' })], { context: b }),
	]);
	assert.equal(one.replace(/<!--.?-->/g, ''), '', 'neither render put anything in its body');
	assert.equal(two.replace(/<!--.?-->/g, ''), '');
	assert.equal(a.head.title(), 'One');
	assert.equal(b.head.title(), 'Two');
	assert.equal(a.head.markup().includes('only b'), false);
	assert.equal(a.head.markup().match(/<(title|meta)/g)?.length, 1);
	assert.equal(b.head.markup().match(/<(title|meta)/g)?.length, 2);
});

test('inline text that would close its own element is refused with the fix', async () => {
	await assert.rejects(
		() => headOf(h(Style, {}, 'a::before { content: "</style>"; }')),
		/cannot hold the text/,
	);
	await assert.rejects(
		() => headOf(h(Script, {}, 'const a = "</script>";')),
		/cannot hold the text/,
	);
});

test('a page with no title answers null rather than an empty string', async () => {
	const own = context();
	await render(h(Meta, { name: 'description', content: 'x' }), { context: own });
	assert.equal(own.head.title(), null);
});

test('the tags go in front of what the page shell already wrote, so a shell title cannot win', () => {
	const document = createDocument();
	for (const node of parseHtml('<title>shell</title><link rel="icon" href="/favicon.ico">', document)) {
		document.head.appendChild(node);
	}

	const stop = mount(document.body as never, h(Title, {}, 'the page'));
	const heads = toHtml(document.head.childNodes);
	assert.match(heads, /^<title data-aweft-head="title">the page<\/title><title>shell<\/title>/,
		'document.title is the first title element there is, so an appended one would do nothing');
	stop();
	assert.match(toHtml(document.head.childNodes), /^<title>shell<\/title>/, 'and the shell keeps its own');
});

test('a page shell\'s leading charset stays first, and the run goes in behind it', () => {
	const document = createDocument();
	for (const node of parseHtml('<meta charset="utf-8"><title>shell</title>', document)) {
		document.head.appendChild(node);
	}

	const stop = mount(document.body as never, [h(Title, {}, 'the page'), h(Meta, { name: 'description', content: 'x' })]);
	const heads = toHtml(document.head.childNodes);
	assert.match(heads, /^<meta charset="utf-8">/,
		'a charset read late is a charset not read, so it is the one tag the run goes behind');
	assert.match(heads, /^<meta charset="utf-8"><meta name="description"[^>]*><title data-aweft-head="title">the page<\/title><title>shell<\/title>/,
		'and the rest of the run is still in front of everything the shell wrote');
	stop();
	assert.match(toHtml(document.head.childNodes), /^<meta charset="utf-8"><title>shell<\/title>/,
		'and the shell keeps what it wrote, in the order it wrote it');
});

test('two renders mounted into one document each keep their title, and the last one takes the tab', () => {
	const document = createDocument();
	const first = context();
	const second = context();

	const one = mount(document.body as never, h(Title, {}, 'First render'), undefined, first);
	const two = mount(document.body as never, h(Title, {}, 'Second render'), undefined, second);

	// Each run goes to the front, so the run mounted last is in front of the run before it, and
	// `document.title` is the first title element there is. This is why a page uses one render.
	assert.match(toHtml(document.head.childNodes),
		/^<title data-aweft-head="title">Second render<\/title><title data-aweft-head="title">First render<\/title>/);

	two();
	assert.match(toHtml(document.head.childNodes), /^<title data-aweft-head="title">First render<\/title>/,
		'and taking one render down leaves the other render\'s title alone');
	one();
});
