// What the two mail modules share: the mailer they name in `deps`, the link mail, and the
// configuration checks (design 290). `notify/Send` is the mailer; its shape is stated here
// rather than imported, so `auth` alone carries nothing of notify, and the integration suite
// loads the real one to keep the two agreeing.

import type { Refusal } from '@aweftjs/server';

import { invalidConfig } from './props.ts';

/** What one channel of a send answered, as `notify/Send` records it. */
export type MailDelivery = { readonly ok: true } | { readonly ok: false; readonly error: string } | { readonly skipped: string };

/** The part of `notify/Send` these modules call. */
export interface Mailer {
	send(options: {
		readonly to: { readonly user: string };
		readonly title: string;
		readonly body: string;
		readonly html: string;
		readonly channels: readonly ['email'];
	}): Promise<{ readonly delivery: { readonly email?: MailDelivery | undefined } }>;
}

/** The link an application's `url` makes for a token. */
export type LinkUrl = (token: string) => string;

/** What a mail route's call answers: done, or the reasons. */
export type Outcome = { readonly ok: true } | { readonly refused: readonly Refusal[] };

const escape = (text: string): string =>
	text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Non-empty text, or `invalid-config`. */
export const textOf = (module: string, config: Readonly<Record<string, unknown>>, key: string): string => {
	const held: unknown = config[key];
	if (typeof held !== 'string' || held === '') throw invalidConfig(module, `${key} ${JSON.stringify(held)}`, 'Give that setting some text.');
	return held;
};

/** The `url` function, which has no default because a battery picks no URL. */
export const urlOf = (module: string, config: Readonly<Record<string, unknown>>): LinkUrl => {
	const held: unknown = config.url;
	if (typeof held !== 'function') {
		throw invalidConfig(module, `url ${JSON.stringify(held)}`, 'Give url a function of the token answering the address of the page that takes it: (token) => `https://app.example/verify?token=${token}`.');
	}
	return held as LinkUrl;
};

/**
 * The `mail` refusal (design 293): `message` is the sentence a page shows the person, `detail`
 * is what the mailer said, and `fix` is for whoever runs it. The route answers 502 and the
 * token still stands.
 */
export interface MailRefusal extends Refusal {
	readonly detail: string;
	readonly fix: string;
}

export const mailFailed = (detail: string): MailRefusal => ({
	code: 'mail',
	message: 'the mail could not be sent; try again later',
	detail,
	fix: 'Check the email setting notify/Send was given; what the mailer answered is in detail.',
});

/**
 * Mail a person one link. Answers the refusal when it did not go, and nothing when it did.
 *
 * The body is the sentence and the address as text; the HTML is the same with the address as a
 * link, so a reader whose mail shows no HTML has the address to copy.
 */
export const mailLink = async (mailer: Mailer, user: string, subject: string, sentence: string, url: string): Promise<MailRefusal | undefined> => {
	let delivery: MailDelivery | undefined;
	try {
		({ delivery: { email: delivery } } = await mailer.send({
			to: { user },
			title: subject,
			body: `${sentence} ${url}`,
			html: `<p>${escape(sentence)}</p><p><a href="${escape(url)}">${escape(url)}</a></p>`,
			channels: ['email'],
		}));
	} catch (error) {
		return mailFailed(String((error as Error)?.message ?? error));
	}
	if (delivery === null || typeof delivery !== 'object') return mailFailed('the mailer tried no email channel');
	if ('skipped' in delivery) return mailFailed(String(delivery.skipped));
	return delivery.ok === true ? undefined : mailFailed(String((delivery as { error?: unknown }).error ?? 'the mailer gave no reason'));
};
