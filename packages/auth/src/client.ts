// The browser half of the battery, as an entry: what a page calls itself, and the source that
// puts the four client modules on the page (designs 245, 290).

import { fromBundle } from '@aweftjs/modules';
import type { Source } from '@aweftjs/modules';

export { createAuth } from './auth-client.ts';
export type { Auth, AuthOptions, Entered, FetchInit, FetchResponse, Fetcher, Outcome } from './auth-client.ts';

/**
 * The battery's page modules, for a stage's `sources`.
 *
 * Four of them. `auth/Session` is `createAuth` over the connection the stage handed the loader,
 * and its instance is the `Auth`: `user`, `names`, `may`, `enter`, `leave`, `state`, `check`,
 * `verify`, `change`, `forgot`, `reset` and `stop`. Any module of yours that needs to know who
 * the page is names it in `deps`. The other three are act modules: `auth/SignIn`, the sign-in
 * and sign-up form in one, because `enter` does both; `auth/Verify`, the page a verification
 * link opens, and the button that asks for one; `auth/Reset`, the forgot form, and the
 * new-password form a reset link opens.
 *
 * The battery picks no URL. Put an act on the address you want it at, and it lands there; the
 * mail links point at those addresses through the server modules' `url`. Put a module of the
 * same name in an earlier source to replace any of them, or a file exporting only `config` to
 * configure one: `auth/Session` reads `origin` and `fetch` out of its config.
 *
 * Example:
 *   <StageContext sources={[app, authClient]} client={client}
 *     acts={{ '': Home, notes: 'notes/Page', join: 'auth/SignIn', verify: 'auth/Verify', reset: 'auth/Reset' }}
 *     refused="join">
 *     <Stage />
 *   </StageContext>
 */
export const authClient: Source = fromBundle({
	'./auth/Session.ts': () => import('./client-modules/Session.ts'),
	'./auth/SignIn.tsx': () => import('./client-modules/SignIn.tsx'),
	'./auth/Verify.tsx': () => import('./client-modules/Verify.tsx'),
	'./auth/Reset.tsx': () => import('./client-modules/Reset.tsx'),
});
