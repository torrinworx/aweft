// The browser half of the battery: who the page is, over a connection it already has
// (design 185).
//
// Every import here is a type or one of the four values `core` and `codec` hand out, so a page
// bundle that reaches for it carries no server module, no store and no Node module. Identity is
// fixed for a connection's life, so this asks once per socket and reconnects whenever the cookie
// changes underneath it.

import type { Client, Handle } from '@aweftjs/client';
import { codecError } from '@aweftjs/codec';
import { type Derived, immutable, mutable } from '@aweftjs/core';

import type { Entered } from './modules/Enter.ts';

export type { Entered } from './modules/Enter.ts';

/** What a refusal from the sign-in route carries, taken from the module's own answer shape. */
type Refusals = Extract<Entered, { readonly refused: unknown }>['refused'];

/** What `fetch` is given, stated here so this declaration names no DOM type. */
export interface FetchInit {
	method: string;
	headers: Record<string, string>;
	body?: string;
	credentials: 'same-origin';
}

/** What `fetch` answers, stated here for the same reason. */
export interface FetchResponse {
	status: number;
	ok: boolean;
	json(): Promise<unknown>;
}

/** The two HTTP calls this half makes. The global `fetch` is one of these already. */
export type Fetcher = (url: string, init: FetchInit) => Promise<FetchResponse>;

/** What the client half may be told about how it runs. Both fields have a default in a page. */
export interface AuthOptions {
	/** Where the session routes are. Defaults to the page's own origin. */
	readonly origin?: string | undefined;
	/** Makes the two HTTP calls. Defaults to the global `fetch`. */
	readonly fetch?: Fetcher | undefined;
}

/** Identity over one connection: who the page is, and how it signs in and out. */
export interface Auth {
	/**
	 * Who the connection is, as a read-only cell: `undefined` until the server has answered,
	 * `null` for an anonymous connection, the user's id otherwise. Writing it throws `read-only`.
	 */
	readonly user: Derived<string | null | undefined>;
	/**
	 * Sign in, or sign up when nobody has the email.
	 *
	 * Params:
	 *   email: the address to sign in as
	 *   password: their password
	 *
	 * Returns: `{ user, created }` once `user` reads the new id. The client reconnects first,
	 * because a cookie cannot be set on an open socket and identity is fixed per connection.
	 * A wrong password or a malformed address resolves with `{ refused }` and reconnects
	 * nothing.
	 *
	 * Rejects with `enter-failed` for any other status, and with whatever `fetch` threw. On a
	 * stopped auth it rejects `stopped` before the route is called at all, and with `closed` when
	 * the route answered but the client was closed, so no socket can carry the new identity.
	 *
	 * Example:
	 *   const outcome = await auth.enter('ada@example.com', 'correct horse battery staple');
	 *   if ('refused' in outcome) show(outcome.refused);
	 */
	enter(email: string, password: string): Promise<Entered>;
	/**
	 * Sign out.
	 *
	 * Params: none.
	 *
	 * Returns: nothing, once `user` reads `null` again. The state handle is stopped and the
	 * client reconnects, so the next connection is anonymous.
	 *
	 * Rejects with `leave-failed` when the route answers anything but `ok`, with `stopped` on a
	 * stopped auth before the route is called, and with `closed` when the route answered but the
	 * client was closed.
	 *
	 * Example:
	 *   await auth.leave();
	 */
	leave(): Promise<void>;
	/**
	 * Share the signed-in user's own state document.
	 *
	 * Params: none. `T` is the shape the application keeps in it.
	 *
	 * Returns: a handle over the user's `state` document, `document`, `ready` and `stop()` as
	 * `client.share` answers them. On an anonymous connection its `ready` rejects `anonymous`
	 * at once rather than waiting for a topic the server will never offer; before the server
	 * has answered, it waits and then does one or the other.
	 *
	 * One connection carries one state document, so asking twice hands back the same handle,
	 * stopped or not: the server offers the topic once per socket. `enter` and `leave` stop it
	 * and open a socket, and the call after either gives a new handle, because another user's
	 * state is another document.
	 *
	 * When `user` changes underneath the page (the server forgot the session, or another user's
	 * cookie replaced it, and the client came back on its own), the handle the page holds is
	 * stopped and follows the server no further. The next call gives a handle for whoever the
	 * connection is now, and a page follows `user` to notice. After `stop()` this refuses
	 * `stopped`.
	 *
	 * Example:
	 *   const state = await auth.state<State>().ready;
	 *   state.theme = 'dark';
	 */
	state<T extends object>(): Handle<T>;
	/**
	 * Does anyone have this email, so a form can ask before it asks for a password.
	 *
	 * Params:
	 *   email: the address to look for
	 *
	 * Returns: whether an account has it. On a stopped auth it rejects `stopped` instead.
	 *
	 * Example:
	 *   const known = await auth.check('ada@example.com');
	 */
	check(email: string): Promise<boolean>;
	/**
	 * Stop following the connection.
	 *
	 * Params: none.
	 *
	 * Returns: nothing. The status watcher goes and the current state handle stops; the client
	 * is left open, because it is not this half's to close. Every method after this refuses with
	 * `stopped`. Calling it twice is not an error.
	 *
	 * Example:
	 *   auth.stop();
	 */
	stop(): void;
}

