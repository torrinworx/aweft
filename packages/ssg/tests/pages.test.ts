// `createPages`, through a real server on a real port (design 304).
//
// Every expected status and every recorded answer is worked out from the table in design 304 and
// from the modules below, not read off a run: the reads answer fixed values, so the record a page
// carries is known before the request is made.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { codecError } from '@aweftjs/codec';
import { fromBundle } from '@aweftjs/modules';
import type { ModuleProps } from '@aweftjs/modules';
import { createClient } from '@aweftjs/client';
import { createServer } from '@aweftjs/server';
import type { Gate } from '@aweftjs/server';
import { node } from '@aweftjs/server/node';
import { createPages } from '@aweftjs/ssg';
import type { PagesOptions } from '@aweftjs/ssg';
import { Head, Meta, Stage, StageContext, h, suspend } from '@aweftjs/ui';

import { SHELL, Site, heard } from './answered.ts';
import { scratch } from './fixtures.ts';

const space = scratch();
after(() => space.done());

const dist = join(space.dir, 'dist');
mkdirSync(join(dist, 'assets'), { recursive: true });
writeFileSync(join(dist, 'index.html'), SHELL);
writeFileSync(join(dist, 'assets', 'app.js'), 'console.log("app")');

const POSTS = [{ id: 'one', title: 'First light' }, { id: 'two', title: 'Second wind' }];

/**
 * A gate with sessions in it: a `who` cookie, or a `token` in the query as a link would carry it,
 * signs a request in, and a module is private unless it says `public`.
 */
const gate: Gate<{ user: string | null }> = {
	identify: (request) => {
		const found = /(?:^|;\s*)who=([^;]+)/.exec(request.headers.get('cookie') ?? '');
		const token = new URL(request.url).searchParams.get('token');
		return { context: { user: found !== null ? found[1]! : token } };
	},
	access: ({ name, instance }, context) =>
		(instance as { public?: boolean }).public === true || context.user !== null
			? [] : [{ code: 'private', message: `${name} needs a signed-in user` }],
};

/** What the read modules were asked, and with which context, so a test can say who asked. */
const calls: { name: string; args: unknown; user: string | null }[] = [];
let slow: Promise<void> = Promise.resolve();
let ticks = 0;

const read = (name: string, answer: (args: unknown) => unknown, extra: Record<string, unknown> = {}) => ({
	default: () => ({
		public: true,
		...extra,
		call: async (args: unknown, context: { user: string | null }) => {
			calls.push({ name, args, user: context.user });
			return answer(args);
		},
	}),
});

const modulesOf = (over: Partial<PagesOptions> = {}) => fromBundle({
	'./site/Pages.ts': {
		deps: ['posts/List', 'posts/Read', 'notes/Mine', 'posts/Broken', 'posts/Slow', 'posts/Count', 'posts/Tick'],
		default: ({ imports }: ModuleProps) => createPages({
			page: (router, client) => h(Site, { router, client }),
			gate,
			modules: {
				'posts/List': imports.List, 'posts/Read': imports.Read, 'notes/Mine': imports.Mine,
				'posts/Broken': imports.Broken, 'posts/Slow': imports.Slow, 'posts/Count': imports.Count, 'posts/Tick': imports.Tick,
			},
			dir: dist,
			...over,
		}),
	},
	'./posts/List.ts': read('posts/List', () => POSTS),
	'./posts/Read.ts': read('posts/Read', (args) => {
		const post = POSTS.find((one) => one.id === (args as { id: string }).id);
		if (post === undefined) throw codecError('no-such-post', `no post is called ${JSON.stringify(args)}`, 'Ask for a post that exists.');
		return post;
	}),
	// Private: the gate lets it reach a signed-in person only.
	'./notes/Mine.ts': read('notes/Mine', () => 'the notes of a signed-in person', { public: false }),
	'./posts/Broken.ts': read('posts/Broken', () => { throw new Error('the table is gone'); }),
	'./posts/Slow.ts': read('posts/Slow', async () => { await slow; return 'late'; }),
	'./posts/Count.ts': read('posts/Count', () => 2n),
	// A different answer each time, so the order two asks were recorded in is visible.
	'./posts/Tick.ts': read('posts/Tick', () => { ticks += 1; return ticks; }),
	// Loaded after the pages, so it answers only what they declined.
	'./z/Files.ts': { default: () => ({ public: true, request: () => new Response('from the files module') }) },
});

