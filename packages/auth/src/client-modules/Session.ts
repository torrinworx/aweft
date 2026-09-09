// auth/Session on the page: `createAuth` over the connection the stage handed in (design 245).

import { codecError } from '@aweftjs/codec';
import { type Derived, immutable, mutable } from '@aweftjs/core';
import type { Client, Handle } from '@aweftjs/client';

import { type Auth, createAuth } from '../auth-client.ts';

const NO_CLIENT_FIX = 'Pass the client createClient answered as the StageContext client, or none at all.';
const ANONYMOUS_FIX = 'Wait for user to read a string, or call enter first; an anonymous connection has no state.';

const isClient = (value: unknown): value is Client => {
	const held = value as Partial<Client> | null;
	return held !== null && typeof held === 'object'
		&& typeof held.ask === 'function' && typeof held.share === 'function'
		&& typeof held.status === 'object' && held.status !== null;
};

const noClient = (what: string): Error =>
	codecError('no-client', `auth/Session has no connection, so ${what}`, NO_CLIENT_FIX);

/**
 * Identity with no connection at all: anonymous, at once and for good (design 245).
 *
 * What a static render gets, because `render` has no socket to give. `user` reads `null` from the
 * start, which is a known answer rather than a wait: a factory that awaits identity would
 * otherwise never return, and `render` waits on every pending promise, so the whole render hung.
 * A gate refuses at once instead, and the sign-in act is what a static render of a gated page
 * holds.
 */
const anonymous = (): Auth => {
	const who: Derived<string | null | undefined> = immutable(mutable<string | null | undefined>(null));
	return {
		user: who,
		enter: async () => { throw noClient('no sign-in was sent'); },
		leave: async () => { throw noClient('no sign-out was sent'); },
		check: async () => { throw noClient('no lookup was sent'); },
		// The same refusal the real one gives an anonymous connection, so a page that reads it
		// takes one path rather than two.
		state: <T extends object>(): Handle<T> => {
			const ready = Promise.reject<T>(codecError('anonymous',
				'there is no signed-in user to share a state document for', ANONYMOUS_FIX));
			ready.catch(() => {});
			return { document: undefined, ready, stop: () => {} };
		},
		stop: () => {},
	};
};

export default ({ client, config }: { client?: unknown; config: Readonly<Record<string, unknown>> }): Auth => {
	if (client === undefined) return anonymous();
	if (!isClient(client)) {
		throw codecError('no-client',
			'auth/Session was handed a client with no status, ask or share on it',
			NO_CLIENT_FIX);
	}
	const origin = config['origin'];
	const fetch = config['fetch'];
	return createAuth(client, {
		...(typeof origin === 'string' ? { origin } : {}),
		...(typeof fetch === 'function' ? { fetch: fetch as Exclude<Parameters<typeof createAuth>[1], undefined>['fetch'] } : {}),
	});
};
