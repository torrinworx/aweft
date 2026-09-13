// The push adapter: Firebase Cloud Messaging's HTTP v1 API with no dependency (design 268). A
// JWT signed with the service account's key buys an access token, cached until shortly before
// it expires, and one POST per device carries a data-only message the application's own service
// on the device draws. `message.notification` is never sent: that is drawn by the system with
// the text passed through the push service, and this adapter sends the text only when told to.

import { createPrivateKey, createSign } from 'node:crypto';

import type { Delivery } from './item.ts';
import { failureOf } from './resend.ts';

/** The fields of a service account key file this adapter reads. */
export interface ServiceAccount {
	readonly client_email: string;
	readonly private_key: string;
	readonly project_id: string;
}

/** What one push carries, every value a string because the service refuses anything else. */
export type PushData = Readonly<Record<string, string>>;

/** What the push channel hands a pusher: the data, and the endpoint of each device. */
export type Pusher = (data: PushData, endpoints: readonly string[]) => Promise<PushOutcome[]>;

/** One device's answer. `stale` says the endpoint is dead and should be forgotten. */
export type PushOutcome = Delivery & { readonly stale?: boolean };

export interface FcmSettings {
	/** The service account key file, as JSON or as base64 of it, on one line. */
	readonly account: string;
	/** The send endpoint with `{project}` in it, and the token endpoint; a test points both at localhost. */
	readonly endpoint?: string | undefined;
	readonly tokenUrl?: string | undefined;
}

export const FCM_ENDPOINT = 'https://fcm.googleapis.com/v1/projects/{project}/messages:send';
export const FCM_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

// A value that went through an environment file may have had its backslashes eaten, which
// turns the `\n` inside the PEM into the letter n and leaves JSON that parses and a key that
// does not load. Base64 has no backslashes, so both spellings are taken.
const decode = (raw: string): string => {
	const text = raw.trim();
	return text.startsWith('{') ? text : Buffer.from(text, 'base64').toString('utf8');
};

/**
 * The service account, parsed and its key loaded, so a value that cannot sign fails here with
 * a message naming the setting rather than deep inside a send.
 *
 * Throws: an `Error` whose message says what is wrong with the value.
 */
export const parseAccount = (raw: string): ServiceAccount => {
	let account: Partial<ServiceAccount>;
	try {
		account = JSON.parse(decode(raw)) as Partial<ServiceAccount>;
	} catch {
		throw new Error('the push account is not valid JSON; give the whole service account key file on one line, as JSON or base64');
	}
	for (const field of ['client_email', 'private_key', 'project_id'] as const) {
		if (typeof account[field] !== 'string' || account[field] === '') {
			throw new Error(`the push account is missing ${field}; give the key file downloaded from the Firebase console`);
		}
	}
	try {
		createPrivateKey(account.private_key!);
	} catch {
		throw new Error('the push account\'s private_key does not load; if the value went through a parser that eats backslashes, give it as base64 instead');
	}
	return account as ServiceAccount;
};

const b64url = (text: string): string => Buffer.from(text).toString('base64url');

interface Token { readonly value: string; readonly expiresAt: number }

const tokens = new Map<string, Token>();

