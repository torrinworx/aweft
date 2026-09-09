// This file is the whole boot. Everything this application does is a module in ./modules:
// the documents it holds, the rules it keeps, the jobs it runs, and who may reach what.
//
// Run: node recipes/backend/main.ts

import { fileURLToPath } from 'node:url';

import { auth, paths } from '@aweftjs/auth';
import { fromDirectory } from '@aweftjs/modules/node';
import { createServer } from '@aweftjs/server';
import { node } from '@aweftjs/server/node';
import { createStore, memoryDriver } from '@aweftjs/store';

const store = createStore({ driver: memoryDriver(), declare: { ...paths } });
const listener = node({ port: 0, host: '127.0.0.1' });
const server = createServer({
	sources: [fromDirectory(fileURLToPath(new URL('./modules', import.meta.url))), auth],
	store,
	gate: 'app/Gate',
	listener,
});
await server.start();

// The checks that prove it, which a real application would not have. Everything above this
// line is the part to copy.
await (await import('./checks.ts')).run({ server, store, listener });