const NO_ORIGIN_FIX = 'Pass origin to createAuth; outside a page there is no origin to read one from.';
const ANONYMOUS_FIX = 'Wait for user to read a string, or call enter first; an anonymous connection has no state.';
const ENTER_FIX = 'Check the server is running and that auth/Enter is loaded, then try again.';
const LEAVE_FIX = 'Check the server is running and that auth/Session is loaded, then try again.';
const STOPPED_FIX = 'Make a new auth with createAuth; a stopped one follows no connection.';
const CLIENT_CLOSED_FIX = 'Make a new client with createClient, and a new auth over it.';

const anonymous = (): Error =>
	codecError('anonymous', 'there is no signed-in user to share a state document for', ANONYMOUS_FIX);

const halted = (detail: string): Error => codecError('stopped', detail, STOPPED_FIX);

/** The page's own origin, the one address this half will take without being told. */
const pageOrigin = (): string => {
	const held = (globalThis as { location?: { origin?: unknown } }).location?.origin;
	if (typeof held !== 'string' || held === '') {
		throw codecError('no-origin', 'there is no page origin to take the session routes from', NO_ORIGIN_FIX);
	}
	return held;
};

const globalFetch: Fetcher = (url, init) =>
	(globalThis.fetch as unknown as Fetcher)(url, init);

/**
 * Add identity to a connection.
 *
 * Params:
 *   client: the connection, from `createClient`. This never opens or closes the connection
 *           for good; after sign-in and sign-out it asks the client to reconnect, because
 *           identity is fixed per socket
 *   options.origin: where the session routes are; the page's own origin by default
 *   options.fetch: makes the two HTTP calls; the global `fetch` by default
 *
 * Returns: `user`, `enter`, `leave`, `state`, `check` and `stop`. `user` reads `undefined`
 * until the first socket answers, and is asked again on every socket that opens.
 *
 * `enter`, `leave` and every other call that sends over HTTP rejects with `no-origin` when no
 * `origin` was given and there is no page to read one from. Making the auth is safe anywhere.
 *
 * Example:
 *   const client = createClient();
 *   const auth = createAuth(client);
 *   auth.user.effect((who) => header.textContent = who ?? 'signed out');
 *   await auth.enter('ada@example.com', 'correct horse battery staple');
 */
