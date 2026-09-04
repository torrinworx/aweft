// The battery, as the loader takes it: one source over five server modules, and the two
// store paths they query (design 074).

import { fromBundle } from '@aweftjs/modules';
import type { Source } from '@aweftjs/modules';
import type { Declaration } from '@aweftjs/store';

/**
 * The auth modules, for a loader's `sources`.
 *
 * Put the application's own source first and a module of the same name there wins, which is
 * how one of these is replaced. Each module reads the store from the loader's props:
 * `createLoader({ sources: [own, auth], props: { store } })`.
 *
 * Example:
 *   const loader = createLoader({ sources: [fromDirectory('./modules'), auth], props: { store } });
 *   const gate = (await loader.load(['auth/Gate']))['auth/Gate'] as Gate;
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
