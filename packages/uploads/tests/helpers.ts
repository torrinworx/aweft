// What the suites share: a store with the battery's paths, a directory in a temporary place, a
// module through the harness, a server with no port, and the bytes of the types the sniff knows.

import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { auth, paths as authPaths } from '@aweftjs/auth';
import { fromBundle } from '@aweftjs/modules';
import type { ModuleExports, Source } from '@aweftjs/modules';
import { createServer, open } from '@aweftjs/server';
import type { Gate, Listener, ListenerHandlers, Peer, Server } from '@aweftjs/server';
import { createStore, memoryDriver } from '@aweftjs/store';
import type { Store } from '@aweftjs/store';
import { loadModule } from '@aweftjs/testing';

import { directory, paths, uploads } from '../src/index.ts';
import type { Adapter } from '../src/index.ts';

export const reasonOf = (error: unknown): string => {
	const held = error as { reason?: unknown; cause?: unknown } | null;
	// The module harness wraps a factory throw as `failed` with the original as its cause.
	if (typeof held?.reason === 'string' && held.reason !== 'failed') return held.reason;
	const cause = held?.cause as { reason?: unknown } | undefined;
	return String(cause?.reason ?? held?.reason);
};

export const newStore = (declare: Readonly<Record<string, readonly string[]>> = { ...authPaths, ...paths }): Store =>
	createStore({ driver: memoryDriver(), declare });

/** A directory nothing else uses, and the way to be rid of it. */
export const tempDir = async (): Promise<{ dir: string; adapter: Adapter; gone(): Promise<void> }> => {
	const dir = await mkdtemp(join(tmpdir(), 'aweft-uploads-'));
	return { dir, adapter: directory(dir), gone: () => rm(dir, { recursive: true, force: true }) };
};

export const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

export const bytesOf = (length: number, seed = 3): Uint8Array => {
	const out = new Uint8Array(length);
	let x = seed;
	for (let i = 0; i < length; i += 1) {
		x = (x * 1103515245 + 12345) & 0x7fffffff;
		out[i] = x & 0xff;
	}
	return out;
};

/** A png's first bytes, then filler: enough to pass the sniff and be a file. */
export const png = (length = 64): Uint8Array => {
	const out = bytesOf(length, 5);
	out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
	return out;
};

export const jpeg = (length = 64): Uint8Array => {
	const out = bytesOf(length, 6);
	out.set([0xff, 0xd8, 0xff, 0xe0], 0);
	return out;
};

export const streamOf = (bytes: Uint8Array, chunk = 16): ReadableStream<Uint8Array> => {
	let at = 0;
	return new ReadableStream({
		pull: (controller) => {
			if (at >= bytes.byteLength) { controller.close(); return; }
			controller.enqueue(bytes.subarray(at, Math.min(at + chunk, bytes.byteLength)));
			at += chunk;
		},
	});
};

export const collect = async (stream: ReadableStream<Uint8Array>): Promise<Uint8Array> => {
	const chunks: Uint8Array[] = [];
	for await (const chunk of stream) chunks.push(chunk);
	const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
	let at = 0;
	for (const chunk of chunks) { out.set(chunk, at); at += chunk.byteLength; }
	return out;
};

export const request = (path = '/', init: RequestInit = {}): Request => new Request(`http://app.test${path}`, init);

/** A post of bytes as the client half sends one. */
export const post = (bytes: Uint8Array, type: string, headers: Record<string, string> = {}, length = bytes.byteLength): Request =>
	request('/api/uploads', {
		method: 'POST',
		body: streamOf(bytes),
		duplex: 'half',
		headers: { 'content-type': type, 'content-length': String(length), ...headers },
	} as RequestInit);

export const jsonRequest = (path: string, body: unknown, cookie?: string, method = 'POST'): Request =>
	request(path, {
		method, body: JSON.stringify(body),
		headers: { 'content-type': 'application/json', ...(cookie === undefined ? {} : { cookie }) },
	});

/** One module of the battery, through the harness, with real or stubbed dependencies. */
export const module = async <T>(
	name: 'Files' | 'Receive' | 'Serve', store: Store, imports: Record<string, unknown> = {}, config: Record<string, unknown> = {},
): Promise<{ instance: T; stop(): Promise<void> }> => {
	const exports = await import(`../src/modules/${name}.ts`) as ModuleExports;
	const loaded = await loadModule({ exports, imports, config, props: { store } });
	return { instance: loaded.instance as T, stop: loaded.stop };
};

// --- a server with no port ------------------------------------------------------------------

export const fakeListener = (): { listener: Listener; handlers(): ListenerHandlers } => {
	let held: ListenerHandlers | undefined;
	return {
		listener: { start: async (handlers) => { held = handlers; }, stop: async () => {} },
		handlers: () => { if (held === undefined) throw new Error('not started'); return held; },
	};
};

export const peer: Peer = { address: '127.0.0.1' };

export interface Started { store: Store; server: Server; handlers: ListenerHandlers; failed: string[] }

/**
 * A server over the battery, the auth battery when asked, and the app modules given, in the
 * source order given (`before` ahead of the battery, `after` behind it).
 */
export const started = async (
	options: {
		store?: Store; gate?: Gate | string; withAuth?: boolean;
		config?: Record<string, ModuleExports>; before?: Source[]; after?: Source[];
	} = {},
): Promise<Started> => {
	const store = options.store ?? newStore();
	const listening = fakeListener();
	const failed: string[] = [];
	const sources: Source[] = [
		fromBundle({ ...(options.config ?? {}) }),
		...(options.before ?? []),
		uploads,
		...(options.after ?? []),
		...(options.withAuth === true ? [auth] : []),
	];
	const server = createServer({
		sources, store, gate: options.gate ?? (options.withAuth === true ? 'auth/Gate' : open), listener: listening.listener,
		handlers: { failed: (name, error) => { failed.push(`${name}: ${(error as Error).message}`); } },
	});
	await server.start();
	return { store, server, handlers: listening.handlers(), failed };
};

/** Sign up over the route and answer the cookie a browser would hold. */
export const signUp = async (handlers: ListenerHandlers, email: string): Promise<{ user: string; cookie: string }> => {
	const answer = await handlers.request(jsonRequest('/api/session', { email, password: 'correct horse' }), peer);
	const { user } = await answer.json() as { user: string };
	return { user, cookie: answer.headers.getSetCookie()[0]!.split(';')[0]! };
};

/** A config module for the keeper, as an application's own file would export it. */
export const filesConfig = (config: Record<string, unknown>): Record<string, ModuleExports> =>
	({ './uploads/Files.ts': { config } as unknown as ModuleExports });
