// notes/Current: the notice board, shared once for the page rather than once per visit.
//
// Every act that wants it names it in `deps`, so it is opened by the first page that needs it
// and is still the same document on the fifth (design 242).

import type { Client } from '@aweftjs/client';
import type { ModuleProps } from '@aweftjs/modules';

import { trace } from '../trace.ts';

/** What the server keeps under the topic `board`. */
export interface Board {
	title: string;
}

export interface Current {
	readonly ready: Promise<Board>;
	readonly document: Board | undefined;
	stop(): void;
}

export default ({ client }: ModuleProps): Current => {
	const handle = (client as Client).share<Board>('board');
	trace('notes/Current opened');
	return {
		ready: handle.ready,
		get document() {
			return handle.document;
		},
		stop: () => {
			handle.stop();
			trace('notes/Current stopped');
		},
	};
};