/** Start a server with these modules. With `handled` false it has no `handlers.failed`, like the recipe's. */
const boot = async (over: Partial<PagesOptions> = {}, handled = true): Promise<{ url: string; failed: unknown[]; stop(): Promise<void> }> => {
	const failed: unknown[] = [];
	const listener = node({ port: 0, host: '127.0.0.1' });
	const server = createServer({
		sources: [modulesOf(over)], gate, listener,
		...(handled ? { handlers: { failed: (_name: string, error: unknown) => { failed.push(error); } } } : {}),
	});
	await server.start();
	return { url: `http://127.0.0.1:${String(listener.port)}`, failed, stop: () => server.stop() };
};

const host = await boot();
after(() => host.stop());

/**
 * How the server words a module its gate refused, as a client reads it over the socket: the reason,
 * the detail and the fix, the shape every refusal's message has.
 */
const REFUSED = 'refused: notes/Mine refused the call. Sign in, or ask for something the gate allows.';

/** The answers a page carries, parsed back out of its head. */
const answersIn = (html: string): unknown => {
	const found = /<script type="application\/json" id="aweft-answers">([\s\S]*?)<\/script>/.exec(html);
	return found === null ? null : JSON.parse(found[1]!) as unknown;
};

/** The markup with the mount markers taken out, so a test reads text the way a person does. */
const plain = (html: string): string => html.replace(/<!--[[\]]-->/g, '');

/** What a run told the operator on the console, which is where a failed read is reported. */
const told = async <T>(run: () => Promise<T>): Promise<{ answer: T; said: unknown[][] }> => {
	const held = console.error;
	const said: unknown[][] = [];
	console.error = (...line: unknown[]) => { said.push(line); };
	try {
		return { answer: await run(), said };
	} finally {
		console.error = held;
	}
};

test('a page is rendered with the answers its reads were given, in the head and nowhere else', async () => {
	calls.length = 0;
	const answer = await fetch(`${host.url}/`);
	assert.equal(answer.status, 200);
	assert.equal(answer.headers.get('content-type'), 'text/html; charset=utf-8');
	const html = await answer.text();

	assert.match(plain(html), /<p id="home-shown">First light, Second wind<\/p>/, 'the markup is what the read answered');
	assert.match(html, /<body data-aweft-ssg="">/, 'stamped, so attach hydrates it');
	assert.deepEqual(answersIn(html), { 'posts/List null': [{ result: POSTS }] },
		'one ask, no arguments, which cross as null');
	const head = html.slice(0, html.indexOf('</head>'));
	assert.ok(head.includes('id="aweft-answers"'), 'the answers ride in the head, where a hydration does not look');
	assert.deepEqual(calls, [{ name: 'posts/List', args: null, user: null }], 'asked once, by nobody');
});

test('a render is anonymous whoever asks: a private read is refused even for a signed-in request', async () => {
	calls.length = 0;
	const answer = await fetch(`${host.url}/notes`, { headers: { cookie: 'who=ada' } });
	assert.equal(answer.status, 200, 'a refusal is an answer, and the page still is one');
	const html = await answer.text();
	assert.match(plain(html), /<p id="notes-shown">refused: refused<\/p>/);
	assert.deepEqual(calls, [], 'the private module was never called');
	// The arguments' keys are sorted in the key, and the refusal carries the gate's words.
	assert.deepEqual(answersIn(html), {
		'notes/Mine {"all":"of them","every":true}': [{ error: {
			reason: 'refused', message: REFUSED,
			reasons: [{ code: 'private', message: 'notes/Mine needs a signed-in user' }],
		} }],
	});
	assert.ok(!html.includes('the notes of a signed-in person'), 'and nothing private reached the page');
});

