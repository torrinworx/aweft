// The email adapter: one POST to Resend's send endpoint with a bearer key (design 268). No
// dependency: the API is one request, and a server that holds a key should carry as little
// code beside it as possible.

import type { Delivery } from './item.ts';

/** What the email channel hands a sender. */
export interface Mail {
	readonly to: string;
	readonly subject: string;
	readonly text: string;
	readonly html: string;
	readonly replyTo?: string | undefined;
}

/** A sender: the built-in Resend one, or the application's own function in the configuration. */
export type Sender = (mail: Mail) => Promise<Delivery>;

export interface ResendSettings {
	readonly key: string;
	readonly from: string;
	/** The send endpoint; a test points it at a server on localhost. */
	readonly endpoint?: string | undefined;
}

export const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/** What a failed request says: Resend's own message when the body carries one, the status otherwise. */
const describe = (status: number, body: unknown): string => {
	const held = body as { message?: unknown; name?: unknown } | null;
	const detail = typeof held?.message === 'string' ? held.message : typeof held?.name === 'string' ? held.name : '';
	return detail === '' ? `resend answered ${String(status)}` : `resend answered ${String(status)}: ${detail}`;
};

/** The reason a `fetch` failed, with a timeout named as one rather than by its DOMException text. */
export const failureOf = (error: unknown, what: string, timeoutMs: number): string => {
	const held = error as { name?: unknown; message?: unknown } | null;
	if (held?.name === 'TimeoutError') return `${what} timed out after ${String(timeoutMs)} ms`;
	return typeof held?.message === 'string' ? held.message : String(error);
};

/**
 * A sender over Resend. Never throws: a broker that dies on one channel has failed at the one
 * job it has, and the record is where the failure goes.
 */
export const resend = (settings: ResendSettings, timeoutMs: number): Sender => async (mail) => {
	try {
		const answer = await fetch(settings.endpoint ?? RESEND_ENDPOINT, {
			method: 'POST',
			headers: { authorization: `Bearer ${settings.key}`, 'content-type': 'application/json' },
			body: JSON.stringify({
				from: settings.from,
				to: mail.to,
				subject: mail.subject,
				text: mail.text,
				html: mail.html,
				...(mail.replyTo === undefined ? {} : { reply_to: mail.replyTo }),
			}),
			signal: AbortSignal.timeout(timeoutMs),
		});
		const body: unknown = await answer.json().catch(() => null);
		if (!answer.ok) return { ok: false, error: describe(answer.status, body) };
		const id: unknown = (body as { id?: unknown } | null)?.id;
		return { ok: true, id: typeof id === 'string' ? id : null };
	} catch (error) {
		return { ok: false, error: failureOf(error, 'resend', timeoutMs) };
	}
};
