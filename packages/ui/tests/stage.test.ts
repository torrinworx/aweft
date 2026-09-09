// The stage: what the URL decides, what an open decides, how a nested stage gets its part of the
// path, and what a static walk can read back (designs 122 to 126).
//
// Everything here runs with no window, so the router is its memory implementation and the act
// change effects are no-ops. What a real browser does with focus, the live region and scroll is
// in `browser.test.ts` and in `recipes/routed-site`.

import test from 'node:test';
import assert from 'node:assert/strict';

import { mutable } from '@aweftjs/core';
import { createDocument, toHtml } from '@aweftjs/dom';
import { createRouter } from '@aweftjs/dom/router';
import type { LightDocument } from '@aweftjs/dom';
import {
	LoaderContext, Shown, Stage, StageContext, Title,
	context, h, mount, render,
} from '@aweftjs/ui';
import type { Render, StageValue } from '@aweftjs/ui';

/** Let the deliveries a write started run. */
const settle = async (): Promise<void> => {
	for (let i = 0; i < 6; i += 1) await Promise.resolve();
};

/** The page's text, with the live region and the mount markers taken out. */
const textOf = (document: LightDocument): string =>
	toHtml(document.body.childNodes)
		.replace(/<div aria-live[^>]*><\/div>/, '')
		.replace(/<!--.?-->/g, '');

const page = (name: string) => (): unknown => h('main', { id: name }, name);

test('a stage that was given no router does not follow one that exists', async () => {
	const router = createRouter({ url: '/about' });
	const document = createDocument();
	const stop = mount(document.body as never, h(StageContext, {
		acts: { '': page('home'), about: page('about') },
		initial: '',
	} as never, h(Stage, {})));

	assert.equal(textOf(document), '<main id="home">home</main>');
	router.push('/about');
	await settle();
	assert.equal(textOf(document), '<main id="home">home</main>', 'the URL is not this stage\'s business');
	stop();
});

test('a routed stage follows the router, and the fallback is what an unmatched path gets', async () => {
	const router = createRouter({ url: '/about' });
	const document = createDocument();
	const stop = mount(document.body as never, h(StageContext, {
		router,
		acts: { '': page('home'), about: page('about'), missing: page('404') },
		fallback: 'missing',
	} as never, h(Stage, {})));

	assert.equal(textOf(document), '<main id="about">about</main>');

	router.push('/nowhere');
	await settle();
	assert.equal(textOf(document), '<main id="404">404</main>', 'the fallback is matched last');

	router.push('/');
	await settle();
	assert.equal(textOf(document), '<main id="home">home</main>');
	stop();
});

test('with no router the stage shows initial and is driven by open and close', async () => {
	const document = createDocument();
	let stage: StageValue | null = null;
	const Grab = StageContext.use((found) => () => {
		stage = found;
		return null;
	});

	const stop = mount(document.body as never, h(StageContext, {
		acts: { one: page('one'), two: page('two') },
		initial: 'one',
	} as never, h(Stage, {}), h(Grab, {})));

	assert.equal(textOf(document), '<main id="one">one</main>');
	stage!.open({ name: 'two' });
	await settle();
	assert.equal(textOf(document), '<main id="two">two</main>');
	stage!.close();
	await settle();
	assert.equal(textOf(document), '<main id="one">one</main>');
	stop();
});

test('open props do not accumulate across opens', async () => {
	const document = createDocument();
	let stage: StageValue | null = null;
	const Grab = StageContext.use((found) => () => {
		stage = found;
		return null;
	});
	const Panel = (props: { title?: unknown; tone?: unknown }): unknown =>
		h('main', {}, `${String(props.title ?? '-')}/${String(props.tone ?? '-')}`);

	const stop = mount(document.body as never, h(StageContext, {
		acts: { panel: Panel, blank: page('blank') },
		initial: 'blank',
	} as never, h(Stage, {}), h(Grab, {})));

	stage!.open({ name: 'panel', title: 'first', tone: 'loud' });
	await settle();
	assert.equal(textOf(document), '<main>first/loud</main>');

	stage!.open({ name: 'panel', title: 'second' });
	await settle();
	assert.equal(textOf(document), '<main>second/-</main>', 'the second open kept none of the first one\'s props');
	stop();
});

