// auth/Verify: a one-time link by mail, and the name `verified` once it is clicked (design 290).

import { atomic } from '@aweftjs/core';
import type { ModuleProps } from '@aweftjs/modules';
import { type Refusal, sliding } from '@aweftjs/server';

import { type AuthContext, userOf } from '../context.ts';
import { type Links, links } from '../links.ts';
import { type Mailer, type Outcome, mailLink, textOf, urlOf } from '../mail.ts';
import { bodyOf, json, numberOf, storeOf } from '../props.ts';
import { userDoc } from '../users.ts';
import type { UserDocument } from './Enter.ts';
import type { Roles } from './Roles.ts';

export const deps = ['auth/Roles', 'notify/Send'];

export const defaults = {
	subject: 'Verify your email address',
	url: null,
	verifyMs: 86_400_000,
	sendsPerUser: 5,
	sendsWindowMs: 86_400_000,
	resendMs: 60_000,
	sweepMs: 3_600_000,
};

/** The name a verified person holds. */
export const VERIFIED = 'verified';

export type Confirmed = { readonly user: string } | { readonly refused: readonly Refusal[] };

export interface Verify {
	readonly public: true;
	/** Mail the person a link. Refuses `verified` for a person already verified, and `mail` when it did not go. */
	send(user: string): Promise<Outcome>;
	/** Take a link: `emailVerified` is written and `verified` granted. Refuses `token` for a link that is not live. */
	confirm(token: unknown): Promise<Confirmed>;
	stop(): void;
	readonly routes: Record<string, (request: Request, context: AuthContext) => Promise<Response>>;
}

const MODULE = 'auth/Verify';

export default ({ imports, config, ...props }: ModuleProps): Verify => {
	const store = storeOf(props);
	const Roles = imports.Roles as Roles;
	const mailer = imports.Send as Mailer;
	const subject = textOf(MODULE, config, 'subject');
	const url = urlOf(MODULE, config);
	const perUser = sliding({ count: numberOf(MODULE, config, 'sendsPerUser'), windowMs: numberOf(MODULE, config, 'sendsWindowMs') });
	const resend = sliding({ count: 1, windowMs: numberOf(MODULE, config, 'resendMs') });
	const held: Links = links(store, 'verify', numberOf(MODULE, config, 'verifyMs'), numberOf(MODULE, config, 'sweepMs'));

	const verified = async (user: string): Promise<boolean> => {
		if (await store.head(userDoc(user)) === 0) return false;
		const handle = await store.open(userDoc(user));
		const is = (handle.root as Partial<UserDocument>).emailVerified === true;
		await store.close(handle);
		return is;
	};

	const send = async (user: string): Promise<Outcome> => {
		if (await verified(user)) return { refused: [{ code: 'verified', message: 'this email is already verified' }] };
		const token = await held.issue(user);
		const failed = await mailLink(mailer, user, subject, 'Confirm your email address by opening this link:', url(token));
		return failed === undefined ? { ok: true } : { refused: [failed] };
	};

	const confirm = async (token: unknown): Promise<Confirmed> => {
		const user = await held.take(token);
		if (user === undefined) return { refused: [{ code: 'token', message: 'this link is not one that can be used' }] };
		const handle = await store.open(userDoc(user));
		atomic(() => {
			const root = handle.root as Partial<UserDocument>;
			root.emailVerified = true;
			root.modifiedAt = Date.now();
		});
		await store.settled(handle);
		await store.close(handle);
		await Roles.grant(user, VERIFIED);
		return { user };
	};

	const tooMany = (retryAfter: number): Response =>
		json(429, { reasons: [{ code: 'attempts', message: 'too many verification mails; wait and try again' }] }, { 'retry-after': String(retryAfter) });

	return {
		public: true,
		send,
		confirm,
		stop: () => { held.stop(); },
		routes: {
			'POST /api/verify/send': async (_request, context) => {
				const user = userOf(context);
				if (user === null) return json(401, { reasons: [{ code: 'private', message: 'sign in to verify your email' }] });
				const inWindow = perUser.take(user);
				if (!inWindow.ok) return tooMany(inWindow.retryAfter);
				const since = resend.take(user);
				if (!since.ok) return tooMany(since.retryAfter);
				const outcome = await send(user);
				if ('refused' in outcome) {
					const [reason] = outcome.refused;
					return json(reason?.code === 'mail' ? 502 : 409, { reasons: outcome.refused });
				}
				return json(200, { ok: true });
			},
			'POST /api/verify': async (request) => {
				const body = await bodyOf(request);
				const outcome = await confirm(body?.token);
				if ('refused' in outcome) return json(400, { reasons: outcome.refused });
				return json(200, outcome);
			},
		},
	};
};
