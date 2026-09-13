// The security suite over the harness, against a session stand-in of a few dozen lines.
//
// The stand-in answers the auth routes in the shape `@aweftjs/auth` documents and nothing
// more, so this file covers the suite's own branches without this package depending on a
// battery. The real battery runs the same suite from its own tests.

import test from 'node:test';
import assert from 'node:assert/strict';

import { randomBytes } from 'node:crypto';

import { createId, idToText } from '@aweftjs/codec';
import { fromBundle } from '@aweftjs/modules';
import type { ModuleProps } from '@aweftjs/modules';
import { open, sliding } from '@aweftjs/server';
import type { Gate, Named, Peer } from '@aweftjs/server';

import { loadServer, securityChecks } from '../src/index.ts';
import type { StartTarget } from '../src/index.ts';

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const userOf = (context: unknown): string | null => {
	const user: unknown = (context as { user?: unknown } | null)?.user;
	return typeof user === 'string' ? user : null;
};

/** Sessions in memory, the cookie, the counts and the bounds: the contract, with nothing stored. */
const standIn = () => {
	const users = new Map<string, { id: string; password: string }>();
	const sessions = new Map<string, string>();
	const perEmail = sliding({ count: 5, windowMs: 900_000 });
	const perAddress = sliding({ count: 20, windowMs: 900_000 });
	let hashing = 0;
	const cookieOf = (request: Request): string | undefined =>
		request.headers.get('cookie')?.split(';').map((p) => p.trim()).find((p) => p.startsWith('session='))?.slice('session='.length);
	const setCookie = (token: string | null, request: Request): string => {
		const parts = [`session=${token ?? ''}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
		if (new URL(request.url).protocol === 'https:') parts.push('Secure');
		if (token === null) parts.push('Max-Age=0');
		return parts.join('; ');
	};
	return fromBundle({
		'./stand/Gate.ts': {
			default: (): Gate => ({
				identify: (request: Request, peer: Peer) => {
					const token = cookieOf(request);
					const user = token === undefined ? null : sessions.get(token) ?? null;
					return { context: { user, session: user === null ? null : token, address: peer.address } };
				},
				access: ({ name, instance }: Named, context: unknown) => {
					const isPublic = instance !== null && typeof instance === 'object' && (instance as { public?: unknown }).public === true;
					return isPublic || userOf(context) !== null ? [] : [{ code: 'private', message: `${name} needs a signed-in user` }];
				},
			}),
		},
		'./stand/Session.ts': {
			default: (_props: ModuleProps) => ({
				public: true,
				routes: {
					'POST /api/session': async (request: Request, context: { address?: string }) => {
						const body = (await request.json().catch(() => undefined)) as { email?: unknown; password?: unknown } | undefined;
						const email = body?.email;
						const password = body?.password;
						if (typeof email !== 'string' || !email.includes('@')) return json(400, { reasons: [{ code: 'email', message: 'email is an address' }] });
						if (typeof password !== 'string' || password === '') return json(400, { reasons: [{ code: 'password', message: 'password is text' }] });
						if (password.length < 8 || password.length > 256) return json(400, { reasons: [{ code: 'password', message: 'password is 8 to 256 characters' }] });
						const byAddress = perAddress.take(context.address ?? 'unknown');
						if (!byAddress.ok) return json(429, { reasons: [{ code: 'attempts', message: 'too many' }] }, { 'retry-after': String(byAddress.retryAfter) });
						const byEmail = perEmail.take(email);
						if (!byEmail.ok) return json(429, { reasons: [{ code: 'attempts', message: 'too many' }] }, { 'retry-after': String(byEmail.retryAfter) });
						if (hashing >= 8) return json(503, { reasons: [{ code: 'busy', message: 'busy' }] }, { 'retry-after': '1' });
						hashing += 1;
						// The stand-in's "hash": long enough for a burst to overlap.
						await new Promise((done) => setTimeout(done, 5));
						hashing -= 1;
						let held = users.get(email);
						const created = held === undefined;
						if (held === undefined) {
							held = { id: idToText(createId()), password };
							users.set(email, held);
						} else if (held.password !== password) {
							return json(401, { reasons: [{ code: 'password', message: 'the password is wrong' }] });
						}
						perEmail.clear(email);
						const token = randomBytes(16).toString('base64url');
						sessions.set(token, held.id);
						return json(created ? 201 : 200, { user: held.id, created }, { 'set-cookie': setCookie(token, request) });
					},
					'DELETE /api/session': async (request: Request, context: { session?: string | null }) => {
						if (typeof context.session === 'string') sessions.delete(context.session);
						return json(200, { user: null }, { 'set-cookie': setCookie(null, request) });
					},
				},
			}),
		},
	});
};

const start: StartTarget = (given) => loadServer({ ...given, sources: [standIn(), ...given.sources] });

for (const c of securityChecks({ gate: 'stand/Gate' })) {
	test(`${c.requirements.join(' ')}: ${c.name}`, () => c.run(start));
}

test('the suite is append-only in shape: every case is named, cites at least one requirement, and no name repeats', () => {
	const cases = securityChecks({ gate: open });
	assert.ok(cases.length >= 15);
	assert.equal(new Set(cases.map((c) => c.name)).size, cases.length);
	for (const c of cases) assert.ok(c.requirements.length > 0 && c.requirements.every((id) => /^V\d+\.\d+\.\d+$/.test(id)), c.name);
});

test('a target with no session battery fails the session cases naming that, rather than passing or hanging', async () => {
	const bare: StartTarget = (given) => loadServer(given);
	const cookies = securityChecks({ gate: open }).find((c) => c.name.startsWith('the session cookie'))!;
	await assert.rejects(cookies.run(bare), /needs a session battery/);
});

test('a target whose methods live on a prototype is called through, not spread', async () => {
	class Port {
		readonly inner: Awaited<ReturnType<typeof loadServer>>;
		constructor(inner: Awaited<ReturnType<typeof loadServer>>) { this.inner = inner; }
		fetch(path: string, init?: RequestInit) { return this.inner.fetch(path, init); }
		open(options?: { headers?: Record<string, string> | undefined; url?: string | undefined }) { return this.inner.open(options); }
		get server() { return this.inner.server; }
		stop() { return this.inner.stop(); }
	}
	const classShaped: StartTarget = async (given) => new Port(await loadServer({ ...given, sources: [standIn(), ...given.sources] }));
	const first = securityChecks({ gate: 'stand/Gate' }).find((c) => c.name.startsWith('a private module refuses'))!;
	await first.run(classShaped);
});

test('a gate given as an object is composed the same way as one given by name', async () => {
	const cases = securityChecks({ gate: open });
	const first = cases.find((c) => c.name.startsWith('a private module refuses'))!;
	// Under `open` nothing is private, so the case that expects a refusal fails on that and
	// not on the composition: the target booted and answered.
	await assert.rejects(first.run(start), /expected refused, and it answered/);
});
