// The server half: the auth battery, the logs battery, and one module of the application's
// own that holds the module document and the board a room writes to.
//
// Run: PORT=8080 node --import @aweftjs/build/loader recipes/room/backend/main.ts

import { fileURLToPath } from 'node:url';

import { auth, paths as authPaths } from '@aweftjs/auth';
import { logs, paths as logPaths } from '@aweftjs/logs';
import { fromDirectory } from '@aweftjs/modules/node';
import { createServer } from '@aweftjs/server';
import { node } from '@aweftjs/server/node';
import { createStore, memoryDriver } from '@aweftjs/store';

const port = Number(process.env.PORT ?? 8080);

export const store = createStore({ driver: memoryDriver(), declare: { ...authPaths, ...logPaths, title: ['title'] } });
export const listener = node({ port, host: '127.0.0.1' });
export const server = createServer({
	sources: [fromDirectory(fileURLToPath(new URL('./modules', import.meta.url))), logs, auth],
	store,
	gate: 'auth/Gate',
	listener,
});
await server.start();

console.log(`backend on http://127.0.0.1:${String(listener.port)}`);