test('a stage calls its template with the props the open carried', async () => {
	// Design 213. Before this, a template was called with `{}`, so a `Modal` opened with a `label`
	// had to be named in a closure written per open.
	const document = createDocument();
	let stage: StageValue | null = null;
	const Grab = StageContext.use((found) => () => {
		stage = found;
		return null;
	});

	const seen: Record<string, unknown>[] = [];
	const Frame = (props: { children?: unknown[]; [prop: string]: unknown }): unknown => {
		const { children, ...rest } = props;
		seen.push(rest);
		return h('section', {}, ...(children ?? []));
	};
	const Act = (props: { label?: unknown; stage?: unknown }): unknown =>
		h('main', {}, `${String(props.label ?? '-')}/${props.stage === null ? 'no' : 'yes'}`);

	const stop = mount(document.body as never, h(StageContext, {
		acts: { panel: Act, blank: page('blank') },
		initial: 'blank',
		template: Frame,
	} as never, h(Stage, {}), h(Grab, {})));

	assert.deepEqual(seen[0], {}, 'an act reached with no open carried nothing');

	stage!.open({ name: 'panel', template: Frame, label: 'Sign out?', history: false });
	await settle();
	assert.deepEqual(seen[seen.length - 1], { label: 'Sign out?' },
		'the template sees what the open carried, and none of name, template or history');
	assert.equal(textOf(document), '<section><main>Sign out?/yes</main></section>',
		'and the act sees the same props, with the stage after them');
	stop();
});

test('an open with a history entry leaves the URL alone, and back dismisses it', async () => {
	const router = createRouter({ url: '/' });
	const document = createDocument();
	let stage: StageValue | null = null;
	const Grab = StageContext.use((found) => () => {
		stage = found;
		return null;
	});

	const stop = mount(document.body as never, h(StageContext, {
		router,
		acts: { '': page('home'), modal: page('modal') },
	} as never, h(Stage, {}), h(Grab, {})));

	const before = router.key.get();
	stage!.open({ name: 'modal', history: true });
	await settle();
	assert.equal(textOf(document), '<main id="modal">modal</main>');
	assert.equal(router.url.get(), '/', 'the address bar did not move');
	assert.notEqual(router.key.get(), before, 'it took a history entry of its own');

	router.back();
	await settle();
	assert.equal(textOf(document), '<main id="home">home</main>', 'back dismissed it');
	assert.equal(router.key.get(), before);

	// close() on an owned entry goes back, so a button and the back button are one navigation.
	stage!.open({ name: 'modal', history: true });
	await settle();
	stage!.close();
	await settle();
	assert.equal(textOf(document), '<main id="home">home</main>');
	assert.equal(router.key.get(), before);
	stop();
});

test('a navigation drops an open that owns no history entry', async () => {
	const router = createRouter({ url: '/' });
	const document = createDocument();
	let stage: StageValue | null = null;
	const Grab = StageContext.use((found) => () => {
		stage = found;
		return null;
	});
	const stop = mount(document.body as never, h(StageContext, {
		router,
		acts: { '': page('home'), about: page('about'), modal: page('modal') },
	} as never, h(Stage, {}), h(Grab, {})));

	stage!.open({ name: 'modal' });
	await settle();
	assert.equal(textOf(document), '<main id="modal">modal</main>');
	router.push('/about');
	await settle();
	assert.equal(textOf(document), '<main id="about">about</main>');
	stop();
});