test('a refusal the module throws is recorded, and the page that read it says its own status', async () => {
	const answer = await fetch(`${host.url}/posts/three`);
	assert.equal(answer.status, 404, 'the page asked for 404 though its stage matched');
	const html = await answer.text();
	assert.match(html, /refused: no-such-post/);
	assert.deepEqual(answersIn(html), {
		// The message is the module's own, whole, as the socket carries it: a refusal's message is
		// its reason, its detail and its fix.
		'posts/Read {"id":"three"}': [{ error: {
			reason: 'no-such-post', message: 'no-such-post: no post is called {"id":"three"}. Ask for a post that exists.',
		} }],
	});

	const found = await fetch(`${host.url}/posts/two`);
	assert.equal(found.status, 200, 'a status meta that says 200 is 200');
	assert.match(plain(await found.text()), /<p id="post-shown">Second wind<\/p>/);

	const gone = await fetch(`${host.url}/gone`);
	assert.equal(gone.status, 410, 'any status from 400 to 599 a page asks for');
	await gone.text();
});

test('a status that is not 200 or from 400 to 599 is a defect: the shell with 500, and the operator told', async () => {
	const { answer, said } = await told(async () => {
		const got = await fetch(`${host.url}/moved`);
		return { status: got.status, html: await got.text() };
	});
	assert.equal(answer.status, 500);
	assert.equal(answer.html, SHELL);
	assert.equal((said[0]![1] as { reason?: string }).reason, 'bad-status');
});

test('a page defect is the shell with 500 and the process goes on, on a server with no handlers.failed', async () => {
	// One anonymous request to a page that breaks must not be a way to end the process.
	const bare = await boot({}, false);
	try {
		for (const path of ['/exposed', '/throws', '/moved']) {
			const { answer, said } = await told(async () => {
				const got = await fetch(`${bare.url}${path}`);
				return { status: got.status, html: await got.text() };
			});
			assert.equal(answer.status, 500, path);
			assert.equal(answer.html, SHELL, `${path} gets the shell, which mounts live in a browser`);
			assert.equal(said.length, 1, `${path} is written to the console once`);
		}
		const about = await fetch(`${bare.url}/about`);
		assert.equal(about.status, 200, 'and the process is still answering');
		await about.text();
	} finally {
		await bare.stop();
	}
});

test('a page defect and a failed read go to the failed option when one is given, and not to the console', async () => {
	const reported: [string, unknown][] = [];
	const failed = (name: string, error: unknown): void => { reported.push([name, error]); };
	const { answer, said } = await told(async () => [
		await renderWith('/exposed', { modules: { 'notes/Mine': { call: () => 'notes' } }, failed }),
		await renderWith('/broken', { modules: { 'posts/Broken': { public: true, call: () => { throw new Error('the table is gone'); } } }, failed }),
	]);
	assert.deepEqual(answer.map((one) => one.status), [500, 503]);
	assert.deepEqual(said, [], 'nothing went to the console');
	assert.deepEqual(reported.map(([name]) => name), ['/exposed', '/broken'], 'each named by the page it broke');
	assert.equal((reported[0]![1] as { reason?: string }).reason, 'refused');
	assert.equal((reported[1]![1] as Error).message, 'the table is gone');
});

test('a path nothing takes is 404 with the fallback page, and a path a key only starts is too', async () => {
	for (const path of ['/nowhere', '/about/x']) {
		const answer = await fetch(`${host.url}${path}`);
		assert.equal(answer.status, 404, path);
		const html = await answer.text();
		assert.match(html, /<main id="missing">/, `${path} renders the fallback, which the browser renders at that URL too`);
		assert.match(html, /<body data-aweft-ssg="">/, 'and it hydrates');
	}
	const about = await fetch(`${host.url}/about`);
	assert.equal(about.status, 200);
	await about.text();
});

