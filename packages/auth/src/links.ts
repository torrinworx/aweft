// A one-time link: a token naming a `<prefix>:<token>` document that says who it is for and
// when it stops being valid (design 290). Verification and reset links are both this. A taken
// link keeps its document, marked, until its end, so a second opening is told it was taken
// rather than that it never was (design 294).

import { atomic } from '@aweftjs/core';
import type { Refusal } from '@aweftjs/core';
import type { Store } from '@aweftjs/store';

import { isToken, mintToken } from './token.ts';

/** What a link document holds. `user` and `expires` are paths the battery declares, so the sweep is a query. `taken` is set once and queried by nothing. */
export interface LinkDocument extends Record<string, unknown> {
	user: string;
	expires: number;
	createdAt: number;
	taken?: boolean;
}

/** What a token names before its end: the user of a live link, or that the link was taken. */
export type Link = { readonly user: string } | { readonly taken: true };

/** What a route answers for a link it will not open: one nobody issued or past its end, and one already taken. */
export const NOT_LIVE: Refusal = { code: 'token', message: 'this link is not one that can be used' };
export const TAKEN: Refusal = { code: 'taken', message: 'this link has already been used' };

export interface Links {
	/** Mint a link for a user. Returns its token. */
	issue(user: string): Promise<string>;
	/** What the token names, leaving it. Undefined for a token nobody issued or one past its end. */
	peek(token: unknown): Promise<Link | undefined>;
	/** Take the link: the user it was for, and the document is marked taken. Undefined as `peek`. */
	take(token: unknown): Promise<Link | undefined>;
	/** Remove every link past its end, taken or not. Returns how many. */
	sweep(): Promise<number>;
	/** Stop the sweep timer. */
	stop(): void;
}

/**
 * The links of one prefix, each living `lifetimeMs` and swept every `sweepMs`.
 *
 * The first sweep runs when this is made, so a restart clears what expired while the process
 * was down; the timer never keeps the process alive.
 */
export const links = (store: Store, prefix: string, lifetimeMs: number, sweepMs: number): Links => {
	const doc = (token: string): string => `${prefix}:${token}`;

	const linkOf = (held: Partial<LinkDocument>): Link | undefined => {
		if (typeof held.user !== 'string' || typeof held.expires !== 'number' || held.expires <= Date.now()) return undefined;
		return held.taken === true ? { taken: true } : { user: held.user };
	};

	const sweep = async (): Promise<number> => {
		const now = Date.now();
		let removed = 0;
		for (const { doc: name, fields } of await store.find({ where: [{ field: 'expires', op: 'lt', value: now }] })) {
			// The path is declared for every document, so the answer is filtered to this prefix.
			if (!name.startsWith(`${prefix}:`) || typeof fields.expires !== 'number' || fields.expires >= now) continue;
			await store.remove(name);
			removed += 1;
		}
		return removed;
	};

	void sweep().catch(() => undefined);
	const timer = setInterval(() => { void sweep().catch(() => undefined); }, sweepMs);
	timer.unref?.();

	return {
		issue: async (user) => {
			const token = mintToken();
			const handle = await store.open(doc(token));
			const now = Date.now();
			atomic(() => {
				Object.assign(handle.root, { user, expires: now + lifetimeMs, createdAt: now } satisfies LinkDocument);
			});
			await store.settled(handle);
			await store.close(handle);
			return token;
		},
		peek: async (token) => {
			// A document that was never written has no commits, and `open` would create one.
			if (!isToken(token) || await store.head(doc(token)) === 0) return undefined;
			const handle = await store.open(doc(token));
			const link = linkOf(handle.root as Partial<LinkDocument>);
			await store.close(handle);
			return link;
		},
		take: async (token) => {
			if (!isToken(token) || await store.head(doc(token)) === 0) return undefined;
			const handle = await store.open(doc(token));
			const held = handle.root as Partial<LinkDocument>;
			// Two takes of one token in flight open the same live document, so the first to get
			// here marks it and the second reads the mark.
			const link = linkOf(held);
			if (link !== undefined && 'user' in link) {
				atomic(() => { held.taken = true; });
				await store.settled(handle);
			}
			await store.close(handle);
			return link;
		},
		sweep,
		stop: () => { clearInterval(timer); },
	};
};
