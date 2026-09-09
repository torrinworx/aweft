// The battery, as a source of server modules: five of them, and the two store paths they
// query (design 074).

import { fromBundle } from '@aweftjs/modules';
import type { Source } from '@aweftjs/modules';
import type { Declaration } from '@aweftjs/store';

/**
 * The auth modules, for `sources`.
 *
 * Put the application's own source first and a module of the same name there wins, which is
 * how one of these is replaced. Each module reads the `store` the platform handed in, which
 * on a server is the `store` given to `createServer`.
 *
 * Example:
 *   const server = createServer({ sources: [own, auth], store, gate: 'auth/Gate', listener });
 *   await server.start();
 */
export const auth: Source = fromBundle({
	'./auth/Gate.ts': () => import('./modules/Gate.ts'),
	'./auth/Session.ts': () => import('./modules/Session.ts'),
	'./auth/Enter.ts': () => import('./modules/Enter.ts'),
	'./auth/Check.ts': () => import('./modules/Check.ts'),
	'./auth/State.ts': () => import('./modules/State.ts'),
});

/**
 * The paths the application declares on its store for these modules to query: `email` on
 * user documents, `user` on session documents.
 *
 * Example:
 *   const store = createStore({ driver, declare: { ...paths, title: ['title'] } });
 */
export const paths: Declaration = { email: ['email'], user: ['user'] };

export type { AuthContext } from './context.ts';
