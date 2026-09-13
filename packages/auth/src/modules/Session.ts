// auth/Session: sessions as documents, the cookie, and who a request is (design 074).

import { codecError, createId, idFromText, idToText } from '@aweftjs/codec';
import { atomic } from '@aweftjs/core';
import type { ModuleProps } from '@aweftjs/modules';
import type { Identified } from '@aweftjs/server';

import { type AuthContext, userOf } from '../context.ts';
import { cookiesOf, setCookie } from '../cookie.ts';
import { json, storeOf } from '../props.ts';

export const defaults = { cookie: 'session' };

/** What a `session:<token>` document holds. */
export interface SessionDocument extends Record<string, unknown> {
	user: string;
	/** When it stops being valid, or null for never. */
	expires: number | null;
	status: 'active' | 'revoked';
	createdAt: number;
}

export interface Session {
	readonly public: true;
	/** Mint a session for a user. Returns its token, which is the cookie's value. */
	issue(user: string): Promise<string>;
	/** End a session. True when it was active. */
	revoke(token: string): Promise<boolean>;
	/** Who a request is, from its cookies. Always a context: this gate refuses nobody at the door. */
	whoIs(request: Request): Promise<Identified<AuthContext>>;
	/** The `Set-Cookie` value that sets the cookie to a token, or clears it for null. */
	setCookie(token: string | null, request: Request): string;
	/** Who the asking connection is. The module is public, so an anonymous one hears `{ user: null }`. */
	call(args: unknown, context: unknown): { user: string | null };
	readonly routes: Record<string, (request: Request, context: AuthContext) => Promise<Response>>;
}

export default ({ config, ...props }: ModuleProps): Session => {
	const store = storeOf(props);
	const cookie = String(config.cookie);
	// Configuration is typed by hand in a same-named file, so a lifetime that is not a positive
	// number is a mistake to stop here rather than a session that quietly never expires.
	if (config.sessionMs !== undefined
		&& !(typeof config.sessionMs === 'number' && Number.isFinite(config.sessionMs) && config.sessionMs > 0)) {
		throw codecError(
			'invalid-config', `auth/Session was given sessionMs ${JSON.stringify(config.sessionMs)}`,
			'Set sessionMs to a positive number of milliseconds, or leave it out.',
		);
	}
	const sessionMs = config.sessionMs as number | undefined;
	const doc = (token: string): string => `session:${token}`;

	// A document that was never written has no commits, and `open` would create it. Nothing
	// in the store says whether a document exists without opening it, so the head stands in.
	const read = async (token: string): Promise<SessionDocument | undefined> => {
		if (await store.head(doc(token)) === 0) return undefined;
		const handle = await store.open(doc(token));
		const held = { ...(handle.root as SessionDocument) };
		await store.close(handle);
		return held;
	};

	const issue = async (user: string): Promise<string> => {
		const token = idToText(createId());
		const handle = await store.open(doc(token));
		const now = Date.now();
		atomic(() => {
			Object.assign(handle.root, {
				user, expires: sessionMs === undefined ? null : now + sessionMs, status: 'active', createdAt: now,
			} satisfies SessionDocument);
		});
		await store.settled(handle);
		await store.close(handle);
		return token;
	};

	const revoke = async (token: string): Promise<boolean> => {
		if (await store.head(doc(token)) === 0) return false;
		const handle = await store.open(doc(token));
		const held = handle.root as SessionDocument;
		const was = held.status === 'active';
		if (was) held.status = 'revoked';
		await store.settled(handle);
		await store.close(handle);
		return was;
	};

	// Every cookie of the name, in order: the first that is a token naming a live session wins,
	// and none is anonymous. A value that is not a token is skipped rather than refused, since
	// a cookie of the same name from another path or another application is not tampering, and
	// refusing would lock the client out of the one route that clears it (design 074).
	const whoIs = async (request: Request): Promise<Identified<AuthContext>> => {
		for (const value of cookiesOf(request, cookie)) {
			let token: string;
			try {
				token = idToText(idFromText(value));
			} catch {
				continue;
			}
			const session = await read(token);
			if (session === undefined || session.status !== 'active') continue;
			if (session.expires !== null && session.expires <= Date.now()) continue;
			return { context: { user: session.user, session: token } };
		}
		// A fresh object each time: the server hands the same reference to every hook and event
		// of one connection, and a module keys connections apart by it (design 260).
		return { context: { user: null, session: null } };
	};

	return {
		public: true,
		issue,
		revoke,
		whoIs,
		setCookie: (token, request) => setCookie(cookie, token, request, sessionMs),
		// The only moment a page can learn who it is comes after its socket opens, because
		// identity is fixed at the handshake (design 185).
		call: (_args, context) => ({ user: userOf(context) }),
		routes: {
			'DELETE /api/session': async (request, context) => {
				if (context.session !== null) await revoke(context.session);
				return json(200, { user: null }, { 'set-cookie': setCookie(cookie, null, request) });
			},
		},
	};
};
