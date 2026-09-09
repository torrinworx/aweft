// A hydration whose load lands on markup the client does not render (design 243).
//
// Run as its own process by `render.test.ts`, because the guarantee is that the mismatch reaches
// the host's unhandled-error path rather than a promise nobody reads, and a test runner catches
// an uncaught error before the host can. The handler below is the host.

import { createDocument, h, hydrate, render } from '@aweftjs/dom';
import type { Cleanup, Mounted, Pending } from '@aweftjs/dom';

/** The server's half: the content is there by the time the markup is taken. */
const Full = (_p: unknown, _c: Cleanup, _m: Mounted, pending: Pending): unknown => {
	pending(Promise.resolve());
	return h('p', {}, 'the server wrote this');
};

/** The client's half: it waits, and then renders nothing where the server put a paragraph. */
const Empty = (_p: unknown, _c: Cleanup, _m: Mounted, pending: Pending): unknown => {
	pending(new Promise<void>((resolve) => setTimeout(resolve, 10)));
	return null;
};

let reported: string | null = null;
process.on('uncaughtException', (error: Error) => { reported = error.message; });

const markup = await render(h(() => h('main', {}, h(Full, {}))));
const document = createDocument();
document.body.innerHTML = markup;
const page = hydrate(document.body, h(() => h('main', {}, h(Empty, {}))));

// `ready` says the hydration finished, not that it matched, so it resolves either way.
let settled = 'pending';
void page.ready.then(() => { settled = 'resolved'; }, () => { settled = 'rejected'; });

setTimeout(() => {
	console.log(`READY:${settled}`);
	if (reported === null) {
		console.log('NOTHING REPORTED');
		process.exit(0);
	}
	console.error(`REPORTED:${reported}`);
	process.exit(3);
}, 200);
