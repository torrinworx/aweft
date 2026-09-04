// auth/Enter: sign in, or sign up when the email is new, and hand the browser its cookie
// (design 074).

import { createId, idToText } from '@aweftjs/codec';
import { atomic } from '@aweftjs/core';
import type { ModuleProps } from '@aweftjs/modules';
import type { Refusal } from '@aweftjs/server';

import type { AuthContext } from '../context.ts';
import { hashPassword, verifyPassword } from '../password.ts';
import { bodyOf, json, storeOf } from '../props.ts';
import { findUser, idOfUserDoc, looksLikeEmail, normalEmail, userDoc } from '../users.ts';
import type { Session } from './Session.ts';

export const deps = ['auth/Session'];

/** What a `user:<id>` document holds. `password` is the hash, never the password. */
export interface UserDocument extends Record<string, unknown> {
	email: string;
	name: string | null;
	password: string;
	emailVerified: boolean;
	createdAt: number;
	modifiedAt: number;
}

export type Entered = { readonly user: string; readonly created: boolean } | { readonly refused: readonly Refusal[] };

export interface Enter {
	readonly public: true;
	/** Sign in, or sign up when nobody has the email. Refuses a wrong password. */
	enter(email: string, password: string): Promise<Entered>;
	readonly routes: Record<string, (request: Request, context: AuthContext) => Promise<Response>>;
}

export default ({ imports, ...props }: ModuleProps): Enter => {
	const store = storeOf(props);
	const Session = imports.Session as Session;

	const enter = async (email: string, password: string): Promise<Entered> => {
		const found = await findUser(store, email);
		if (found === undefined) {
			const id = idToText(createId());
			const hash = await hashPassword(password);
			const handle = await store.open(userDoc(id));
			const now = Date.now();
			atomic(() => {
				Object.assign(handle.root, {
					email: normalEmail(email), name: null, password: hash, emailVerified: false, createdAt: now, modifiedAt: now,
				} satisfies UserDocument);
			});
			await store.settled(handle);
			await store.close(handle);
			return { user: id, created: true };
		}
		const handle = await store.open(found);
		const ok = await verifyPassword(password, (handle.root as UserDocument).password);
		await store.close(handle);
		if (!ok) return { refused: [{ code: 'password', message: 'the password is wrong' }] };
		return { user: idOfUserDoc(found), created: false };
	};

	return {
		public: true,
		enter,
		routes: {
			'POST /api/session': async (request) => {
				const body = await bodyOf(request);
				const email = body?.email;
				const password = body?.password;
				if (typeof email !== 'string' || !looksLikeEmail(normalEmail(email))) {
					return json(400, { reasons: [{ code: 'email', message: 'email is an address' }] });
				}
				if (typeof password !== 'string' || password === '') {
					return json(400, { reasons: [{ code: 'password', message: 'password is text' }] });
				}
				const outcome = await enter(email, password);
				if ('refused' in outcome) return json(401, { reasons: outcome.refused });
				const token = await Session.issue(outcome.user);
				return json(outcome.created ? 201 : 200, { user: outcome.user, created: outcome.created }, {
					'set-cookie': Session.setCookie(token, request),
				});
			},
		},
	};
};
