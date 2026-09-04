// User documents: `user:<id>`, found by the declared `email` path (design 074).

import type { Store } from '@aweftjs/store';

/** One address, one spelling: trimmed and lowercased, which is what the index holds. */
export const normalEmail = (email: string): string => email.trim().toLowerCase();

/** Enough of a check to keep a string with no address in it out of the index. */
export const looksLikeEmail = (email: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

/** The document name of the user with this email, or undefined. */
export const findUser = async (store: Store, email: string): Promise<string | undefined> => {
	const hits = await store.find({ where: [{ field: 'email', op: 'eq', value: normalEmail(email) }] });
	return hits.find((hit) => hit.doc.startsWith('user:'))?.doc;
};

export const userDoc = (id: string): string => `user:${id}`;
export const idOfUserDoc = (doc: string): string => doc.slice('user:'.length);
