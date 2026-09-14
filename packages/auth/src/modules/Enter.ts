// auth/Enter: sign in, or sign up when the email is new, and hand the browser its cookie
// (design 074). The route counts attempts, bounds the hashing in flight and the password's
// length before anything is hashed (design 275).

import { createId, idToText } from '@aweftjs/codec';
import { atomic } from '@aweftjs/core';
import type { ModuleProps } from '@aweftjs/modules';
import { type Refusal, sliding } from '@aweftjs/server';

import { type AuthContext, addressOf } from '../context.ts';
import { hashPassword, verifyPassword } from '../password.ts';
import { bodyOf, invalidConfig, json, numberOf, storeOf } from '../props.ts';
import { findUser, idOfUserDoc, looksLikeEmail, normalEmail, userDoc } from '../users.ts';
import type { Roles } from './Roles.ts';
import type { Session } from './Session.ts';

export const deps = ['auth/Session', 'auth/Roles'];

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
	/**
	 * The reasons a password is refused: not text, outside the configured length, or refused by
	 * `refusePassword`. Empty when it is taken. What the sign-in route checks, for a route that
	 * sets a password elsewhere (design 290).
	 */
	checkPassword(password: unknown): Promise<readonly Refusal[]>;
	readonly routes: Record<string, (request: Request, context: AuthContext) => Promise<Response>>;
}

const MODULE = 'auth/Enter';
const refuse = (detail: string, fix: string): Error => invalidConfig(MODULE, detail, fix);

export default ({ imports, config, ...props }: ModuleProps): Enter => {
	const store = storeOf(props);
	const Session = imports.Session as Session;
	const Roles = imports.Roles as Roles;
	const windowMs = numberOf(MODULE, config, 'attemptsWindowMs');
	const perEmail = sliding({ count: numberOf(MODULE, config, 'attemptsPerEmail'), windowMs });
	const perAddress = sliding({ count: numberOf(MODULE, config, 'attemptsPerAddress'), windowMs });
	const hashesInFlight = numberOf(MODULE, config, 'hashesInFlight');
	const passwordMin = numberOf(MODULE, config, 'passwordMin');
	const passwordMax = numberOf(MODULE, config, 'passwordMax');
	if (passwordMax < passwordMin) throw refuse(`passwordMax ${String(passwordMax)} under passwordMin ${String(passwordMin)}`, 'Give passwordMax at least passwordMin.');
	if (config.refusePassword !== null && typeof config.refusePassword !== 'function') {
		throw refuse(`refusePassword ${JSON.stringify(config.refusePassword)}`, 'Give refusePassword a function of the password answering true to refuse it, or null.');
	}
	const refusePassword = config.refusePassword as ((password: string) => boolean | Promise<boolean>) | null;
	let hashing = 0;

	// The two checks that cost nothing, before anything is counted or hashed.
	const shapeOf = (password: unknown): Refusal | undefined => {
		if (typeof password !== 'string' || password === '') return { code: 'password', message: 'password is text' };
		const length = [...password].length;
		if (length < passwordMin || length > passwordMax) {
			return { code: 'password', message: `password is ${String(passwordMin)} to ${String(passwordMax)} characters` };
		}
		return undefined;
	};

	const notAllowed = (): Refusal => ({ code: 'password', message: 'that password is not allowed here' });

	const checkPassword = async (password: unknown): Promise<readonly Refusal[]> => {
		const shape = shapeOf(password);
		if (shape !== undefined) return [shape];
		return refusePassword !== null && await refusePassword(password as string) ? [notAllowed()] : [];
	};

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
			await Roles.first(id);
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
		checkPassword,
		routes: {
			'POST /api/session': async (request, context) => {
				const body = await bodyOf(request);
				const email = body?.email;
				const password = body?.password;
				if (typeof email !== 'string' || !looksLikeEmail(normalEmail(email))) {
					return json(400, { reasons: [{ code: 'email', message: 'email is an address' }] });
				}
				const shape = shapeOf(password);
				if (shape !== undefined) return json(400, { reasons: [shape] });
				// Counted before anything is hashed, so a flood buys no hashing. The email's count
				// is cleared on success below; the address's is not, since it counts requests.
				const key = normalEmail(email);
				const byAddress = perAddress.take(addressOf(context) ?? 'unknown');
				if (!byAddress.ok) return tooMany(byAddress.retryAfter);
				const byEmail = perEmail.take(key);
				if (!byEmail.ok) return tooMany(byEmail.retryAfter);
				if (refusePassword !== null && await refusePassword(password as string)) return json(400, { reasons: [notAllowed()] });
				if (hashing >= hashesInFlight) {
					return json(503, { reasons: [{ code: 'busy', message: 'too many sign-ins are being checked; try again in a moment' }] }, { 'retry-after': '1' });
				}
				hashing += 1;
				let outcome: Entered;
				try {
					outcome = await enter(email, password as string);
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
