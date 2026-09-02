// Two documents in one process, kept in step.

import { idOf, kindOf } from '@aweftjs/core';

import { inProcess } from './channel.ts';
import { rootFrom } from './document.ts';
import { connect } from './client.ts';
import { serve } from './server.ts';

/**
 * Keep a second document in step with a first, both ways.
 *
 * Params:
 *   source: any observable in the document that decides. Its order is the order both end in
 *   target: the document to keep in step. Minted from the source's root when left out
 *
 * Returns: the mirror, with the document being kept in step and the function that stops it.
 *
 * This is the same engine a link over a socket runs, with the two ends in one heap and no
 * authority check, because there is no untrusted party between them. It is asynchronous for
 * the same reason every link is: a commit applied from inside a watcher reaches the second
 * document's watchers after the first has returned, so both sides queue and apply on a
 * microtask. The two documents are in step at the end of the tick, not at the end of the
 * statement.
 *
 * Example:
 *   const editing = mirror(stored);
 *   await Promise.resolve();
 *   (editing.document as { title: string }).title = 'draft';  // reaches `stored`
 */
export const mirror = (source: object, target?: object): {
	readonly document: object;
	stop(): void;
} => {
	const document = target ?? rootFrom(idOf(source), kindOf(source));

	const host = serve(() => ({ document: source, policy: 'trusted' }));
	const [there, here] = inProcess();
	host.accept(there, { id: 'mirror' });

	const session = connect(() => here, { retry: () => false });
	session.join('mirror', { document });

	return {
		document,
		stop: () => {
			session.close();
			host.close();
		},
	};
};