test('writing the query cell updates the URL with replace, not push', async () => {
	const router = createRouter({ url: '/search?q=cats' });
	const document = createDocument();
	let stage: StageValue | null = null;
	const Grab = StageContext.use((found) => () => {
		stage = found;
		return null;
	});
	const stop = mount(document.body as never, h(StageContext, {
		router,
		acts: { search: page('search') },
	} as never, h(Stage, {}), h(Grab, {})));

	assert.deepEqual(stage!.query.get(), { q: 'cats' }, 'the URL filled the cell');

	const key = router.key.get();
	stage!.query.set({ q: 'dogs', page: '2' });
	await settle();
	assert.equal(router.url.get(), '/search?page=2&q=dogs');
	assert.equal(router.key.get(), key, 'the query went on the entry that was already there');
	assert.equal(textOf(document), '<main id="search">search</main>', 'and the act did not change');

	// The other direction: a navigation refills the cell.
	router.push('/search?q=birds');
	await settle();
	assert.deepEqual(stage!.query.get(), { q: 'birds' });
	stop();
});

test('a nested stage takes the tail its parent did not match', async () => {
	const router = createRouter({ url: '/posts/3/edit' });
	const document = createDocument();

	const Post = (): unknown => h(StageContext, {
		acts: { '': page('read'), edit: page('edit') },
	} as never, h(Stage, {}));

	const stop = mount(document.body as never, h(StageContext, {
		router,
		acts: { 'posts/:id': Post },
	} as never, h(Stage, {})));

	assert.equal(textOf(document), '<main id="edit">edit</main>', 'the deep link opened the nested act');

	router.push('/posts/3');
	await settle();
	assert.equal(textOf(document), '<main id="read">read</main>', 'the child follows the tail');
	stop();
});

test('a tail nobody has claimed waits, and the next navigation drops it', async () => {
	const router = createRouter({ url: '/posts/3/edit' });
	const document = createDocument();
	const showing = mutable(false);

	const Post = (): unknown => h(Shown, { value: showing },
		h(StageContext, { acts: { '': page('read'), edit: page('edit') }, initial: '' } as never, h(Stage, {})));

	const stop = mount(document.body as never, h(StageContext, {
		router,
		acts: { 'posts/:id': Post },
	} as never, h(Stage, {})));

	assert.equal(textOf(document), '', 'no child stage yet');

	// The child mounts after the deep link, and takes the tail that was waiting for it.
	showing.set(true);
	await settle();
	assert.equal(textOf(document), '<main id="edit">edit</main>');

	// Take it away, navigate, and bring it back: the old tail is gone rather than remembered.
	showing.set(false);
	await settle();
	router.push('/posts/3');
	await settle();
	showing.set(true);
	await settle();
	assert.equal(textOf(document), '<main id="read">read</main>', 'the tail was dropped on the navigation');
	stop();
});

test('one child stage claims the tail and a second runs on initial', async () => {
	const router = createRouter({ url: '/shell/edit' });
	const document = createDocument();

	const Shell = (): unknown => [
		h(StageContext, { acts: { '': page('one-read'), edit: page('one-edit') } } as never, h(Stage, {})),
		h(StageContext, { acts: { '': page('two-read'), edit: page('two-edit') }, initial: '' } as never, h(Stage, {})),
	];

	const stop = mount(document.body as never, h(StageContext, {
		router,
		acts: { shell: Shell },
	} as never, h(Stage, {})));

	assert.equal(
		textOf(document),
		'<main id="one-edit">one-edit</main><main id="two-read">two-read</main>',
		'the first stage under the act routes and the second is a content swapper',
	);
	stop();
});

test('a lazy act arrives through suspend, with the LoaderContext fallback while it does', async () => {
	const router = createRouter({ url: '/late' });
	const document = createDocument();
	const Spinner = (): unknown => h('p', {}, 'loading');

	const stop = mount(document.body as never,
		h(LoaderContext, { value: { loading: Spinner } },
			h(StageContext, {
				router,
				acts: { late: { load: async () => ({ default: page('late') }) } },
			} as never, h(Stage, {}))));

	assert.equal(textOf(document), '<p>loading</p>');
	await settle();
	assert.equal(textOf(document), '<main id="late">late</main>');
	stop();
});

