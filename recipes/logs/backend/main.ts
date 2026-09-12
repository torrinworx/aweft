// The server half: the logs battery, the auth battery, and a small board an anonymous page can
// read and a signed-in page can write. Everything else is a module in ./modules.
//
// Run: PORT=8080 node recipes/logs/backend/main.ts

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
	// A hook that throws would otherwise reach an uncaught handler and end the run; here it is
	// exactly what the logs battery records, so it is swallowed and the visit holds it.
	handlers: { failed: () => {} },
});
await server.start();

console.log(`backend on http://127.0.0.1:${String(listener.port)}`);