test('a failed read, and a module the render was not handed, answer the shell with 503', async () => {
	for (const path of ['/broken', '/hidden']) {
		const { answer } = await told(() => fetch(`${host.url}${path}`));
		assert.equal(answer.status, 503, path);
		const html = await answer.text();
		assert.equal(html, SHELL, `${path} gets the shell, which mounts live and asks again`);
	}
	// The operator hears why: the module's own error, and the name nobody handed over.
	const { said } = await told(async () => { await (await fetch(`${host.url}/broken`)).text(); });
	assert.ok(said.some((line) => (line[1] as Error | undefined)?.message === 'the table is gone'));
	const { said: hidden } = await told(async () => { await (await fetch(`${host.url}/hidden`)).text(); });
	assert.equal((hidden[0]![1] as { reason?: string }).reason, 'not-handed');
});

test('arguments JSON cannot carry are refused where the ask is made, and a result it cannot carry by the far end', async () => {
	calls.length = 0;
	const unsent = await (await fetch(`${host.url}/unsent`)).text();
	assert.match(plain(unsent), /refused: not-data/);
	assert.equal(answersIn(unsent), null, 'the browser refuses those arguments itself, so nothing is recorded');
	assert.deepEqual(calls, [], 'and the module was never called');

	const uncounted = await (await fetch(`${host.url}/uncounted`)).text();
	assert.match(plain(uncounted), /refused: not-data/);
	const recorded = answersIn(uncounted) as Record<string, { error: { reason: string; message: string } }[]>;
	assert.equal(recorded['posts/Count null']![0]!.error.reason, 'not-data', 'the far end\'s refusal is an answer, and recorded');
	assert.match(recorded['posts/Count null']![0]!.error.message, /^posts\/Count: the result could not be encoded/);
});

test('a file and a method other than GET and HEAD are left to the next module', async () => {
	const file = await fetch(`${host.url}/assets/app.js`);
	assert.equal(await file.text(), 'from the files module');
	const posted = await fetch(`${host.url}/about`, { method: 'POST', headers: { origin: host.url } });
	assert.equal(await posted.text(), 'from the files module');
	// A dot segment is never a file, so it is rendered, and no act takes it.
	const dotted = await fetch(`${host.url}/.hidden`);
	assert.equal(dotted.status, 404);
	await dotted.text();
	// Nor is a path that does not decode.
	const broken = await fetch(`${host.url}/%E0%A4%A`);
	assert.equal(broken.status, 404);
	await broken.text();
});

test('HEAD gets the status and the headers with no body', async () => {
	const head = await fetch(`${host.url}/posts/three`, { method: 'HEAD' });
	assert.equal(head.status, 404);
	assert.equal(head.headers.get('content-type'), 'text/html; charset=utf-8');
	assert.equal(await head.text(), '');
	// The listener drops a HEAD body on its own, so the module's own answer is read too.
	const pages = createPages({ page: (router, client) => h(Site, { router, client }), gate, modules: {}, dir: dist });
	const own = (await pages.request(new Request('http://site.test/about', { method: 'HEAD' })))!;
	assert.equal(own.status, 200);
	assert.equal(own.body, null, 'the module wrote no body at all');
});

test('two asks with one key are recorded in the order they were made', async () => {
	ticks = 0;
	const html = await (await fetch(`${host.url}/twice`)).text();
	assert.match(plain(html), /<p id="twice-shown">1 and 2<\/p>/, 'the first ask was answered first');
	assert.deepEqual(answersIn(html), { 'posts/Tick null': [{ result: 1 }, { result: 2 }] },
		'and the record keeps that order, which is the order the browser will ask in');
});

test('a render past its time is answered with the shell, and keeps its place until it ends', async () => {
	let release = (): void => {};
	slow = new Promise((done) => { release = done; });
	const tight = await boot({ timeoutMs: 100, renders: 1 });
	try {
		const late = await fetch(`${tight.url}/slow`);
		assert.equal(late.status, 503, 'past the time limit');
		assert.equal(await late.text(), SHELL);

		// The slow render is still running, so the one place is taken.
		const crowded = await fetch(`${tight.url}/about`);
		assert.equal(crowded.status, 503, 'past the renders limit');
		assert.equal(await crowded.text(), SHELL);

		release();
		await new Promise((done) => setTimeout(done, 20));
		const freed = await fetch(`${tight.url}/about`);
		assert.equal(freed.status, 200, 'the place is back once the render ends');
		await freed.text();
	} finally {
		release();
		await tight.stop();
	}
});

