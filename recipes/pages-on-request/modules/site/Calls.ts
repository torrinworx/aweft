// What reached the server over a socket. The server tells every module that observes it about
// each ask a client made, and a render's reads are not among them, so after a hydration this list
// says which reads the browser had to make again.

import type { ServerEvent } from '@aweftjs/server';

export const asked: string[] = [];

export default () => ({
	observe: (event: ServerEvent) => {
		if (event.kind === 'call') asked.push(event.name);
	},
});
