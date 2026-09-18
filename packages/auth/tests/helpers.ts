// What the suites share: a store with the battery's paths, the modules through the harness,
// and a connection over the harness socket for the integration cases (design 254).

import type { Listener, ListenerHandlers, Peer } from '@aweftjs/server';
import { createStore, memoryDriver } from '@aweftjs/store';
import type { Store } from '@aweftjs/store';
import { connect, fromWebSocket, requests } from '@aweftjs/sync';
import type { Link, Requests, SocketLike } from '@aweftjs/sync';
import { loadModule, settle, socketPair } from '@aweftjs/testing';
import type { PairedSocket } from '@aweftjs/testing';

import type { Fetcher } from '../src/client.ts';
import { paths } from '../src/index.ts';

export const tick = (): Promise<void> => new Promise((done) => setTimeout(done, 0));
export { settle };
export const reasonOf = (error: unknown): string => String((error as { reason?: unknown } | null)?.reason);

export const newStore = (): Store => createStore({ driver: memoryDriver(), declare: paths });

export const request = (path = '/', init: RequestInit = {}): Request => new Request(`http://app.test${path}`, init);
export const withCookie = (path: string, cookie: string, init: RequestInit = {}): Request =>
	request(path, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), cookie } });
export const jsonRequest = (path: string, method: string, body: unknown, cookie?: string): Request =>
	request(path, {
		method, body: JSON.stringify(body),
		headers: { 'content-type': 'application/json', ...(cookie === undefined ? {} : { cookie }) },
	});

/** A roles module that grants nothing to a first user, for the suites that are not about it. */
export const noRoles = { first: async () => false, may: async () => false };

/** One module of the battery, through the harness, with real or stubbed dependencies. */
export const module = async <T>(
	name: 'Gate' | 'Session' | 'Roles' | 'Enter' | 'Check' | 'State' | 'Verify' | 'Password',
	store: Store,
	imports: Record<string, unknown> = {},
	config: Record<string, unknown> = {},
): Promise<{ instance: T; stop(): Promise<void> }> => {
	const exports = await import(`../src/modules/${name}.ts`);
	// `auth/Enter` names `auth/Roles` for the one grant at sign-up; a suite about sign-in stubs it.
	const given = name === 'Enter' ? { 'auth/Roles': noRoles, ...imports } : imports;
	const loaded = await loadModule({ exports, imports: given, config, props: { store } });
	return { instance: loaded.instance as T, stop: loaded.stop };
};

// --- a connection with no port, for the integration cases -------------------------------------

export const fakeListener = (): { listener: Listener; handlers(): ListenerHandlers } => {
	let held: ListenerHandlers | undefined;
	return {
		listener: { start: async (handlers) => { held = handlers; }, stop: async () => {} },
		handlers: () => { if (held === undefined) throw new Error('not started'); return held; },
	};
};

export const peer: Peer = { address: '127.0.0.1' };

export interface Client { readonly socket: PairedSocket; readonly link: Link; readonly asks: Requests; }

export const connectTo = async (handlers: ListenerHandlers, cookie?: string): Promise<Client | Response> => {
	const answer = await handlers.socket(cookie === undefined ? request('/ws') : withCookie('/ws', cookie), peer);
	if (answer instanceof Response) return answer;
	const [near, far] = socketPair();
	answer(far);
	return { socket: near, link: connect(fromWebSocket(near)), asks: requests(near) };
};

export const asClient = (opened: Client | Response): Client => {
	if (opened instanceof Response) throw new Error(`the handshake was refused with ${opened.status}`);
	return opened;
};

// --- the two seams a page hands the client half, wired to a server with no port ----------------

/** What a page gives `createClient` and `createAuth`, with the browser's cookie jar in a variable. */
export interface Page {
	open(url: string): SocketLike;
	fetch: Fetcher;
	/** Every socket the client has made, newest last. */
	readonly sockets: PairedSocket[];
	/** What the jar holds, so a test can connect beside the page or check it was cleared. */
	cookie(): string;
}

export const page = (handlers: () => ListenerHandlers): Page => {
	const sockets: PairedSocket[] = [];
	let jar = '';
	return {
		sockets,
		cookie: () => jar,
		// The order this package's client half depends on: the far end is handed to the server
		// and answers before the near end ever fires `open`.
		open: () => {
			const [near, far] = socketPair(0);
			sockets.push(near);
			void handlers().socket(jar === '' ? request('/ws') : withCookie('/ws', jar), peer).then((answer) => {
				if (typeof answer !== 'function' || near.readyState === 3) return;
				answer(far);
				near.readyState = 1;
				near.fire('open', {});
			});
			return near;
		},
		fetch: async (url, init) => {
			const answer = await handlers().request(new Request(url, {
				method: init.method,
				headers: { ...init.headers, ...(jar === '' ? {} : { cookie: jar }) },
				...(init.body === undefined ? {} : { body: init.body }),
			}), peer);
			// Node's fetch keeps no cookie jar, and neither does this: the browser's half is a
			// variable the socket seam reads on its way out.
			const set = answer.headers.getSetCookie()[0];
			if (set !== undefined) jar = set.split(';')[0]!;
			return answer;
		},
	};
};

// --- the mailer the two mail modules name in deps, standing in for notify/Send ---------------

/** A mailer that records what it was asked to send, and answers what it is told to. */
export const mailer = () => {
	const sent: { user: string; title: string; body: string; html: string; channels: readonly string[] }[] = [];
	let answer: unknown = { ok: true };
	let fails: string | undefined;
	return {
		sent,
		answer: (next: unknown) => { answer = next; },
		fail: (why: string | undefined) => { fails = why; },
		send: async (options: { to: { user: string }; title: string; body: string; html: string; channels: readonly string[] }) => {
			if (fails !== undefined) throw new Error(fails);
			sent.push({ user: options.to.user, title: options.title, body: options.body, html: options.html, channels: options.channels });
			return { delivery: { email: answer } };
		},
	};
};

/** The `mail` refusal as a route answers it: one sentence for the person, the mailer's words in `detail`, the fix for whoever runs it (design 293). */
export const mailRefused = (detail: string): { code: string; message: string; detail: string; fix: string } => ({
	code: 'mail',
	message: 'the mail could not be sent; try again later',
	detail,
	fix: 'Check the email setting notify/Send was given; what the mailer answered is in detail.',
});

/** The token the mail carries, read back out of the link the module built from `url`. */
export const tokenIn = (body: string): string => body.slice(body.indexOf('token=') + 'token='.length);