test('the shell is read when the module is made, and a missing or broken one is refused there', async () => {
	const base: PagesOptions = { page: () => null, gate, modules: {}, dir: dist };
	assert.throws(() => createPages({ ...base, dir: join(space.dir, 'nothing-here') }), { reason: 'no-shell' });
	const broken = join(space.dir, 'broken');
	mkdirSync(broken);
	writeFileSync(join(broken, 'index.html'), '<html><head></head></html>');
	assert.throws(() => createPages({ ...base, dir: broken }), { reason: 'shell-body' });
	assert.throws(() => createPages({ ...base, renders: 0 }), { reason: 'invalid-config' });
	assert.throws(() => createPages({ ...base, timeoutMs: -1 }), { reason: 'invalid-config' });
	assert.throws(() => createPages({ ...base, gate: {} as never }), { reason: 'invalid-config' });
	assert.throws(() => createPages({ ...base, modules: null as never }), { reason: 'invalid-config' });
	assert.throws(() => createPages({ ...base, page: 'Site' as never }), { reason: 'invalid-config' });
	assert.equal(createPages(base).public, true, 'a gate that reads public serves anyone');
});

// --- the gate's answers, the record's safety, and the client's contract, without a server ------

/** One module's page, rendered by a `createPages` made for the case. */
const renderWith = async (path: string, over: Partial<PagesOptions>): Promise<{ status: number; html: string }> => {
	const pages = createPages({ page: (router, client) => h(Site, { router, client }), gate, modules: {}, dir: dist, ...over });
	const answer = (await pages.request(new Request(`http://site.test${path}`)))!;
	return { status: answer.status, html: await answer.text() };
};

test('a gate that refuses to identify a visitor nobody knows refuses every read, with its reasons', async () => {
	const refusing: Gate = { identify: () => ({ refused: [{ code: 'nobody', message: 'this site knows everyone it serves' }] }), access: () => [] };
	const { status, html } = await renderWith('/notes', { gate: refusing, modules: { 'notes/Mine': { public: true, call: () => 'notes' } } });
	assert.equal(status, 200);
	assert.deepEqual(answersIn(html), { 'notes/Mine {"all":"of them","every":true}': [{ error: {
		reason: 'refused', message: REFUSED, reasons: [{ code: 'nobody', message: 'this site knows everyone it serves' }],
	} }] });
});

test('a gate that throws is a failed read, so the shell answers with 503', async () => {
	const throwing: Gate = { identify: () => ({ context: {} }), access: () => { throw new Error('the rules table is gone'); } };
	const { answer, said } = await told(() => renderWith('/notes', { gate: throwing, modules: { 'notes/Mine': { call: () => 'notes' } } }));
	assert.equal(answer.status, 503);
	assert.equal(answer.html, SHELL);
	assert.equal((said[0]![1] as Error).message, 'the rules table is gone', 'and the operator hears the gate\'s own error');
});

test('a module with no call, or none at all, is refused when the module is made', () => {
	// What an import spelled differently from deps hands over: undefined.
	const imports: Record<string, unknown> = { List: { call: () => POSTS } };
	assert.throws(() => createPages({ page: () => null, gate, modules: { 'posts/List': imports['Lsit'] }, dir: dist }), { reason: 'invalid-config' });
	assert.throws(() => createPages({ page: () => null, gate, modules: { 'notes/Mine': { public: true } }, dir: dist }), { reason: 'invalid-config' });
});