test('each stage puts one entry in the render registry, with its acts, prefix and parent', async () => {
	const router = createRouter({ url: '/posts/3/edit' });
	const own: Render = context();

	const Edit = (): unknown => h('main', {}, 'edit');
	const Post = (): unknown => h(StageContext, { acts: { '': page('read'), edit: Edit } } as never, h(Stage, {}));
	const Listing = (): unknown => h('main', {}, 'listing');
	Listing.entries = async () => [{ id: '1' }, { id: '2' }];

	const item = h(StageContext, {
		router,
		acts: { '': Listing, 'posts/:id': Post, about: { load: async () => ({ default: page('about') }) } },
		fallback: 'about',
	} as never, h(Stage, {}));

	const document = createDocument();
	const stop = mount(document.body as never, item, undefined, own);

	const seen = own.stage.items.map((entry) => ({
		acts: entry.acts.map((act) => `${act.name}:${act.loader ? 'lazy' : 'act'}:${act.entries === null ? '-' : 'entries'}`),
		prefix: entry.prefix,
		parent: entry.parent,
	}));
	assert.equal(seen.length, 2, 'the root stage and the one nested in the act');
	assert.deepEqual(seen[0]!.acts, [':act:entries', 'posts/:id:act:-', 'about:lazy:-']);
	assert.equal(seen[0]!.prefix, '');
	assert.equal(seen[0]!.parent, null);
	assert.deepEqual(seen[1]!.acts, [':act:-', 'edit:act:-']);
	assert.equal(seen[1]!.prefix, 'posts/3', 'the child\'s prefix is what its parent matched, not the pattern');
	assert.equal(seen[1]!.parent, own.stage.items[0]);

	// An act's parameter source is on the act's own row, and that is the only place it is.
	const rows = own.stage.items[0]!.acts;
	const listing = rows.find((act) => act.name === '')!;
	assert.notEqual(listing.entries, null);
	assert.deepEqual(await listing.entries!(), [{ id: '1' }, { id: '2' }]);
	assert.equal(rows.find((act) => act.name === 'posts/:id')!.entries, null);

	stop();
	assert.equal(own.stage.items.length, 0, 'a stage takes its entry out when it unmounts');
});

test('the act reads its params, and the title it declares reaches the head list', async () => {
	const router = createRouter({ url: '/posts/hello' });
	const own = context();
	const Post = StageContext.use((stage) => (): unknown => [
		h(Title, {}, `Post ${String(stage!.params.get()['id'])}`),
		h('main', {}, String(stage!.params.get()['id'])),
	]);

	await render(h(StageContext, {
		router,
		acts: { 'posts/:id': Post },
	} as never, h(Stage, {})), { context: own });

	assert.equal(own.head.title(), 'Post hello');
});

test('a Stage with no StageContext above it asserts and names the fix', () => {
	const document = createDocument();
	assert.throws(() => mount(document.body as never, h(Stage, {})), /wrap the page in <StageContext/);
});

test('a stage naming an act it does not declare asserts', () => {
	const document = createDocument();
	assert.throws(
		() => mount(document.body as never, h(StageContext, { acts: {}, fallback: 'nope' } as never, h(Stage, {}))),
		/acts has no such key/,
	);
});

test('an act change announces the new title and puts the page back at the top', async () => {
	const router = createRouter({ url: '/' });
	const document = createDocument();
	const scrolls: [number, number][] = [];
	const held = (globalThis as { window?: unknown }).window;
	(globalThis as { window?: unknown }).window = { scrollTo: (x: number, y: number) => { scrolls.push([x, y]); } };

	try {
		const titled = (name: string) => (): unknown => [h(Title, {}, `The ${name} page`), h('main', { id: name }, name)];
		const stop = mount(document.body as never, h(StageContext, {
			router,
			acts: { '': titled('home'), about: titled('about') },
		} as never, h(Stage, {})));

		const region = document.body.firstChild as unknown as { textContent: string | null };
		assert.equal(region.textContent, '', 'the first act is a page load, not a change');
		assert.deepEqual(scrolls, [], 'and the browser has already put the page where the URL asked');

		router.push('/about');
		await settle();
		assert.equal(region.textContent, 'The about page', 'the title the head list resolved');
		assert.deepEqual(scrolls, [[0, 0]], 'a new act with no saved position starts at the top');
		stop();
	} finally {
		if (held === undefined) delete (globalThis as { window?: unknown }).window;
		else (globalThis as { window?: unknown }).window = held;
	}
});

