// The browser half of the battery, as an entry: what a page calls itself, and the source that
// puts the two client modules on the page (design 245).

import { fromBundle } from '@aweftjs/modules';
import type { Source } from '@aweftjs/modules';

export { createAuth } from './auth-client.ts';
export type { Auth, AuthOptions, Entered, FetchInit, FetchResponse, Fetcher } from './auth-client.ts';

/**
 * The battery's page modules, for a stage's `sources`.
 *
 * Two of them. `auth/Session` is `createAuth` over the connection the stage handed the loader,
 * and its instance is the `Auth`: `user`, `enter`, `leave`, `state`, `check` and `stop`. Any
 * module of yours that needs to know who the page is names it in `deps`. `auth/SignIn` is an act
 * module: the sign-in and sign-up form, in one, because `enter` does both.
 *
 * The battery picks no URL. Put `auth/SignIn` on the address you want it at, and it lands there.
 * Put a module of the same name in an earlier source to replace either one, or a file exporting
 * only `config` to configure it: `auth/Session` reads `origin` and `fetch` out of its config.
 *
 * Example:
 *   <StageContext sources={[app, authClient]} client={client}
 *     acts={{ '': Home, notes: 'notes/Page', join: 'auth/SignIn' }} refused="join">
 *     <Stage />
 *   </StageContext>
 */
export const authClient: Source = fromBundle({
	'./auth/Session.ts': () => import('./client-modules/Session.ts'),
	'./auth/SignIn.tsx': () => import('./client-modules/SignIn.tsx'),
});