export const createAuth = (client: Client, options: AuthOptions = {}): Auth => {
	const send = options.fetch ?? globalFetch;
	// Read when a route is called, not when the auth is made: a module that holds one is built by
	// a static render as well as by a page, and only a page has an origin (design 245).
	const routeUrl = (): string => `${options.origin ?? pageOrigin()}/api/session`;
	const identity = mutable<string | null | undefined>(undefined);

	let stopped = false;
	let held: Handle<object> | undefined;
	/** Who the held handle was made for, so an identity that changes underneath it is visible. */
	let heldFor: string | null | undefined;

	// Identity is fixed at the handshake, so every socket is a new answer and the old one is
	// worth nothing. An ask that rejects took the socket with it; the next one asks again.
	const refresh = (): void => {
		client.ask('auth/Session').then((answer) => {
			if (stopped) return;
			const who: unknown = (answer as { user?: unknown } | null)?.user;
			const next = typeof who === 'string' ? who : null;
			identity.set(next);
			// The server forgot the session, or another user's cookie replaced it. The handle the
			// page holds is the old user's document and every later socket would re-share it, so
			// it stops here and the next `state()` answers for whoever this is now.
			if (held !== undefined && heldFor !== next) stopState();
		}, () => {});
	};

	const release = client.status.watch((now) => {
		if (now === 'open') refresh();
	});
	if (client.status.get() === 'open') refresh();

	/** The next value `user` takes that is not `undefined`, which is what a reconnect settles to. */
	const answered = (): { known: Promise<string | null>; cancel(): void } => {
		let off: (() => void) | undefined;
		const known = new Promise<string | null>((done) => {
			off = identity.watch((who) => {
				if (who === undefined) return;
				off?.();
				off = undefined;
				done(who);
			});
		});
		return { known, cancel: () => { off?.(); off = undefined; } };
	};

	const stopState = (): void => {
		held?.stop();
		held = undefined;
		heldFor = undefined;
	};

	const keep = <T extends object>(handle: Handle<T>, who: string | null | undefined): Handle<T> => {
		held = handle as unknown as Handle<object>;
		heldFor = who;
		return handle;
	};

	// Both routes change who the cookie says this browser is, and the socket that is open was
	// identified before that. Dropping it is the whole reason these two reconnect.
	const again = async (): Promise<string | null> => {
		stopState();
		identity.set(undefined);
		const next = answered();
		client.reconnect();
		// A live client goes to `connecting` inside `reconnect()`; a closed one does nothing at
		// all, so no socket would ever carry the new identity and this would wait forever.
		if (client.status.get() !== 'connecting') {
			next.cancel();
			throw codecError('closed', 'the session route answered but the client is closed, so no socket can carry the new identity', CLIENT_CLOSED_FIX);
		}
		return await next.known;
	};

	return {
		user: immutable(identity),

		enter: async (email, password) => {
			if (stopped) throw halted('the auth is stopped and no sign-in was sent');
			const route = routeUrl();
			const answer = await send(route, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ email, password }),
				credentials: 'same-origin',
			});
			if (answer.status === 400 || answer.status === 401) {
				const refused: unknown = ((await answer.json()) as { reasons?: unknown } | null)?.reasons;
				return { refused: (Array.isArray(refused) ? refused : []) as Refusals };
			}
			if (!answer.ok) {
				throw codecError('enter-failed', `POST ${route} answered ${String(answer.status)}`, ENTER_FIX);
			}
			const body = (await answer.json()) as { user: string; created: boolean };
			await again();
			return { user: body.user, created: body.created };
		},

		leave: async () => {
			if (stopped) throw halted('the auth is stopped and no sign-out was sent');
			const route = routeUrl();
			const answer = await send(route, { method: 'DELETE', headers: {}, credentials: 'same-origin' });
			if (!answer.ok) {
				throw codecError('leave-failed', `DELETE ${route} answered ${String(answer.status)}`, LEAVE_FIX);
			}
			// The connection after a sign-out carries no session, so the value it settles to is null.
			await again();
		},

		state: <T extends object>(): Handle<T> => {
			if (stopped) {
				const ready = Promise.reject(halted('the auth is stopped and follows no connection'));
				ready.catch(() => {});
				return { document: undefined, ready, stop: () => {} };
			}
			// One connection carries one state document, and the server offers the topic once.
			// A second share of a name the peer has already paired waits for an offer that never
			// comes, and so does a share made after `stop()`. So this hands back the same handle
			// for the connection's life. `enter` and `leave` let go of it, and the socket they
			// open offers the topic again.
			if (held !== undefined) return held as unknown as Handle<T>;

			const who = identity.get();
			if (who === null) {
				const ready = Promise.reject(anonymous());
				// A page that renders `user` and never reads this promise is not killed by it,
				// which is the rule `sync`'s link already keeps for a topic that ends early.
				ready.catch(() => {});
				return keep<T>({ document: undefined, ready, stop: () => {} }, null);
			}
			if (who !== undefined) return keep(client.share<T>('state'), who);

			// Nobody has answered yet. The handle exists now because the page asked for it now,
			// and it stands in for the share the first answer either makes or refuses.
			let inner: Handle<T> | undefined;
			let off: (() => void) | undefined;
			const ready = new Promise<T>((settle, fail) => {
				off = identity.watch((now) => {
					if (now === undefined) return;
					off?.();
					off = undefined;
					// The first answer is who this handle is for, and `refresh` reads it back to
					// tell an identity that changed later from this one arriving.
					if (held === waited) heldFor = now;
					if (now === null) {
						fail(anonymous());
						return;
					}
					inner = client.share<T>('state');
					inner.ready.then(settle, fail);
				});
			});
			ready.catch(() => {});
			const waited: Handle<T> = {
				get document() {
					return inner?.document;
				},
				ready,
				stop: () => {
					off?.();
					off = undefined;
					inner?.stop();
				},
			};
			return keep(waited, undefined);
		},

		check: async (email) => {
			if (stopped) throw halted('the auth is stopped and no lookup was sent');
			return ((await client.ask('auth/Check', { email })) as { exists: boolean }).exists;
		},

		stop: () => {
			if (stopped) return;
			stopped = true;
			release();
			stopState();
		},
	};
};
