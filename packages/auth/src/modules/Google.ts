// auth/Google: sign in or sign up through Google, the OpenID Connect code flow with PKCE (design
// 318). Two routes: one sends the browser to Google, the other takes the answer, admits the
// address through auth/Enter and issues a session.

import { createHash } from 'node:crypto';

import type { ModuleProps } from '@aweftjs/modules';

import type { AuthContext } from '../context.ts';
import { cookiesOf } from '../cookie.ts';
import { textOf } from '../mail.ts';
import { invalidConfig } from '../props.ts';
import { mintToken } from '../token.ts';
import type { Enter } from './Enter.ts';
import type { Session } from './Session.ts';

export const deps = ['auth/Session', 'auth/Enter'];

export const defaults = { clientId: null, clientSecret: null, callback: null, fetch: null };

/** What `fetch` the module makes its one call with: the global, or a stand-in for Google. */
export type GoogleFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

export interface Google {
	readonly public: true;
	readonly routes: Record<string, (request: Request, context: AuthContext) => Promise<Response>>;
}

const MODULE = 'auth/Google';
const AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
const FLOW = 'google_flow';
const FLOW_PATH = '/api/auth/google';
const FLOW_SECONDS = 600;

// A path on this site, or `/`: `//host` and `/\host` are other hosts to a browser.
const pathOf = (value: string | null): string =>
	value !== null && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\') ? value : '/';

const flowCookie = (value: string, request: Request, seconds: number): string => {
	const parts = [`${FLOW}=${value}`, `Path=${FLOW_PATH}`, 'HttpOnly', 'SameSite=Lax', `Max-Age=${String(seconds)}`];
	if (new URL(request.url).protocol === 'https:') parts.push('Secure');
	return parts.join('; ');
};

const back = (path: string, code: string | null, cookies: readonly string[]): Response => {
	const url = new URL(path, 'http://here');
	if (code !== null) url.searchParams.set('auth', code);
	const headers = new Headers({ location: `${url.pathname}${url.search}${url.hash}` });
	for (const cookie of cookies) headers.append('set-cookie', cookie);
	return new Response(null, { status: 302, headers });
};

export default ({ imports, config }: ModuleProps): Google => {
	const Session = imports.Session as Session;
	const Enter = imports.Enter as Enter;
	const clientId = textOf(MODULE, config, 'clientId');
	const clientSecret = textOf(MODULE, config, 'clientSecret');
	const callback = textOf(MODULE, config, 'callback');
	if (!URL.canParse(callback) || !/^https?:$/.test(new URL(callback).protocol)) {
		throw invalidConfig(MODULE, `callback ${JSON.stringify(callback)}`, 'Give callback the absolute address of /api/auth/google/callback on this site, as listed in the OAuth client\'s redirect URIs.');
	}
	if (config.fetch !== null && typeof config.fetch !== 'function') {
		throw invalidConfig(MODULE, `fetch ${JSON.stringify(config.fetch)}`, 'Give fetch a function shaped like the global fetch, or null for the global.');
	}
	const call = (config.fetch ?? fetch) as GoogleFetch;

	// What Google's token endpoint answered, read as the ID token's claims, or undefined.
	const claimsOf = async (code: string, verifier: string): Promise<Record<string, unknown> | undefined> => {
		const answer = await call(TOKEN, {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: callback, grant_type: 'authorization_code', code_verifier: verifier }).toString(),
		});
		if (!answer.ok) return undefined;
		const token: unknown = ((await answer.json()) as { id_token?: unknown } | null)?.id_token;
		if (typeof token !== 'string') return undefined;
		// Straight from Google over TLS, so the signature is not checked (OpenID Connect Core 3.1.3.7).
		const claims: unknown = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'));
		return claims !== null && typeof claims === 'object' ? claims as Record<string, unknown> : undefined;
	};

	return {
		public: true,
		routes: {
			'GET /api/auth/google': async (request) => {
				const state = mintToken();
				const verifier = `${mintToken()}${mintToken()}`;
				const path = pathOf(new URL(request.url).searchParams.get('return'));
				const url = new URL(AUTHORIZE);
				url.search = new URLSearchParams({
					client_id: clientId,
					redirect_uri: callback,
					response_type: 'code',
					scope: 'openid email profile',
					state,
					code_challenge: createHash('sha256').update(verifier).digest('base64url'),
					code_challenge_method: 'S256',
					prompt: 'select_account',
				}).toString();
				const headers = new Headers({ location: url.toString() });
				headers.append('set-cookie', flowCookie(`${state}.${verifier}.${encodeURIComponent(path)}`, request, FLOW_SECONDS));
				return new Response(null, { status: 302, headers });
			},
			'GET /api/auth/google/callback': async (request, context) => {
				const query = new URL(request.url).searchParams;
				const cleared = flowCookie('', request, 0);
				const [state, verifier, held] = (cookiesOf(request, FLOW)[0] ?? '').split('.');
				// No flow cookie, or one for another start: this browser did not begin this sign-in.
				if (state === undefined || verifier === undefined || held === undefined || query.get('state') !== state) return back('/', 'google', [cleared]);
				const path = pathOf(decodeURIComponent(held));
				if (query.get('error') !== null) return back(path, 'cancelled', [cleared]);
				const code = query.get('code');
				if (code === null) return back(path, 'google', [cleared]);
				let claims: Record<string, unknown> | undefined;
				try {
					claims = await claimsOf(code, verifier);
				} catch {
					claims = undefined;
				}
				if (claims === undefined || !ISSUERS.has(String(claims.iss)) || claims.aud !== clientId
					|| typeof claims.exp !== 'number' || claims.exp * 1000 < Date.now() || typeof claims.email !== 'string') {
					return back(path, 'google', [cleared]);
				}
				if (claims.email_verified !== true) return back(path, 'unverified', [cleared]);
				const outcome = await Enter.enterConfirmed(claims.email, { name: typeof claims.name === 'string' ? claims.name : null, context });
				if ('refused' in outcome) return back(path, outcome.refused[0]?.code ?? 'google', [cleared]);
				const token = await Session.issue(outcome.user);
				return back(path, null, [cleared, Session.setCookie(token, request)]);
			},
		},
	};
};