test('modules is read once, so changing the object later changes nothing', async () => {
	const modules: Record<string, unknown> = { 'posts/List': { public: true, call: () => POSTS } };
	const pages = createPages({ page: (router, client) => h(Site, { router, client }), gate, modules, dir: dist });
	modules['posts/List'] = { public: true, call: () => ['swapped'] };
	const html = await (await pages.request(new Request('http://site.test/')))!.text();
	assert.deepEqual(answersIn(html), { 'posts/List null': [{ result: POSTS }] });
});

test('an answer cannot close the script it travels in, and comes back whole', async () => {
	const posts = [{ id: 'x', title: '</script><b id="injected">\u2028<!--' }];
	const { html } = await renderWith('/', { modules: { 'posts/List': { public: true, call: () => posts } } });
	assert.ok(!html.includes('<b id="injected">'), 'no markup the answer carried reached the document');
	assert.equal(html.split('</script>').length, html.split('<script').length, 'every script closes where it was opened');
	assert.deepEqual(answersIn(html), { 'posts/List null': [{ result: posts }] });
});

test('a page that edits what it was handed leaves the record as the module answered it', async () => {
	const { html } = await renderWith('/edits', { modules: { 'posts/List': { public: true, call: () => POSTS.map((post) => ({ ...post })) } } });
	assert.match(plain(html), /<p id="edits-shown">3<\/p>/, 'the page edited its copy');
	assert.deepEqual(answersIn(html), { 'posts/List null': [{ result: POSTS }] }, 'and the browser gets what the module said');
});

test('a read hears its progress before its answer, as it would over the socket', async () => {
	const progress = { public: true, call: (_args: unknown, _context: unknown, tools: { progress(value: unknown): void }) => {
		tools.progress('half');
		tools.progress(undefined);
		return 'done';
	} };
	const { html } = await renderWith('/progress', { modules: { 'posts/Progress': progress } });
	// `undefined` crosses as null.
	assert.match(plain(html), /<p id="progress-shown">half,null then done<\/p>/);
});

test('a progress handler that throws is reported and the read goes on, and nothing comes after the answer', async () => {
	const progress = { public: true, call: (_args: unknown, _context: unknown, tools: { progress(value: unknown): void }) => {
		tools.progress('throw');
		setTimeout(() => { tools.progress('late'); }, 0);
		return 'done';
	} };
	const { answer, said } = await told(() => renderWith('/progress', { modules: { 'posts/Progress': progress } }));
	assert.equal(answer.status, 200, 'the handler\'s throw is the page\'s, not the read\'s');
	assert.match(plain(answer.html), /<p id="progress-shown">throw then done<\/p>/);
	assert.equal((said[0]![1] as Error).message, 'the handler broke', 'and the operator heard it');
	await new Promise((done) => setTimeout(done, 20));
	assert.deepEqual(heard, ['throw'], 'a report after the answer never reached the page');
});

test('a token in the query does not sign a render in either', async () => {
	calls.length = 0;
	const html = await (await fetch(`${host.url}/notes?token=ada`)).text();
	assert.match(plain(html), /refused: refused/);
	assert.deepEqual(calls, [], 'the private module was never called');
	assert.ok(!html.includes('the notes of a signed-in person'));
});

test('a refusal reads the same in a render as over a socket to the same server', async () => {
	const html = await (await fetch(`${host.url}/notes`)).text();
	const recorded = (answersIn(html) as Record<string, { error: { message: string } }[]>)['notes/Mine {"all":"of them","every":true}']![0]!.error;
	const client = createClient({ url: host.url.replace('http', 'ws'), reconnect: false });
	try {
		await assert.rejects(client.ask('notes/Mine', { every: true, all: 'of them' }), (error: Error & { reason?: string; reasons?: unknown }) => {
			assert.equal(error.reason, 'refused');
			assert.equal(recorded.message, error.message, 'the message the page reads is the server\'s own');
			return true;
		});
	} finally {
		client.close();
	}
});