const mint = async (account: ServiceAccount, tokenUrl: string, timeoutMs: number): Promise<Token> => {
	const now = Math.floor(Date.now() / 1000);
	const claims = { iss: account.client_email, scope: SCOPE, aud: tokenUrl, iat: now, exp: now + 3600 };
	const signing = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify(claims))}`;
	const signer = createSign('RSA-SHA256');
	signer.update(signing);
	const assertion = `${signing}.${signer.sign(account.private_key, 'base64url')}`;
	const answer = await fetch(tokenUrl, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
		signal: AbortSignal.timeout(timeoutMs),
	});
	const body = (await answer.json().catch(() => null)) as { access_token?: unknown; expires_in?: unknown; error?: unknown; error_description?: unknown } | null;
	if (!answer.ok || typeof body?.access_token !== 'string') {
		const detail = typeof body?.error_description === 'string' ? body.error_description : typeof body?.error === 'string' ? body.error : 'no detail';
		throw new Error(`the token exchange answered ${String(answer.status)}: ${detail}`);
	}
	const seconds = typeof body.expires_in === 'number' ? body.expires_in : 3600;
	return { value: body.access_token, expiresAt: Date.now() + seconds * 1000 - REFRESH_MARGIN_MS };
};

const accessToken = async (account: ServiceAccount, tokenUrl: string, timeoutMs: number): Promise<string> => {
	const key = `${tokenUrl} ${account.client_email}`;
	const cached = tokens.get(key);
	if (cached !== undefined && cached.expiresAt > Date.now()) return cached.value;
	const minted = await mint(account, tokenUrl, timeoutMs);
	tokens.set(key, minted);
	return minted.value;
};

/** Forget every cached token, so a test can count exchanges from zero. */
export const forgetTokens = (): void => { tokens.clear(); };

// The service answers a token that belongs to no installed app with UNREGISTERED and one from
// another project with SENDER_ID_MISMATCH; both mean the device will never deliver again.
// INVALID_ARGUMENT is not among them: the service answers it for a message too large as well
// as for a malformed token, and a device must not be forgotten for a body's size.
const STALE = new Set(['UNREGISTERED', 'SENDER_ID_MISMATCH', 'NOT_FOUND']);

const codeOf = (body: unknown): string | null => {
	const error = (body as { error?: { details?: unknown; status?: unknown } } | null)?.error;
	const details = Array.isArray(error?.details) ? error.details as { '@type'?: unknown; errorCode?: unknown }[] : [];
	const fcm = details.find((d) => typeof d['@type'] === 'string' && d['@type'].endsWith('FcmError'));
	if (typeof fcm?.errorCode === 'string') return fcm.errorCode;
	return typeof error?.status === 'string' ? error.status : null;
};

/**
 * A pusher over FCM. Never throws: every device's answer is one entry, `ok` or not, and the
 * ones the service calls dead carry `stale`.
 */
export const fcm = (settings: FcmSettings, timeoutMs: number): Pusher => async (data, endpoints) => {
	let account: ServiceAccount;
	try {
		account = parseAccount(settings.account);
	} catch (error) {
		return endpoints.map(() => ({ ok: false, error: (error as Error).message }));
	}
	const tokenUrl = settings.tokenUrl ?? FCM_TOKEN_URL;
	const endpoint = (settings.endpoint ?? FCM_ENDPOINT).replace('{project}', encodeURIComponent(account.project_id));
	const outcomes: PushOutcome[] = [];
	for (const token of endpoints) {
		try {
			const access = await accessToken(account, tokenUrl, timeoutMs);
			const answer = await fetch(endpoint, {
				method: 'POST',
				headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json' },
				body: JSON.stringify({ message: { token, data, android: { priority: 'HIGH' } } }),
				signal: AbortSignal.timeout(timeoutMs),
			});
			const body: unknown = await answer.json().catch(() => null);
			if (!answer.ok) {
				const code = codeOf(body);
				const message: unknown = (body as { error?: { message?: unknown } } | null)?.error?.message;
				outcomes.push({
					ok: false,
					error: `fcm answered ${String(answer.status)}${code === null ? '' : ` ${code}`}: ${typeof message === 'string' ? message : 'no detail'}`,
					stale: answer.status === 404 || (code !== null && STALE.has(code)),
				});
				continue;
			}
			const name: unknown = (body as { name?: unknown } | null)?.name;
			outcomes.push({ ok: true, name: typeof name === 'string' ? name : null });
		} catch (error) {
			outcomes.push({ ok: false, error: failureOf(error, 'fcm', timeoutMs) });
		}
	}
	return outcomes;
};
