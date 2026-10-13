// The asks that reached the server over a socket. The server reports each ask a client makes to
// every module with an `observe` hook. A render's reads do not go through the socket, so they are
// not reported. After a hydration, this list holds the reads the browser had to make again.

import type { ServerEvent } from '@aweftjs/server';

export const asked: string[] = [];

export default () => ({
	observe: (event: ServerEvent) => {
		if (event.kind === 'call') asked.push(event.name);
	},
});