test('a page that does not catch a failed read is the shell with 503; one that does not catch a refusal is the shell with 500', async () => {
	const { answer } = await told(() => fetch(`${host.url}/unguarded`));
	assert.equal(answer.status, 503, 'the read failed, so the render could not write the page');
	assert.equal(await answer.text(), SHELL);

	host.failed.length = 0;
	const { answer: exposed, said } = await told(async () => {
		const got = await fetch(`${host.url}/exposed`);
		return { status: got.status, html: await got.text() };
	});
	assert.equal(exposed.status, 500, 'the page let a refusal escape, which is its own defect');
	assert.equal(exposed.html, SHELL);
	assert.equal((said[0]![1] as { reason?: string }).reason, 'refused', 'the operator is told what escaped');
	assert.deepEqual(host.failed, [], 'and the server was not asked to raise it');

	const after = await fetch(`${host.url}/about`);
	assert.equal(after.status, 200, 'and the process is still answering');
	await after.text();
});

test('a page that waits on a shared document is the shell, and one that renders its waiting state is the page', async () => {
	const board = await fetch(`${host.url}/board`);
	assert.equal(board.status, 503);
	assert.equal(await board.text(), SHELL);

	// A page that catches the refusal renders what it chose to show.
	const caught = await fetch(`${host.url}/caught`);
	assert.equal(caught.status, 200);
	assert.match(plain(await caught.text()), /<p id="caught-shown">refused: not-shared<\/p>/);

	const waiting = await fetch(`${host.url}/waiting`);
	assert.equal(waiting.status, 200);
	assert.match(plain(await waiting.text()), /<p id="waiting-shown">waiting<\/p>/);

	// The render that waited ended, so its place is free.
	const tight = await boot({ renders: 1 });
	try {
		for (let i = 0; i < 3; i += 1) assert.equal((await (await fetch(`${tight.url}/board`)).text()), SHELL);
		const about = await fetch(`${tight.url}/about`);
		assert.equal(about.status, 200, 'three waits on a share took no place for good');
		await about.text();
	} finally {
		await tight.stop();
	}
});

// --- status metas, the visitor a render asks as, and two renders at once ------------------------

/** A site whose acts read no data. Its stage is exact, like the one `Site` makes. */
const plainSite = (acts: Record<string, unknown>, extra: Record<string, unknown> = {}): PagesOptions['page'] =>
	(router) => h(StageContext, { router, acts, exact: true, ...extra } as never, h(Stage, {}));

/** An act that asks for a status of its own. */
const saying = (content: string) => (): unknown =>
	h('main', { id: 'said' }, h(Head, {}, h(Meta, { httpEquiv: 'status', content })));

test('a status meta is read before the stage: a not-found page that says 410 is answered 410', async () => {
	const { status, html } = await renderWith('/nowhere', { page: plainSite({ '': saying('200'), missing: saying('410') }, { fallback: 'missing' }) });
	assert.equal(status, 410, 'the page asked for a status, so the fallback showing does not make it 404');
	assert.match(html, /<main id="said">/);
});

test('a stage with no fallback that shows nothing is 404, with the page rather than the shell', async () => {
	const page = plainSite({ '': () => h('main', { id: 'home' }) });
	const { status, html } = await renderWith('/nowhere', { page });
	assert.equal(status, 404);
	assert.notEqual(html, SHELL);
	assert.match(html, /<body data-aweft-ssg="">/, 'the page, which shows nothing in the browser at that path too');
	assert.equal((await renderWith('/', { page })).status, 200);
});

test('the deepest status meta wins, then the latest, so a page overrides its layout', async () => {
	// The layout's head comes first and the act's after it, at the same depth.
	const Layout = (props: { children?: unknown[] }): unknown =>
		h('div', {}, h(Head, {}, h(Meta, { httpEquiv: 'status', content: '200' })), ...(props.children ?? []));
	assert.equal((await renderWith('/said', { page: plainSite({ said: saying('404') }, { template: Layout }) })).status, 404);

	// A status meta inside two `Head`s, against one inside a single `Head` that a loader writes later.
	const Later = suspend(null, async () => {
		await new Promise((done) => setTimeout(done, 5));
		return h(Head, {}, h(Meta, { httpEquiv: 'status', content: '200' }));
	});
	const Deep = (): unknown => h('main', {}, h(Head, {}, h(Head, {}, h(Meta, { httpEquiv: 'status', content: '410' }))), h(Later as never, {}));
	assert.equal((await renderWith('/deep', { page: plainSite({ deep: Deep }) })).status, 410, 'the deeper one, though it came first');
});

