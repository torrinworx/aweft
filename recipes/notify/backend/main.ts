// The server half: the notify battery, the auth battery, and one module of the application's
// own that sends. Everything else is a module in ./modules; the battery's configuration is the
// file ./modules/notify/Send.ts, which reads where the two services are from the environment.
//
// Run: PORT=8080 node recipes/notify/backend/main.ts

import { fileURLToPath } from 'node:url';

import { auth, paths } from '@aweftjs/auth';
import { fromDirectory } from '@aweftjs/modules/node';
import { notify } from '@aweftjs/notify';
import { createServer } from '@aweftjs/server';
import type { Server } from '@aweftjs/server';
import { node } from '@aweftjs/server/node';
import { createStore, memoryDriver } from '@aweftjs/store';
import type { Driver, Store } from '@aweftjs/store';

export interface Running {
	readonly driver: Driver;
	readonly store: Store;
	readonly server: Server;
	readonly port: number;
	/** Stop the server; with `restarting` the driver is left open for `boot` to take again. */
	stop(restarting?: boolean): Promise<void>;
}

/**
 * Boot the server over a driver. Handing the same driver in again after `stop` is a restart:
 * what the first run stored is what the second one reads.
 */
export const boot = async (driver: Driver = memoryDriver(), port = Number(process.env.PORT ?? 8080)): Promise<Running> => {
	const store = createStore({ driver, declare: { ...paths } });
	const listener = node({ port, host: '127.0.0.1' });
	const server = createServer({
		sources: [fromDirectory(fileURLToPath(new URL('./modules', import.meta.url))), notify, auth],
		store,
		gate: 'auth/Gate',
		listener,
		handlers: { failed: (name, error) => { console.error(`${name} failed:`, error); } },
	});
	await server.start();
	return {
		driver, store, server,
		port: listener.port!,
		stop: async (restarting = false) => {
			await server.stop();
			if (!restarting) await store.stop();
		},
	};
};

export const running = await boot();

console.log(`backend on http://127.0.0.1:${String(running.port)}`);
