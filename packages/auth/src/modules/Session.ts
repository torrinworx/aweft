// auth/Session: sessions as documents, the cookie, who a request is (design 074), and the
// sweep that removes a session once it has been over for `keep` days (design 275).

import { codecError } from '@aweftjs/codec';
import { atomic } from '@aweftjs/core';
import type { ModuleProps } from '@aweftjs/modules';
import type { Identified, Peer } from '@aweftjs/server';

import { type AuthContext, userOf } from '../context.ts';
import { cookiesOf, setCookie } from '../cookie.ts';
import { json, storeOf } from '../props.ts';
import { isToken, mintToken } from '../token.ts';

export const defaults = { cookie: 'session', keep: 30, sweepMs: 3_600_000 };

/** What a `session:<token>` document holds. */
export interface SessionDocument extends Record<string, unknown> {
	user: string;
	/** When it stopped, or stops, being valid: the lifetime's end, the moment of revocation, or null for never. */
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
	/** End every active session of a user but the one named. Returns how many it ended. */
	revokeAll(user: string, except?: string): Promise<number>;
	/** Who a request is, from its cookies, and where it came from. Always a context: this gate refuses nobody at the door. */
	whoIs(request: Request, peer?: Peer): Promise<Identified<AuthContext>>;
	/** The `Set-Cookie` value that sets the cookie to a token, or clears it for null. */
	setCookie(token: string | null, request: Request): string;
	/** Who the asking connection is. The module is public, so an anonymous one hears `{ user: null }`. */
	call(args: unknown, context: unknown): { user: string | null };
	/** Remove every session that has been over for longer than `keep` days. Returns how many. */
	sweep(): Promise<number>;
	stop(): Promise<void>;
	readonly routes: Record<string, (request: Request, context: AuthContext) => Promise<Response>>;
}

const refuse = (detail: string, fix: string): Error => codecError('invalid-config', `auth/Session was given ${detail}`, fix);

// Over 2^31 - 1 milliseconds Node fires a timer after one millisecond instead.
const MAX_TIMER = 2_147_483_647;

export default async ({ config, ...props }: ModuleProps): Promise<Session> => {
	const store = storeOf(props);
	const cookie = String(config.cookie);
	// Configuration is typed by hand in a same-named file, so a lifetime that is not a positive
	// number is a mistake to stop here rather than a session that quietly never expires.
	if (config.sessionMs !== undefined
		&& !(typeof config.sessionMs === 'number' && Number.isFinite(config.sessionMs) && config.sessionMs > 0)) {
		throw refuse(`sessionMs ${JSON.stringify(config.sessionMs)}`, 'Set sessionMs to a positive number of milliseconds, or leave it out.');
	}
	const sessionMs = config.sessionMs as number | undefined;
	if (typeof config.keep !== 'number' || !(config.keep > 0) || !Number.isFinite(config.keep)) {
		throw refuse(`keep ${JSON.stringify(config.keep)}`, 'Set keep to a positive number of days.');
	}
	if (typeof config.sweepMs !== 'number' || !(config.sweepMs > 0) || config.sweepMs > MAX_TIMER) {
		throw refuse(`sweepMs ${JSON.stringify(config.sweepMs)}`, 'Set sweepMs to a positive number of milliseconds, at most 2147483647.');
	}
	const keep = config.keep;
	const sweepMs = config.sweepMs;
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
		const token = mintToken();
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
		// The sweep can remove the document between the head and the open, and the open then
		// makes an empty one; a session with no user was never issued, and nothing is written.
		if (held.user === undefined) {
			await store.close(handle);
			await store.remove(doc(token));
			return false;
		}
		const was = held.status === 'active';
		// `expires` becomes the moment it ended, so one declared path says when any session was
		// last valid and the sweep needs no second one.
		if (was) {
			atomic(() => {
				held.status = 'revoked';
				held.expires = Date.now();
			});
		}
		await store.settled(handle);
		await store.close(handle);
		return was;
	};

	// The `user` path is declared for every document, so the answer is filtered to this
	// battery's own sessions; `revoke` says which of them were still active.
	const revokeAll = async (user: string, except?: string): Promise<number> => {
		let ended = 0;
		for (const { doc: name } of await store.find({ where: [{ field: 'user', op: 'eq', value: user }] })) {
			if (!name.startsWith('session:')) continue;
			const token = name.slice('session:'.length);
			if (token === except) continue;
			if (await revoke(token)) ended += 1;
		}
		return ended;
	};

	// Every cookie of the name, in order: the first that is a token naming a live session wins,
	// and none is anonymous. A value that is not a token is skipped rather than refused, since
	// a cookie of the same name from another path or another application is not tampering, and
	// refusing would lock the client out of the one route that clears it (design 074).
	const whoIs = async (request: Request, peer?: Peer): Promise<Identified<AuthContext>> => {
		const address = peer?.address;
		for (const token of cookiesOf(request, cookie)) {
			if (!isToken(token)) continue;
			const session = await read(token);
			if (session === undefined || session.status !== 'active') continue;
			if (session.expires !== null && session.expires <= Date.now()) continue;
			return { context: { user: session.user, session: token, address } };
		}
		// A fresh object each time: the server hands the same reference to every hook and event
		// of one connection, and a module keys connections apart by it (design 260).
		return { context: { user: null, session: null, address } };
	};

	const sweep = async (): Promise<number> => {
		const cutoff = Date.now() - keep * 86_400_000;
		let removed = 0;
		for (const { doc: name, fields } of await store.find({ where: [{ field: 'expires', op: 'lt', value: cutoff }] })) {
			// The path is declared for every document, so the answer is filtered to this
			// battery's own; a session with no end carries null, which is never under the cutoff.
			if (!name.startsWith('session:') || typeof fields.expires !== 'number' || fields.expires >= cutoff) continue;
			await store.remove(name);
			removed += 1;
		}
		return removed;
	};

	// Loud at load rather than at the first sweep an hour in: the sweep queries a declared
	// path, and a store that has not declared it refuses the query.
	try {
		await store.find({ where: [{ field: 'expires', op: 'lt', value: 0 }], limit: 1 });
	} catch {
		throw codecError(
			'undeclared', 'the store does not declare the paths this battery queries',
			'Spread paths from @aweftjs/auth into the store\'s declare.',
		);
	}
	await sweep();
	const timer = setInterval(() => { void sweep().catch(() => undefined); }, sweepMs);
	timer.unref?.();

	return {
		public: true,
		issue,
		revoke,
		revokeAll,
		whoIs,
		setCookie: (token, request) => setCookie(cookie, token, request, sessionMs),
		// The only moment a page can learn who it is comes after its socket opens, because
		// identity is fixed at the handshake (design 185).
		call: (_args, context) => ({ user: userOf(context) }),
		sweep,
		stop: async () => { clearInterval(timer); },
		routes: {
			'DELETE /api/session': async (request, context) => {
				if (context.session !== null) await revoke(context.session);
				return json(200, { user: null }, { 'set-cookie': setCookie(cookie, null, request) });
			},
		},
	};
};
