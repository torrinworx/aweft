// The battery, as a source of server modules: six of them, and the store paths they query
// (designs 074, 289).

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
	'./auth/Roles.ts': () => import('./modules/Roles.ts'),
	'./auth/Enter.ts': () => import('./modules/Enter.ts'),
	'./auth/Check.ts': () => import('./modules/Check.ts'),
	'./auth/State.ts': () => import('./modules/State.ts'),
});

/**
 * The paths the application declares on its store for these modules to query: `email` on
 * user documents, `user` and `expires` on session and link documents.
 *
 * Example:
 *   const store = createStore({ driver, declare: { ...paths, title: ['title'] } });
 */
export const paths: Declaration = { email: ['email'], user: ['user'], expires: ['expires'] };

export { holds } from './names.ts';
export type { Implies } from './names.ts';
export type { AuthContext } from './context.ts';
export type { Roles } from './modules/Roles.ts';
