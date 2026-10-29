// The battery, as three sources of server modules: the six every application loads, the two
// that mail and so need notify, the one that signs in through Google, and the store paths they
// query (designs 074, 289, 290, 318).

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
 * The two modules that mail: `auth/Verify` and `auth/Password`. Both name `notify/Send` in
 * their `deps`, so list `notify` beside this, and give each its `url` in a same-named file.
 *
 * Example:
 *   createServer({ sources: [own, auth, mail, notify], store, gate: 'auth/Gate', listener });
 */
export const mail: Source = fromBundle({
	'./auth/Verify.ts': () => import('./modules/Verify.ts'),
	'./auth/Password.ts': () => import('./modules/Password.ts'),
});

/**
 * Sign-in with Google: `auth/Google`, which names `auth/Session` and `auth/Enter` (design 318).
 * Give it `clientId`, `clientSecret` and `callback` in a same-named file, and turn on the
 * `google` setting of the page's `auth/SignIn`. Leave this out and nothing of Google loads.
 *
 * Example:
 *   createServer({ sources: [own, auth, google], store, gate: 'auth/Gate', listener });
 */
export const google: Source = fromBundle({
	'./auth/Google.ts': () => import('./modules/Google.ts'),
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
export type { ConfirmedBy, RefuseSignUp, SignUp } from './modules/Enter.ts';
export type { Roles } from './modules/Roles.ts';