test('a tail-only navigation changes the child act and leaves the parent act mounted', async () => {
	const router = createRouter({ url: '/posts/3/edit' });
	const document = createDocument();
	let built = 0;

	const Post = (): unknown => {
		built += 1;
		return h(StageContext, {
			acts: { edit: page('edit'), comments: page('comments') },
		} as never, h(Stage, {}));
	};

	const stop = mount(document.body as never, h(StageContext, {
		router,
		acts: { 'posts/:id': Post },
	} as never, h(Stage, {})));

	assert.equal(built, 1);
	assert.equal(textOf(document), '<main id="edit">edit</main>');

	router.push('/posts/3/comments');
	await settle();
	assert.equal(textOf(document), '<main id="comments">comments</main>', 'the child followed the tail');
	assert.equal(built, 1, 'and the act above it was not rebuilt: only its tail changed');

	// A parameter change is a different page, so the act above is rebuilt.
	router.push('/posts/4/edit');
	await settle();
	assert.equal(built, 2);
	assert.equal(textOf(document), '<main id="edit">edit</main>');
	stop();
});

test('an act is handed the stage as a prop, so it reads params and query without a context', async () => {
	const router = createRouter({ url: '/posts/hello?sort=new' });
	const document = createDocument();

	// No StageContext.use and no read(context): the act takes the stage as an argument.
	const Post = (props: { stage?: StageValue }): unknown => h('main', {},
		`${String(props.stage!.params.get()['id'])}/${String(props.stage!.query.get()['sort'])}`);

	const stop = mount(document.body as never, h(StageContext, {
		router,
		acts: { 'posts/:id': Post },
	} as never, h(Stage, {})));

	assert.equal(textOf(document), '<main>hello/new</main>');
	stop();
});

test('a lazy act is handed the stage too, once it has arrived', async () => {
	const router = createRouter({ url: '/posts/late' });
	const document = createDocument();
	const Post = (props: { stage?: StageValue }): unknown => h('main', {}, String(props.stage!.params.get()['id']));

	const stop = mount(document.body as never, h(StageContext, {
		router,
		acts: { 'posts/:id': { load: async () => ({ default: Post }) } },
	} as never, h(Stage, {})));

	await settle();
	assert.equal(textOf(document), '<main>late</main>');
	stop();
});

test('a second history open replaces the first, so one back closes it and lands on the page', async () => {
	const router = createRouter({ url: '/' });
	const document = createDocument();
	let stage: StageValue | null = null;
	const Grab = StageContext.use((found) => () => {
		stage = found;
		return null;
	});

	const stop = mount(document.body as never, h(StageContext, {
		router,
		acts: { '': page('home'), modal: page('modal'), sheet: page('sheet') },
	} as never, h(Stage, {}), h(Grab, {})));

	const home = router.key.get();
	stage!.open({ name: 'modal', history: true });
	await settle();
	const owned = router.key.get();
	assert.notEqual(owned, home, 'the first open took an entry');

	stage!.open({ name: 'sheet', history: true });
	await settle();
	assert.equal(textOf(document), '<main id="sheet">sheet</main>');
	assert.equal(router.key.get(), owned, 'the second open replaced that entry rather than pushing a second');

	router.back();
	await settle();
	assert.equal(textOf(document), '<main id="home">home</main>', 'one back closed whatever was open');
	assert.equal(router.key.get(), home, 'and landed on the page, with no entry of the stage left behind');
	stop();
});
