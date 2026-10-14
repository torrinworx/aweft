// The whole boot for the server half. Everything this application does is a module in
// ./modules: the documents it holds, the things it answers, and who may reach them. The built
// page is served last, by the static battery, from what `vite build` wrote.
//
// Run: PORT=8080 node recipes/full-stack/backend/main.ts

import { fileURLToPath } from 'node:url';

import { auth, paths } from '@aweftjs/auth';
import { fromDirectory } from '@aweftjs/modules/node';
import { createServer } from '@aweftjs/server';
import { node } from '@aweftjs/server/node';
import { files } from '@aweftjs/static';
import { createStore, memoryDriver } from '@aweftjs/store';

const port = Number(process.env.PORT ?? 8080);

export const store = createStore({ driver: memoryDriver(), declare: { ...paths } });
// Reachable on this machine only. In production a proxy on the same machine (nginx) is the one
// thing in front of it and sets X-Real-IP, so the address a rate limit counts is the visitor's and
// not the proxy's. A request with no such header, the dev server's, keeps the socket's address.
export const listener = node({ port, host: '127.0.0.1', forwarded: 'x-real-ip' });
export const server = createServer({
	sources: [fromDirectory(fileURLToPath(new URL('./modules', import.meta.url))), auth, files],
	store,
	gate: 'auth/Gate',
	listener,
});
await server.start();

// `port` is only known after `start` when it was asked for as 0, which is what `../main.ts`
// asks for so a gate run takes no fixed port.
console.log(`backend on http://127.0.0.1:${String(listener.port)}`);
