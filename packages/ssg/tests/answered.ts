// The site the request-time suites render: every page reads through the client it is handed, so
// each rule of design 304 has a page that exercises it. Written with `h` calls, as `fixtures.ts`
// is, so the suites compile whatever `AWEFT_DEFAULT_H` says.

import type { Client } from '@aweftjs/client';
import type { Router } from '@aweftjs/dom/router';
import { Head, Meta, Stage, StageContext, Title, h, suspend } from '@aweftjs/ui';
import type { StageValue } from '@aweftjs/ui';

/** A shell in the shape a bundler leaves: charset first, its script in the head, an empty body. */
export const SHELL = '<!doctype html>\n<html lang="en">\n\t<head>\n'
	+ '\t\t<meta charset="utf-8" />\n\t\t<title>the shell</title>\n'
	+ '\t\t<script type="module" src="/assets/app.js"></script>\n\t</head>\n\t<body>\n\t</body>\n</html>\n';

/** What a page shows once its read is answered. A component, so a hydration adopts what it renders. */
const Shown = (props: { id: string; shown: string; code: string }): unknown =>
	h('main', { id: props.id },
		h(Head, {}, h(Title, {}, props.id), h(Meta, { httpEquiv: 'status', content: props.code })),
		h('p', { id: `${props.id}-shown` }, props.shown));

/**
 * A page that asks one module and shows what it was answered, or the reason it was refused.
 *
 * Through `suspend`, which is how a page that reads hydrates: on the server the render waits for
 * it, and in a browser the server's markup stays until the answer arrives and claims it. The
 * loader answers a component call, because an element built in the loader is built outside the
 * mount and stands in for the server's rather than adopting it.
 */
const asking = (client: Client, id: string, name: string, args: (stage: StageValue) => unknown,
	show: (answer: unknown) => string, status?: (reason: string) => string): unknown =>
	suspend<{ stage: StageValue }>(null, async ({ stage }) => {
		let shown: string;
		let code = '200';
		try {
			shown = show(await client.ask(name, args(stage)));
		} catch (error) {
			const reason = String((error as { reason?: unknown }).reason);
			shown = `refused: ${reason}`;
			if (status !== undefined) code = status(reason);
		}
		return h(Shown, { id, shown, code });
	});

interface Post { readonly id: string; readonly title: string }

/** What the progress page's handler heard, kept past the render so a late report would show. */
export const heard: unknown[] = [];

/** The acts, around the client the render or the browser handed in. */
const actsFor = (client: Client): Record<string, unknown> => ({
	'': asking(client, 'home', 'posts/List', () => undefined,
		(posts) => (posts as Post[]).map((post) => post.title).join(', ')),
	'posts/:id': asking(client, 'post', 'posts/Read', (stage) => ({ id: stage.params.get()['id'] }),
		(post) => (post as Post).title, (reason) => (reason === 'no-such-post' ? '404' : '200')),
	notes: asking(client, 'notes', 'notes/Mine', () => ({ every: true, all: 'of them' }), (notes) => String(notes)),
	broken: asking(client, 'broken', 'posts/Broken', () => null, String),
	hidden: asking(client, 'hidden', 'posts/Hidden', () => null, String),
	slow: asking(client, 'slow', 'posts/Slow', () => null, String),
	// Arguments JSON cannot carry are refused where the ask is made, and a result it cannot carry
	// is refused by the far end.
	unsent: asking(client, 'unsent', 'posts/List', () => ({ n: 1n }), String),
	uncounted: asking(client, 'uncounted', 'posts/Count', () => null, String),
	// A page that edits what it was handed, which must not edit what the render recorded.
	edits: asking(client, 'edits', 'posts/List', () => null, (posts) => {
		(posts as Post[]).push({ id: 'three', title: 'Added by the page' });
		return String((posts as Post[]).length);
	}),
	// A page that hears progress before its answer, into a list a test can read after the render.
	progress: suspend(null, async () => {
		heard.length = 0;
		const answer = await client.ask('posts/Progress', null, { progress: (value) => {
			heard.push(value);
			if (value === 'throw') throw new Error('the handler broke');
		} });
		return h(Shown, { id: 'progress', shown: `${heard.map(String).join(',')} then ${String(answer)}`, code: '200' });
	}),
	twice: suspend(null, async () => {
		const [first, second] = await Promise.all([client.ask('posts/Tick'), client.ask('posts/Tick')]);
		return h(Shown, { id: 'twice', shown: `${String(first)} and ${String(second)}`, code: '200' });
	}),
	// Pages that do not catch what their read rejects with.
	unguarded: suspend(null, async () => h(Shown, { id: 'unguarded', shown: String(await client.ask('posts/Broken')), code: '200' })),
	exposed: suspend(null, async () => h(Shown, { id: 'exposed', shown: String(await client.ask('notes/Mine', { every: true, all: 'of them' })), code: '200' })),
	// A page whose own code throws while it renders.
	throws: (): unknown => { throw new Error('the page broke'); },
	// A page that waits on a shared document, and one that renders its waiting state from it.
	board: suspend(null, async () => h(Shown, { id: 'board', shown: String(await client.share('board').ready), code: '200' })),
	caught: suspend(null, async () => {
		try {
			return h(Shown, { id: 'caught', shown: String(await client.share('board').ready), code: '200' });
		} catch (error) {
			return h(Shown, { id: 'caught', shown: `refused: ${String((error as { reason?: unknown }).reason)}`, code: '200' });
		}
	}),
	waiting: (): unknown => h(Shown, { id: 'waiting', shown: client.share('board').document === undefined ? 'waiting' : 'here', code: '200' }),
	about: (): unknown => h('main', { id: 'about' }, h(Head, {}, h(Title, {}, 'About'))),
	gone: (): unknown => h('main', { id: 'gone' }, h(Head, {}, h(Meta, { httpEquiv: 'status', content: '410' }))),
	moved: (): unknown => h('main', { id: 'moved' }, h(Head, {}, h(Meta, { httpEquiv: 'status', content: '302' }))),
	missing: (): unknown => h('main', { id: 'missing' }, h(Head, {}, h(Title, {}, 'Not found'))),
});

/** The whole site, as `createPages` and the browser entry both build it. */
export const Site = (props: { router: Router; client: Client }): unknown =>
	h(StageContext, { router: props.router, acts: actsFor(props.client), fallback: 'missing', exact: true } as never, h(Stage, {}));
