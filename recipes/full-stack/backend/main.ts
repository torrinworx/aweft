// The whole boot for the server half. Everything this application does is a module in
// ./modules: the document it holds, the two things it answers, and who may reach them.
//
// Run: PORT=8080 node recipes/full-stack/backend/main.ts

import { fileURLToPath } from 'node:url';

import { auth, paths } from '@aweftjs/auth';
import { fromDirectory } from '@aweftjs/modules/node';
import { createServer } from '@aweftjs/server';
import { node } from '@aweftjs/server/node';
import { createStore, memoryDriver } from '@aweftjs/store';

const port = Number(process.env.PORT ?? 8080);

export const store = createStore({ driver: memoryDriver(), declare: { ...paths } });
export const listener = node({ port, host: '127.0.0.1' });
export const server = createServer({
	sources: [fromDirectory(fileURLToPath(new URL('./modules', import.meta.url))), auth],
	store,
	gate: 'auth/Gate',
	listener,
});
await server.start();

// `port` is only known after `start` when it was asked for as 0, which is what `../main.ts`
// asks for so a gate run takes no fixed port.
console.log(`backend on http://127.0.0.1:${String(listener.port)}`);
