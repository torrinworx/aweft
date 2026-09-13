// auth/Enter: sign in, or sign up when the email is new, and hand the browser its cookie
// (design 074). The route counts attempts, bounds the hashing in flight and the password's
// length before anything is hashed (design 275).

import { codecError, createId, idToText } from '@aweftjs/codec';
import { atomic } from '@aweftjs/core';
import type { ModuleProps } from '@aweftjs/modules';
import { type Refusal, sliding } from '@aweftjs/server';

import { type AuthContext, addressOf } from '../context.ts';
import { hashPassword, verifyPassword } from '../password.ts';
import { bodyOf, json, storeOf } from '../props.ts';
import { findUser, idOfUserDoc, looksLikeEmail, normalEmail, userDoc } from '../users.ts';
import type { Session } from './Session.ts';

export const deps = ['auth/Session'];

export const defaults = {
	attemptsPerEmail: 5,
	attemptsPerAddress: 20,
	attemptsWindowMs: 900_000,
	hashesInFlight: 8,
	passwordMin: 8,
	passwordMax: 256,
	refusePassword: null,
};

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

const refuse = (detail: string, fix: string): Error => codecError('invalid-config', `auth/Enter was given ${detail}`, fix);

const numberOf = (config: Readonly<Record<string, unknown>>, key: keyof typeof defaults): number => {
	const held: unknown = config[key];
	if (typeof held !== 'number' || !(held > 0) || !Number.isFinite(held)) throw refuse(`${key} ${JSON.stringify(held)}`, 'Give that setting a number above zero.');
	return held;
};

export default ({ imports, config, ...props }: ModuleProps): Enter => {
	const store = storeOf(props);
	const Session = imports.Session as Session;
	const windowMs = numberOf(config, 'attemptsWindowMs');
	const perEmail = sliding({ count: numberOf(config, 'attemptsPerEmail'), windowMs });
	const perAddress = sliding({ count: numberOf(config, 'attemptsPerAddress'), windowMs });
	const hashesInFlight = numberOf(config, 'hashesInFlight');
	const passwordMin = numberOf(config, 'passwordMin');
	const passwordMax = numberOf(config, 'passwordMax');
	if (passwordMax < passwordMin) throw refuse(`passwordMax ${String(passwordMax)} under passwordMin ${String(passwordMin)}`, 'Give passwordMax at least passwordMin.');
	if (config.refusePassword !== null && typeof config.refusePassword !== 'function') {
		throw refuse(`refusePassword ${JSON.stringify(config.refusePassword)}`, 'Give refusePassword a function of the password answering true to refuse it, or null.');
	}
	const refusePassword = config.refusePassword as ((password: string) => boolean | Promise<boolean>) | null;
	let hashing = 0;

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

	const tooMany = (retryAfter: number): Response =>
		json(429, { reasons: [{ code: 'attempts', message: 'too many sign-in attempts; wait and try again' }] }, { 'retry-after': String(retryAfter) });

	return {
		public: true,
		enter,
		routes: {
			'POST /api/session': async (request, context) => {
				const body = await bodyOf(request);
				const email = body?.email;
				const password = body?.password;
				if (typeof email !== 'string' || !looksLikeEmail(normalEmail(email))) {
					return json(400, { reasons: [{ code: 'email', message: 'email is an address' }] });
				}
				if (typeof password !== 'string' || password === '') {
					return json(400, { reasons: [{ code: 'password', message: 'password is text' }] });
				}
				const length = [...password].length;
				if (length < passwordMin || length > passwordMax) {
					return json(400, { reasons: [{ code: 'password', message: `password is ${String(passwordMin)} to ${String(passwordMax)} characters` }] });
				}
				// Counted before anything is hashed, so a flood buys no hashing. The email's count
				// is cleared on success below; the address's is not, since it counts requests.
				const key = normalEmail(email);
				const byAddress = perAddress.take(addressOf(context) ?? 'unknown');
				if (!byAddress.ok) return tooMany(byAddress.retryAfter);
				const byEmail = perEmail.take(key);
				if (!byEmail.ok) return tooMany(byEmail.retryAfter);
				if (refusePassword !== null && await refusePassword(password)) {
					return json(400, { reasons: [{ code: 'password', message: 'that password is not allowed here' }] });
				}
				if (hashing >= hashesInFlight) {
					return json(503, { reasons: [{ code: 'busy', message: 'too many sign-ins are being checked; try again in a moment' }] }, { 'retry-after': '1' });
				}
				hashing += 1;
				let outcome: Entered;
				try {
					outcome = await enter(email, password);
				} finally {
					hashing -= 1;
				}
				if ('refused' in outcome) return json(401, { reasons: outcome.refused });
				perEmail.clear(key);
				const token = await Session.issue(outcome.user);
				return json(outcome.created ? 201 : 200, { user: outcome.user, created: outcome.created }, {
					'set-cookie': Session.setCookie(token, request),
				});
			},
		},
	};
};
