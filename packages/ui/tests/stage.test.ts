// The stage: what the URL decides, what an open decides, how a nested stage gets its part of the
// path, and what a static walk can read back (designs 122 to 126).
//
// Everything here runs with no window, so the router is its memory implementation and the act
// change effects are no-ops. What a real browser does with focus, the live region and scroll is
// in `browser.test.ts` and in `recipes/routed-site`.

import test from 'node:test';
import assert from 'node:assert/strict';

import { mutable } from '@aweftjs/core';
import { fromBundle } from '@aweftjs/modules';
import type { Source } from '@aweftjs/modules';
import { createDocument, parseHtml, toHtml } from '@aweftjs/dom';
import { createRouter } from '@aweftjs/dom/router';
import type { LightDocument } from '@aweftjs/dom';
import {
	LoaderContext, Shown, Stage, StageContext, Title,
	context, h, hydrate, mount, render,
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

/** A source over modules written out here, named the way an acts map names them. */
// The map is written out here rather than imported, so an entry may carry an `entries` export
// beside the three the contract names.
const source = (map: Readonly<Record<string, Record<string, unknown>>>): Source =>
	fromBundle(map as never, { prefix: '' });

/** An act module that answers with one component and nothing else. */
const act = (name: string, extra: Record<string, unknown> = {}): Record<string, unknown> =>
	({ ...extra, default: () => ({ component: page(name) }) });

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

test('a named act arrives through suspend, with the LoaderContext fallback while it does', async () => {
	const router = createRouter({ url: '/late' });
	const document = createDocument();
	const Spinner = (): unknown => h('p', {}, 'loading');

	const stop = mount(document.body as never,
		h(LoaderContext, { value: { loading: Spinner } },
			h(StageContext, {
				router,
				sources: [source({ 'site/Late.ts': act('late') })],
				acts: { late: 'site/Late' },
			} as never, h(Stage, {}))));

	assert.equal(textOf(document), '<p>loading</p>');
	await loaded();
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
		sources: [source({ 'site/About.ts': act('about') })],
		acts: { '': Listing, 'posts/:id': Post, about: 'site/About' },
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
	// A named act always has an `entries` to ask; what it answers is the module's own, or null.
	assert.deepEqual(seen[0]!.acts, [':act:entries', 'posts/:id:act:-', 'about:lazy:entries']);
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

test('a named act is handed the stage too, once it has arrived', async () => {
	const router = createRouter({ url: '/posts/late' });
	const document = createDocument();
	const Post = (props: { stage?: StageValue }): unknown => h('main', {}, String(props.stage!.params.get()['id']));

	const stop = mount(document.body as never, h(StageContext, {
		router,
		sources: [source({ 'posts/Page.ts': { default: () => ({ component: Post }) } })],
		acts: { 'posts/:id': 'posts/Page' },
	} as never, h(Stage, {})));

	await loaded();
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

// --- acts as modules (designs 242, 244) --------------------------------------------------------

/** Long enough for a load: several awaits down the loader, not a fixed number of microtasks. */
const loaded = async (): Promise<void> => { await new Promise((done) => setTimeout(done, 0)); };

test('a named act is loaded with its dependencies first, and the stage renders its component', async () => {
	const order: string[] = [];
	const router = createRouter({ url: '/notes' });
	const document = createDocument();

	const stop = mount(document.body as never, h(StageContext, {
		router,
		sources: [source({
			'notes/Current.ts': { default: () => { order.push('Current'); return { title: 'the board' }; } },
			'notes/Page.ts': {
				deps: ['notes/Current'],
				default: ({ imports }: { imports: Readonly<Record<string, unknown>> }) => {
					order.push('Page');
					const current = imports['Current'] as { title: string };
					return { component: (): unknown => h('main', { id: 'notes' }, current.title) };
				},
			},
		})],
		acts: { notes: 'notes/Page' },
	} as never, h(Stage, {})));

	await loaded();
	assert.deepEqual(order, ['Current', 'Page'], 'the dependency was built before the act that names it');
	assert.equal(textOf(document), '<main id="notes">the board</main>');
	stop();
});

test('leaving a named act unloads it, after the next act is showing, and keeps its dependencies', async () => {
	const order: string[] = [];
	const router = createRouter({ url: '/one' });
	const document = createDocument();
	const shared = { stop: () => { order.push('shared stopped'); } };

	const named = (name: string) => ({
		deps: ['app/Shared'],
		default: () => {
			order.push(`${name} loaded`);
			return { component: page(name), stop: () => { order.push(`${name} stopped`); } };
		},
	});

	const stop = mount(document.body as never, h(StageContext, {
		router,
		sources: [source({
			'app/Shared.ts': { default: () => { order.push('shared loaded'); return shared; } },
			'app/One.ts': named('one'),
			'app/Two.ts': named('two'),
		})],
		acts: { one: 'app/One', two: 'app/Two' },
	} as never, h(Stage, {})));

	await loaded();
	assert.equal(textOf(document), '<main id="one">one</main>');

	router.push('/two');
	await loaded();
	assert.equal(textOf(document), '<main id="two">two</main>');
	assert.deepEqual(order, ['shared loaded', 'one loaded', 'two loaded', 'one stopped'],
		'the outgoing act stopped after the incoming one was showing, and the shared module was built once');

	// The dependency both of them name is still loaded, which is what makes it worth being a
	// module: it is opened by the first page that needs it and is still there on the second.
	assert.ok(!order.includes('shared stopped'), 'the module they both depend on stayed loaded');

	stop();
	await loaded();
	assert.deepEqual(order.slice(-2), ['two stopped', 'shared stopped'],
		'and the page going away unloaded everything, in reverse load order');
});

test('a named act refused shows the act refused names, with the reason on it', async () => {
	const router = createRouter({ url: '/notes' });
	const document = createDocument();
	const Join = (props: { refusal?: unknown }): unknown =>
		h('main', { id: 'join' }, String((props.refusal as { reason?: string } | undefined)?.reason ?? 'none'));

	const stop = mount(document.body as never, h(StageContext, {
		router,
		sources: [source({
			'app/Gate.ts': {
				default: () => { throw Object.assign(new Error('nobody'), { reason: 'anonymous' }); },
			},
			'notes/Page.ts': { deps: ['app/Gate'], default: () => ({ component: page('notes') }) },
		})],
		acts: { notes: 'notes/Page', join: Join },
		refused: 'join',
	} as never, h(Stage, {})));

	await loaded();
	assert.equal(textOf(document), '<main id="join">anonymous</main>', 'the refused act, holding the reason');
	assert.equal(new URL(String(router.url.get()), 'http://x').pathname, '/notes', 'and the URL did not move');
	stop();
});

test('an error with no reason, and a name no source lists, are defects rather than refusals', async () => {
	const Broken = (props: { error?: unknown }): unknown => h('main', { id: 'broke' }, String(props.error));
	const Join = (): unknown => h('main', { id: 'join' }, 'join');

	const run = async (map: Record<string, Record<string, unknown>>, name: string): Promise<string> => {
		const document = createDocument();
		const stop = mount(document.body as never,
			h(LoaderContext, { value: { failed: Broken } },
				h(StageContext, {
					router: createRouter({ url: `/${name}` }),
					sources: [source(map)],
					acts: { [name]: `app/${name}`, join: Join },
					refused: 'join',
				} as never, h(Stage, {}))));
		await loaded();
		const text = textOf(document);
		stop();
		return text;
	};

	const bare = await run({ 'app/bare.ts': { default: () => { throw new Error('a bug'); } } }, 'bare');
	assert.match(bare, /id="broke"/, 'a factory that threw a bare error is a defect, not a refusal');
	assert.match(bare, /a bug/, 'and the error reaches the failed component');

	const gone = await run({ 'app/other.ts': { default: () => ({ component: page('other') }) } }, 'gone');
	assert.match(gone, /id="broke"/, 'a name no source lists is a defect too');
	assert.match(gone, /missing|not/, 'and it says what was wrong');
});

test('a nested stage shares the loader, and one with sources of its own is refused', async () => {
	const router = createRouter({ url: '/docs/install' });
	const document = createDocument();
	const outer = source({
		'docs/Shell.ts': {
			default: () => ({
				component: (): unknown => h('main', { id: 'docs' },
					h(StageContext, { acts: { ':page': 'docs/Page' }, initial: ':page' } as never, h(Stage, {}))),
			}),
		},
		'docs/Page.ts': { default: () => ({ component: page('page') }) },
	});

	const stop = mount(document.body as never, h(StageContext, {
		router, sources: [outer], acts: { docs: 'docs/Shell' },
	} as never, h(Stage, {})));
	await loaded();
	assert.match(textOf(document), /id="docs".*id="page"/, 'the child stage resolved a name through its parent\'s loader');
	stop();

	assert.throws(
		() => mount(createDocument().body as never, h(StageContext, {
			sources: [outer],
			acts: { '': (): unknown => h(StageContext, { sources: [outer], acts: { '': page('x') } } as never, h(Stage, {})) },
			initial: '',
		} as never, h(Stage, {}))),
		/cannot take sources of its own/,
	);
});

test('a stage refuses a named act it has no sources for, and a client with no sources', () => {
	assert.throws(
		() => mount(createDocument().body as never, h(StageContext, {
			acts: { late: 'site/Late' }, initial: 'late',
		} as never, h(Stage, {}))),
		/no stage above it was given sources/,
	);
	assert.throws(
		() => mount(createDocument().body as never, h(StageContext, {
			client: {}, acts: { '': page('home') }, initial: '',
		} as never, h(Stage, {}))),
		/given a client and no sources/,
	);
});

test('an act module that answers with no component is refused, naming what to return', async () => {
	const Broken = (props: { error?: unknown }): unknown => h('main', {}, String((props.error as Error).message));
	const document = createDocument();
	const stop = mount(document.body as never,
		h(LoaderContext, { value: { failed: Broken } },
			h(StageContext, {
				router: createRouter({ url: '/late' }),
				sources: [source({ 'site/Late.ts': { default: () => ({ title: 'no component' }) } })],
				acts: { late: 'site/Late' },
			} as never, h(Stage, {}))));

	await loaded();
	assert.match(textOf(document), /answered with no component/, 'the assert names what went wrong');
	assert.match(textOf(document), /return \{ component, title\? \}/, 'and what to return instead');
	stop();
});

test('the client the stage was given reaches every module, and its absence is an absent key', async () => {
	const seen: { held: boolean; key: boolean }[] = [];
	const map = {
		'site/Home.ts': {
			default: (props: Record<string, unknown>) => {
				seen.push({ held: props['client'] === here, key: 'client' in props });
				return { component: page('home') };
			},
		},
	};
	const here = { name: 'the connection' };

	for (const client of [here, undefined]) {
		const document = createDocument();
		const stop = mount(document.body as never, h(StageContext, {
			sources: [source(map)],
			...(client === undefined ? {} : { client }),
			acts: { '': 'site/Home' },
			initial: '',
		} as never, h(Stage, {})));
		await loaded();
		stop();
	}
	assert.deepEqual(seen, [{ held: true, key: true }, { held: false, key: false }],
		'the client is a prop when there is one, and there is no key at all when there is not');
});

test('an act module\'s entries are read from its exports, without its factory running', async () => {
	let built = 0;
	const own: Render = context();
	const document = createDocument();
	const stop = mount(document.body as never, h(StageContext, {
		sources: [source({
			'posts/Page.ts': {
				entries: async () => [{ id: 'one' }, { id: 'two' }],
				default: () => { built += 1; return { component: page('post') }; },
			},
			'tags/Page.ts': { default: () => { built += 1; return { component: page('tag') }; } },
		})],
		acts: { 'posts/:id': 'posts/Page', 'tags/:tag': 'tags/Page', '': page('home') },
		initial: '',
	} as never, h(Stage, {})), undefined, own);

	await loaded();
	const acts = own.stage.items[0]!.acts;
	assert.deepEqual(await acts[0]!.entries!(), [{ id: 'one' }, { id: 'two' }], 'the module\'s own entries');
	assert.equal(await acts[1]!.entries!(), null, 'a module that exports none cannot say what its URLs are');
	assert.equal(built, 0, 'and neither factory ran');
	stop();
});

test('an act module\'s title is what the live region says, and the head\'s title when it has none', async () => {
	const router = createRouter({ url: '/' });
	const document = createDocument();
	const held = (globalThis as { window?: unknown }).window;
	(globalThis as { window?: unknown }).window = { scrollTo: () => undefined };

	try {
		const stop = mount(document.body as never, h(StageContext, {
			router,
			sources: [source({
				'site/Named.ts': { default: () => ({ title: 'The notes', component: page('named') }) },
				'site/Plain.ts': { default: () => ({ component: () => [h(Title, {}, 'From the head'), h('main', {}, 'plain')] }) },
			})],
			acts: { '': page('home'), named: 'site/Named', plain: 'site/Plain' },
		} as never, h(Stage, {})));
		const region = document.body.firstChild as unknown as { textContent: string | null };

		router.push('/named');
		await loaded();
		assert.equal(region.textContent, 'The notes', 'the act module said what to announce');

		router.push('/plain');
		await loaded();
		assert.equal(region.textContent, 'From the head', 'and an act with no title falls back to the head\'s');
		stop();
	} finally {
		if (held === undefined) delete (globalThis as { window?: unknown }).window;
		else (globalThis as { window?: unknown }).window = held;
	}
});

/** Every element under a node, in order, by identity. */
const elementsIn = (from: { firstChild: unknown; nextSibling: unknown; nodeType: number } | null): unknown[] => {
	const found: unknown[] = [];
	for (let node = from; node !== null; node = node.nextSibling as typeof node) {
		if (node.nodeType === 1) found.push(node);
		found.push(...elementsIn(node.firstChild as never));
	}
	return found;
};

test('a page whose act is a module name hydrates with every element adopted', async () => {
	const acts = { '': page('home'), about: 'site/About' };
	const sources = [source({ 'site/About.ts': act('about') })];
	// The page names a loading component, which is the case that used to replace the markup: a
	// spinner over what the server sent is an element the server sent no pair for (design 243).
	const Spinner = (): unknown => h('p', { id: 'waiting' }, 'loading');
	const Site = (props: { url: string }): unknown => h(LoaderContext, { value: { loading: Spinner } },
		h(StageContext, {
			router: createRouter({ url: props.url }), sources, acts,
		} as never, h(Stage, {})));

	const markup = await render(h(Site, { url: '/about' }), { context: context() });
	assert.match(markup, /id="about"/, 'the server waited for the act and rendered it');

	const document = createDocument();
	for (const node of parseHtml(markup, document)) document.body.appendChild(node);
	const before = elementsIn(document.body.firstChild as never);
	assert.ok(before.length > 0, 'the server wrote a page');

	const stop = hydrate(document.body as never, h(Site, { url: '/about' }));
	assert.doesNotMatch(toHtml(document.body.childNodes), /id="waiting"/,
		'the loading component was not put over the markup the server already wrote');
	await stop.ready;
	assert.deepEqual(elementsIn(document.body.firstChild as never), before,
		'every element the server wrote is the same object it was');
	stop();
});

// --- a load a later navigation abandoned, and the way back from a refusal ----------------------

/** What the stage's loader is holding, read off a trace: every act loaded and not yet stopped. */
const holding = (order: readonly string[]): string[] => {
	const held: string[] = [];
	for (const line of order) {
		const [name, what] = line.split(' ');
		if (what === 'loaded') held.push(name!);
		else if (what === 'stopped') held.splice(held.indexOf(name!), 1);
	}
	return held;
};

test('a load a later navigation abandoned is dropped, and never becomes what the stage holds', async () => {
	// A fast, B slow, A again, then B lands. Without the staleness check the stage believed B was
	// loaded, so the next move stopped an act that was never shown and left A loaded until unmount.
	const order: string[] = [];
	let release = (): void => undefined;
	const slow = new Promise<void>((done) => { release = () => done(); });

	const named = (name: string, wait?: Promise<void>): Record<string, unknown> => ({
		default: async () => {
			if (wait !== undefined) await wait;
			order.push(`${name} loaded`);
			return { component: page(name), stop: () => { order.push(`${name} stopped`); } };
		},
	});

	const router = createRouter({ url: '/a' });
	const document = createDocument();
	const stop = mount(document.body as never, h(StageContext, {
		router,
		sources: [source({ 'app/A.ts': named('a'), 'app/B.ts': named('b', slow), 'app/C.ts': named('c') })],
		acts: { a: 'app/A', b: 'app/B', c: 'app/C' },
	} as never, h(Stage, {})));

	await loaded();
	assert.equal(textOf(document), '<main id="a">a</main>');

	router.push('/b');
	await loaded();
	assert.equal(textOf(document), '', 'B has not arrived');

	router.push('/a');
	await loaded();
	assert.equal(textOf(document), '<main id="a">a</main>', 'and the stage is back on A');

	release();
	await loaded();
	assert.deepEqual(order, ['a loaded', 'b loaded', 'b stopped'],
		'B was built, and dropped where it landed, because nothing is showing it');
	assert.deepEqual(holding(order), ['a'], 'the loader holds exactly the act on screen');
	assert.equal(textOf(document), '<main id="a">a</main>', 'and the page did not change under it');

	router.push('/c');
	await loaded();
	assert.equal(textOf(document), '<main id="c">c</main>');
	assert.deepEqual(order, ['a loaded', 'b loaded', 'b stopped', 'c loaded', 'a stopped'],
		'the act that was showing is what C\'s arrival retired, and B was never retired twice');
	assert.deepEqual(holding(order), ['c']);
	stop();
});

test('a refused act is handed a retry that builds the act the URL chose, at the same URL', async () => {
	const router = createRouter({ url: '/notes' });
	const document = createDocument();
	let allowed = false;
	let again: (() => void) | null = null;
	let joins = 0;

	const Join = (props: { refusal?: unknown; retry?: () => void }): unknown => {
		joins += 1;
		again = props.retry ?? null;
		return h('main', { id: 'join' }, String((props.refusal as { reason?: string } | undefined)?.reason ?? 'none'));
	};

	const stop = mount(document.body as never, h(StageContext, {
		router,
		sources: [source({
			'app/Gate.ts': {
				default: () => {
					if (!allowed) throw Object.assign(new Error('nobody'), { reason: 'anonymous' });
					return {};
				},
			},
			'notes/Page.ts': { deps: ['app/Gate'], default: () => ({ component: page('notes') }) },
		})],
		acts: { notes: 'notes/Page', join: Join },
		refused: 'join',
	} as never, h(Stage, {})));

	await loaded();
	assert.equal(textOf(document), '<main id="join">anonymous</main>');
	assert.equal(typeof again, 'function', 'the refused act was handed a retry');

	// The reason stops holding, and the act asks for the page the visitor asked for. Nothing
	// pushes, replaces or otherwise moves the URL.
	allowed = true;
	again!();
	await loaded();
	assert.equal(textOf(document), '<main id="notes">notes</main>', 'the act the URL chose is showing');
	assert.equal(new URL(String(router.url.get()), 'http://x').pathname, '/notes', 'at the address asked for');
	assert.equal(joins, 1, 'and the refused act was built once');
	stop();
});

test('a refused act key that takes parameters is refused, naming the rule', () => {
	assert.throws(
		() => mount(createDocument().body as never, h(StageContext, {
			router: createRouter({ url: '/notes' }),
			sources: [source({ 'notes/Page.ts': act('notes') })],
			acts: { notes: 'notes/Page', 'join/:from': page('join') },
			refused: 'join/:from',
		} as never, h(Stage, {}))),
		/refused act and that key takes parameters/,
	);
	assert.throws(
		() => mount(createDocument().body as never, h(StageContext, {
			router: createRouter({ url: '/notes' }),
			sources: [source({ 'notes/Page.ts': act('notes') })],
			acts: { notes: 'notes/Page', '*rest': page('join') },
			refused: '*rest',
		} as never, h(Stage, {}))),
		/refused act and that key takes parameters/,
	);
});