test('a status meta takes 200 and 400 to 599, and refuses the numbers either side of them', async () => {
	for (const content of ['400', '599']) {
		assert.equal((await renderWith('/said', { page: plainSite({ said: saying(content) }) })).status, Number(content), content);
	}
	for (const content of ['399', '600', '201', '4040', 'gone']) {
		const reported: unknown[] = [];
		const pages = createPages({ page: plainSite({ said: saying(content) }), gate, modules: {}, dir: dist, failed: (_name, error) => { reported.push(error); } });
		const answer = (await pages.request(new Request('http://site.test/said')))!;
		assert.equal(answer.status, 500, content);
		await answer.text();
		assert.equal((reported[0] as { reason?: string }).reason, 'bad-status', content);
	}
});

test('renders is a whole number, timeoutMs a positive time a Node timer can hold, and failed a function', () => {
	const base: PagesOptions = { page: () => null, gate, modules: {}, dir: dist };
	for (const renders of [1.5, Number.NaN, '4' as never]) {
		assert.throws(() => createPages({ ...base, renders }), { reason: 'invalid-config' }, String(renders));
	}
	for (const timeoutMs of [0, Number.NaN, 2_147_483_648, Number.POSITIVE_INFINITY, '100' as never]) {
		assert.throws(() => createPages({ ...base, timeoutMs }), { reason: 'invalid-config' }, String(timeoutMs));
	}
	assert.equal(createPages({ ...base, renders: 1, timeoutMs: 2_147_483_647 }).public, true, 'the longest a timer holds');
	assert.throws(() => createPages({ ...base, failed: 'console' as never }), { reason: 'invalid-config' }, 'failed is a function');
});

test('a render identifies its visitor once, from the path alone, and a page that reads nothing not at all', async () => {
	const seen: { url: string; headers: number; peer: unknown }[] = [];
	const watching: Gate = {
		identify: (request, peer) => {
			seen.push({ url: request.url, headers: [...request.headers].length, peer });
			return { context: { user: null } };
		},
		access: () => [],
	};
	const pages = createPages({ page: (router, client) => h(Site, { router, client }), gate: watching, modules: { 'posts/Tick': { call: () => 1 } }, dir: dist });
	await (await pages.request(new Request('http://site.test/twice?token=ada', { headers: { cookie: 'who=ada' } })))!.text();
	assert.deepEqual(seen, [{ url: 'http://site.test/twice', headers: 0, peer: { address: undefined } }],
		'two reads, one visitor, and nothing of the request but its path');

	seen.length = 0;
	await (await pages.request(new Request('http://site.test/about')))!.text();
	assert.deepEqual(seen, []);
});

test('two renders at once keep their answers apart', async () => {
	// The first read answers last, so the two renders are in flight together.
	const read = { public: true, call: async (args: { id: string }) => {
		await new Promise((done) => setTimeout(done, args.id === 'one' ? 30 : 0));
		return { id: args.id, title: `post ${args.id}` };
	} };
	const pages = createPages({ page: (router, client) => h(Site, { router, client }), gate, modules: { 'posts/Read': read }, dir: dist });
	const [one, two] = await Promise.all(['one', 'two'].map(async (id) => (await pages.request(new Request(`http://site.test/posts/${id}`)))!.text()));
	assert.deepEqual(answersIn(one!), { 'posts/Read {"id":"one"}': [{ result: { id: 'one', title: 'post one' } }] });
	assert.deepEqual(answersIn(two!), { 'posts/Read {"id":"two"}': [{ result: { id: 'two', title: 'post two' } }] });
	assert.match(plain(one!), /<p id="post-shown">post one<\/p>/);
	assert.match(plain(two!), /<p id="post-shown">post two<\/p>/);
});
