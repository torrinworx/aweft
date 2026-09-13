// The server half: the uploads battery, the static battery behind it, the auth battery, and a
// gallery module that makes a file of its own. Everything else is a module in ./modules.
//
// Run: PORT=8080 AWEFT_UPLOADS_DIR=var/uploads AWEFT_SITE_DIR=dist node recipes/uploads/backend/main.ts

import { fileURLToPath } from 'node:url';

import { auth, paths as authPaths } from '@aweftjs/auth';
import { fromDirectory } from '@aweftjs/modules/node';
import { createServer } from '@aweftjs/server';
import { node } from '@aweftjs/server/node';
import { files } from '@aweftjs/static';
import { createStore, memoryDriver } from '@aweftjs/store';
import { paths as uploadPaths, uploads } from '@aweftjs/uploads';

const port = Number(process.env.PORT ?? 8080);

export const store = createStore({ driver: memoryDriver(), declare: { ...authPaths, ...uploadPaths } });
export const listener = node({ port, host: '127.0.0.1' });
export const server = createServer({
	// `uploads` before `files`: static/Files answers every URL it is asked, so it goes last.
	sources: [fromDirectory(fileURLToPath(new URL('./modules', import.meta.url))), uploads, files, auth],
	store,
	gate: 'auth/Gate',
	listener,
});
await server.start();

console.log(`backend on http://127.0.0.1:${String(listener.port)}`);
