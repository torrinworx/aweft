// A one-time link: a token naming a `<prefix>:<token>` document that says who it is for and
// when it stops being valid (design 290). Verification and reset links are both this.

import { atomic } from '@aweftjs/core';
import type { Store } from '@aweftjs/store';

import { isToken, mintToken } from './token.ts';

/** What a link document holds. `user` and `expires` are paths the battery declares, so the sweep is a query. */
export interface LinkDocument extends Record<string, unknown> {
	user: string;
	expires: number;
	createdAt: number;
}

export interface Links {
	/** Mint a link for a user. Returns its token. */
	issue(user: string): Promise<string>;
	/** The user a live link is for, leaving it. Undefined for no live link of that token. */
	peek(token: unknown): Promise<string | undefined>;
	/** Take the link: the user it was for, and the document is gone. Undefined for no live link of that token. */
	take(token: unknown): Promise<string | undefined>;
	/** Remove every link past its end. Returns how many. */
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

	const liveUser = (held: Partial<LinkDocument> & { taken?: boolean }): string | undefined =>
		held.taken !== true && typeof held.user === 'string' && typeof held.expires === 'number' && held.expires > Date.now()
			? held.user
			: undefined;

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
			const user = liveUser(handle.root as Partial<LinkDocument> & { taken?: boolean });
			await store.close(handle);
			return user;
		},
		take: async (token) => {
			if (!isToken(token) || await store.head(doc(token)) === 0) return undefined;
			const handle = await store.open(doc(token));
			const held = handle.root as Partial<LinkDocument> & { taken?: boolean };
			// Two takes of one token in flight open the same live document, so the first to get
			// here marks it and the second reads the mark before anything is removed.
			const user = liveUser(held);
			if (user !== undefined) atomic(() => { held.taken = true; });
			await store.close(handle);
			await store.remove(doc(token));
			return user;
		},
		sweep,
		stop: () => { clearInterval(timer); },
	};
};
