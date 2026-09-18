// auth/Password: change with the current password, forgot by mail, reset by the link (design 290).

import { atomic } from '@aweftjs/core';
import type { ModuleProps } from '@aweftjs/modules';
import { type Refusal, sliding } from '@aweftjs/server';

import { type AuthContext, addressOf, userOf } from '../context.ts';
import { type Links, NOT_LIVE, TAKEN, links } from '../links.ts';
import { type Mailer, type Outcome, mailLink, textOf, urlOf } from '../mail.ts';
import { hashPassword, verifyPassword } from '../password.ts';
import { bodyOf, json, numberOf, storeOf } from '../props.ts';
import { findUser, idOfUserDoc, looksLikeEmail, normalEmail, userDoc } from '../users.ts';
import type { Enter, UserDocument } from './Enter.ts';
import type { Session } from './Session.ts';

export const deps = ['auth/Session', 'auth/Enter', 'notify/Send'];

export const defaults = {
	subject: 'Reset your password',
	url: null,
	resetMs: 3_600_000,
	attemptsPerUser: 5,
	attemptsWindowMs: 900_000,
	forgotPerEmail: 5,
	forgotPerAddress: 20,
	forgotWindowMs: 86_400_000,
	sweepMs: 3_600_000,
};

export type Reset = { readonly user: string } | { readonly refused: readonly Refusal[] };

export interface Password {
	readonly public: true;
	/** Set a new password for a person who gave the current one. Every other session of theirs is ended. */
	change(user: string, current: unknown, password: unknown, keep?: string): Promise<Outcome>;
	/** Mail the person with this address a link, or nothing for an address nobody has; `ok` either way. */
	forgot(email: string): Promise<Outcome>;
	/** Take a link and set the password. Every session of the person is ended. Refuses `taken` for a link already used and `token` for one that never was or is past its end. */
	reset(token: unknown, password: unknown): Promise<Reset>;
	stop(): void;
	readonly routes: Record<string, (request: Request, context: AuthContext) => Promise<Response>>;
}

const MODULE = 'auth/Password';

const WRONG: Refusal = { code: 'password', message: 'the current password is wrong' };

export default ({ imports, config, ...props }: ModuleProps): Password => {
	const store = storeOf(props);
	const Session = imports.Session as Session;
	const Enter = imports.Enter as Enter;
	const mailer = imports.Send as Mailer;
	const subject = textOf(MODULE, config, 'subject');
	const url = urlOf(MODULE, config);
	const attempts = sliding({ count: numberOf(MODULE, config, 'attemptsPerUser'), windowMs: numberOf(MODULE, config, 'attemptsWindowMs') });
	const forgotWindowMs = numberOf(MODULE, config, 'forgotWindowMs');
	const perEmail = sliding({ count: numberOf(MODULE, config, 'forgotPerEmail'), windowMs: forgotWindowMs });
	const perAddress = sliding({ count: numberOf(MODULE, config, 'forgotPerAddress'), windowMs: forgotWindowMs });
	const held: Links = links(store, 'reset', numberOf(MODULE, config, 'resetMs'), numberOf(MODULE, config, 'sweepMs'));

	const rewrite = async (user: string, password: string): Promise<void> => {
		const hash = await hashPassword(password);
		const handle = await store.open(userDoc(user));
		atomic(() => {
			const root = handle.root as Partial<UserDocument>;
			root.password = hash;
			root.modifiedAt = Date.now();
		});
		await store.settled(handle);
		await store.close(handle);
	};

	const change = async (user: string, current: unknown, password: unknown, keep?: string): Promise<Outcome> => {
		if (await store.head(userDoc(user)) === 0) return { refused: [WRONG] };
		const handle = await store.open(userDoc(user));
		const ok = typeof current === 'string' && await verifyPassword(current, (handle.root as Partial<UserDocument>).password);
		await store.close(handle);
		if (!ok) return { refused: [WRONG] };
		const refused = await Enter.checkPassword(password);
		if (refused.length > 0) return { refused };
		await rewrite(user, password as string);
		await Session.revokeAll(user, keep);
		return { ok: true };
	};

	const forgot = async (email: string): Promise<Outcome> => {
		const found = await findUser(store, email);
		if (found === undefined) return { ok: true };
		const user = idOfUserDoc(found);
		const token = await held.issue(user);
		const failed = await mailLink(mailer, user, subject, 'Set a new password by opening this link:', url(token));
		return failed === undefined ? { ok: true } : { refused: [failed] };
	};

	// The link is looked at before the password is checked, so a stranger's guess at a token
	// costs no `refusePassword` lookup, and taken after, so a refused password burns no link.
	const reset = async (token: unknown, password: unknown): Promise<Reset> => {
		const seen = await held.peek(token);
		if (seen === undefined || 'taken' in seen) return { refused: [seen === undefined ? NOT_LIVE : TAKEN] };
		const refused = await Enter.checkPassword(password);
		if (refused.length > 0) return { refused };
		const link = await held.take(token);
		if (link === undefined || 'taken' in link) return { refused: [link === undefined ? NOT_LIVE : TAKEN] };
		const { user } = link;
		await rewrite(user, password as string);
		await Session.revokeAll(user);
		return { user };
	};

	const tooMany = (retryAfter: number): Response =>
		json(429, { reasons: [{ code: 'attempts', message: 'too many attempts; wait and try again' }] }, { 'retry-after': String(retryAfter) });

	return {
		public: true,
		change,
		forgot,
		reset,
		stop: () => { held.stop(); },
		routes: {
			'POST /api/password': async (request, context) => {
				const user = userOf(context);
				if (user === null) return json(401, { reasons: [{ code: 'private', message: 'sign in to change your password' }] });
				// The current password is a password being guessed, so it is counted like a sign-in.
				const taken = attempts.take(user);
				if (!taken.ok) return tooMany(taken.retryAfter);
				const body = await bodyOf(request);
				const outcome = await change(user, body?.current, body?.password, context.session ?? undefined);
				if ('refused' in outcome) return json(outcome.refused[0] === WRONG ? 401 : 400, { reasons: outcome.refused });
				attempts.clear(user);
				return json(200, outcome);
			},
			'POST /api/password/forgot': async (request, context) => {
				const body = await bodyOf(request);
				const email = body?.email;
				if (typeof email !== 'string' || !looksLikeEmail(normalEmail(email))) {
					return json(400, { reasons: [{ code: 'email', message: 'email is an address' }] });
				}
				// Counted before the lookup, because the send is what a stranger must not steer.
				const byAddress = perAddress.take(addressOf(context) ?? 'unknown');
				if (!byAddress.ok) return tooMany(byAddress.retryAfter);
				const byEmail = perEmail.take(normalEmail(email));
				if (!byEmail.ok) return tooMany(byEmail.retryAfter);
				const outcome = await forgot(email);
				if ('refused' in outcome) return json(502, { reasons: outcome.refused });
				return json(200, outcome);
			},
			'POST /api/password/reset': async (request) => {
				const body = await bodyOf(request);
				const outcome = await reset(body?.token, body?.password);
				if ('refused' in outcome) return json(400, { reasons: outcome.refused });
				return json(200, outcome);
			},
		},
	};
};
