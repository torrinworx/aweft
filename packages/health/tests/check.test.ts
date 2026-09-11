// health/Check over a real server on a real port: the answer, what the store makes of it, what
// a check may and may not do, and what the gate makes of it (design 258).

import test from 'node:test';
import assert from 'node:assert/strict';

import { auth, paths } from '@aweftjs/auth';
import { fromBundle } from '@aweftjs/modules';
import { createServer, open } from '@aweftjs/server';
import type { Listener, ListenerHandlers } from '@aweftjs/server';
import { node } from '@aweftjs/server/node';
import { createStore, memoryDriver } from '@aweftjs/store';
import type { Driver, Store } from '@aweftjs/store';

import { health } from '../src/index.ts';

interface Booted {
	/** The origin the listener took, port and all. */
	readonly url: string;
	stop(): Promise<void>;
}

interface Options {
	/** The store handed to the server, or none. */
	readonly store?: Store;
	/** Load the auth battery and name its gate, instead of `open`. */
	readonly gated?: boolean;
}

/**
 * A server with the battery in it, configured through a same-named entry in a source of the
 * test's own, listed first the way an application's own directory is.
 */
const boot = async (config: Record<string, unknown>, options: Options = {}): Promise<Booted> => {
	const listener = node({ port: 0, host: '127.0.0.1' });
	const own = fromBundle({ './health/Check.ts': { config } });
	const server = createServer({
		sources: options.gated === true ? [own, health, auth] : [own, health],
		...(options.store === undefined ? {} : { store: options.store }),
		gate: options.gated === true ? 'auth/Gate' : open,
		listener,
	});
	await server.start();
	return {
		url: `http://127.0.0.1:${String(listener.port)}`,
		stop: () => server.stop(),
	};
};

/** A memory driver whose `head` throws with a message that must never reach a body. */
const SECRET = 'postgres://app:hunter2@db.internal/app';
const failingDriver = (asked: string[] = []): Driver => {
	const inner = memoryDriver();
	return { ...inner, head: async (doc) => { asked.push(doc); throw new Error(`connect ECONNREFUSED ${SECRET}`); } };
};

// The headers this module wrote. Node's own are left out: it closes the socket after a HEAD
// and keeps it after a GET, and the clock moves between two requests.
const TRANSPORT = new Set(['connection', 'keep-alive', 'date']);

const headersOf = (answer: Response): Record<string, string> => {
	const held: Record<string, string> = {};
	answer.headers.forEach((value, name) => { if (!TRANSPORT.has(name)) held[name] = value; });
	return held;
};

const reasonOf = (error: unknown): string => String((error as { reason?: unknown }).reason);
const causeOf = (error: unknown): string => reasonOf((error as { cause?: unknown }).cause);

const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;

// --- the answer -----------------------------------------------------------------------------

test('with no store, the answer is 200, ok, the five keys, and nothing a cache may keep', async () => {
	const it = await boot({});
	try {
		const before = Date.now();
		const answer = await fetch(`${it.url}/api/health`);
		assert.equal(answer.status, 200);
		assert.equal(answer.headers.get('content-type'), 'application/json');
		assert.equal(answer.headers.get('cache-control'), 'no-store');
		const text = await answer.text();
		assert.equal(answer.headers.get('content-length'), String(Buffer.byteLength(text)), 'the length is the body\'s');
		const body = JSON.parse(text) as Record<string, unknown>;
		assert.deepEqual(Object.keys(body), ['ok', 'time', 'started', 'info', 'checks']);
		assert.equal(body.ok, true);
		assert.match(String(body.time), ISO);
		assert.match(String(body.started), ISO);
		assert.ok(Date.parse(String(body.time)) >= before - 1000, 'time is when the answer was made');
		assert.ok(Date.parse(String(body.started)) <= Date.parse(String(body.time)), 'the process began before it answered');
		assert.deepEqual(body.info, {}, 'info is empty until configured');
		assert.deepEqual(body.checks, {}, 'and so are the checks');
	} finally {
		await it.stop();
	}
});

test('started is the process start, not the module\'s, so two polls agree on it', async () => {
	// The module is made well after the process began, so a module that answered its own start
	// would be off by at least this wait.
	await new Promise((done) => setTimeout(done, 150));
	const it = await boot({});
	try {
		const first = await (await fetch(`${it.url}/api/health`)).json() as { started: string };
		const second = await (await fetch(`${it.url}/api/health`)).json() as { started: string };
		assert.equal(first.started, second.started);
		const processStart = Date.now() - process.uptime() * 1000;
		const off = Math.abs(Date.parse(first.started) - processStart);
		assert.ok(off < 100, `${String(off)}ms from the process start`);
	} finally {
		await it.stop();
	}
});

test('info is written into every answer as it was configured', async () => {
	const it = await boot({ info: { build: 'abc123', region: 'eu', nested: { a: [1, 2] } } });
	try {
		const body = await (await fetch(`${it.url}/api/health`)).json() as { info: unknown };
		assert.deepEqual(body.info, { build: 'abc123', region: 'eu', nested: { a: [1, 2] } });
	} finally {
		await it.stop();
	}
});

// --- the store ------------------------------------------------------------------------------

test('a store that answers is 200 and ok, and the probe writes nothing', async () => {
	const store = createStore({ driver: memoryDriver() });
	const it = await boot({}, { store });
	try {
		const body = await (await fetch(`${it.url}/api/health`)).json() as { ok: boolean };
		assert.equal(body.ok, true);
		assert.deepEqual(await store.scan(10), [], 'no document was made by asking');
	} finally {
		await it.stop();
		await store.stop();
	}
});

test('a store that throws is 503, not ok, and nothing of the error reaches the body', async () => {
	const asked: string[] = [];
	const store = createStore({ driver: failingDriver(asked) });
	const it = await boot({ info: { build: 'abc123' } }, { store });
	try {
		const answer = await fetch(`${it.url}/api/health`);
		assert.equal(answer.status, 503);
		assert.deepEqual(asked, ['health'], 'the probe is one head of the document the README names');
		assert.equal(answer.headers.get('cache-control'), 'no-store');
		const text = await answer.text();
		assert.ok(!text.includes('hunter2') && !text.includes('ECONNREFUSED'), `the body carries no error text: ${text}`);
		const body = JSON.parse(text) as Record<string, unknown>;
		assert.equal(body.ok, false);
		assert.deepEqual(Object.keys(body), ['ok', 'time', 'started', 'info', 'checks'], 'the shape is the same as a healthy answer');
		assert.deepEqual(body.info, { build: 'abc123' }, 'so the build is still readable when the store is down');
	} finally {
		await it.stop();
		await store.stop();
	}
});

test('a store that stopped answering after boot is 503 on the next poll', async () => {
	const store = createStore({ driver: memoryDriver() });
	const it = await boot({}, { store });
	try {
		assert.equal((await fetch(`${it.url}/api/health`)).status, 200);
		await store.stop();
		const answer = await fetch(`${it.url}/api/health`);
		assert.equal(answer.status, 503);
		assert.equal(((await answer.json()) as { ok: boolean }).ok, false);
	} finally {
		await it.stop();
	}
});

// --- checks ---------------------------------------------------------------------------------

test('a check is answered under its name, with whatever it answered', async () => {
	const it = await boot({
		checks: {
			backup: async () => ({ ok: true, ageHours: 3 }),
			queue: () => 12,
			never: () => null,
		},
	});
	try {
		const body = await (await fetch(`${it.url}/api/health`)).json() as { checks: unknown };
		assert.deepEqual(body.checks, { backup: { ok: true, ageHours: 3 }, queue: 12, never: null });
	} finally {
		await it.stop();
	}
});

test('checks run together, not in turn', async () => {
	let release: () => void = () => {};
	const gate = new Promise<void>((resolve) => { release = resolve; });
	// A second is long enough for the other check to have run, and short enough to fail fast.
	const expired = new Promise<string>((resolve) => { setTimeout(() => resolve('in turn'), 1000).unref(); });
	const it = await boot({
		checks: {
			// The first waits for the second to have run. In turn, it would wait for nothing.
			slow: () => Promise.race([gate.then(() => 'slow'), expired]),
			fast: () => { release(); return 'fast'; },
		},
	});
	try {
		const body = await (await fetch(`${it.url}/api/health`)).json() as { checks: unknown };
		assert.deepEqual(body.checks, { slow: 'slow', fast: 'fast' });
	} finally {
		await it.stop();
	}
});

test('a check that throws is { ok: false } under its name, without what it threw, and never decides ok', async () => {
	const store = createStore({ driver: memoryDriver() });
	const it = await boot({
		checks: {
			fine: () => 'fine',
			broken: () => { throw new Error(`disk ${SECRET}`); },
			rejected: async () => { throw new Error('later'); },
		},
	}, { store });
	try {
		const answer = await fetch(`${it.url}/api/health`);
		assert.equal(answer.status, 200, 'the store answered, so the answer is healthy');
		const text = await answer.text();
		assert.ok(!text.includes('hunter2') && !text.includes('later'), `nothing thrown reaches the body: ${text}`);
		const body = JSON.parse(text) as { ok: boolean; checks: unknown };
		assert.equal(body.ok, true);
		assert.deepEqual(body.checks, { fine: 'fine', broken: { ok: false }, rejected: { ok: false } });
	} finally {
		await it.stop();
		await store.stop();
	}
});

test('a check answering nothing is null, and one answering what JSON cannot write is { ok: false }', async () => {
	const circular: Record<string, unknown> = {};
	circular.self = circular;
	const it = await boot({
		info: { build: 'abc123' },
		checks: {
			nothing: () => undefined,
			fn: () => () => 1,
			big: () => 10n,
			loop: () => circular,
			fine: () => 'fine',
		},
	});
	try {
		const answer = await fetch(`${it.url}/api/health`);
		assert.equal(answer.status, 200, 'one check\'s answer never costs the poll the body');
		const body = await answer.json() as { ok: boolean; info: unknown; checks: unknown };
		assert.equal(body.ok, true);
		assert.deepEqual(body.info, { build: 'abc123' });
		assert.deepEqual(body.checks, { nothing: null, fn: null, big: { ok: false }, loop: { ok: false }, fine: 'fine' });
	} finally {
		await it.stop();
	}
});

test('a check answering { ok: false } does not change the answer either', async () => {
	const it = await boot({ checks: { backup: () => ({ ok: false, ageHours: 40 }) } });
	try {
		const answer = await fetch(`${it.url}/api/health`);
		assert.equal(answer.status, 200);
		const body = await answer.json() as { ok: boolean; checks: unknown };
		assert.equal(body.ok, true);
		assert.deepEqual(body.checks, { backup: { ok: false, ageHours: 40 } });
	} finally {
		await it.stop();
	}
});

test('a check runs on every poll, not once', async () => {
	let polls = 0;
	const it = await boot({ checks: { polls: () => { polls += 1; return polls; } } });
	try {
		assert.deepEqual(((await (await fetch(`${it.url}/api/health`)).json()) as { checks: unknown }).checks, { polls: 1 });
		assert.deepEqual(((await (await fetch(`${it.url}/api/health`)).json()) as { checks: unknown }).checks, { polls: 2 });
	} finally {
		await it.stop();
	}
});

// --- what is not the route ------------------------------------------------------------------

test('HEAD carries the same status and headers as GET, and no body', async () => {
	const store = createStore({ driver: memoryDriver() });
	const it = await boot({ info: { build: 'abc123' }, checks: { n: () => 1 } }, { store });
	try {
		const get = await fetch(`${it.url}/api/health`);
		const head = await fetch(`${it.url}/api/health`, { method: 'HEAD' });
		assert.equal(head.status, 200);
		const text = await get.text();
		assert.equal(await head.text(), '', 'no body');
		const expected = headersOf(get);
		assert.equal(expected['content-length'], String(Buffer.byteLength(text)));
		assert.deepEqual(headersOf(head), expected, 'the headers GET wrote, the length of its body included');

		await store.stop();
		const down = await fetch(`${it.url}/api/health`, { method: 'HEAD' });
		assert.equal(down.status, 503, 'and a HEAD probe sees the store go down too');
		assert.equal(await down.text(), '');
	} finally {
		await it.stop();
	}
});

test('the HEAD answer holds no body at all, as the module built it', async () => {
	// Over a port Node drops a HEAD body itself, so this holds the listener and reads the answer
	// the module built.
	let handlers: ListenerHandlers | undefined;
	const listener: Listener = {
		start: async (given) => { handlers = given; },
		stop: async () => {},
	};
	const own = fromBundle({ './health/Check.ts': { config: {} } });
	const server = createServer({ sources: [own, health], gate: open, listener });
	await server.start();
	try {
		assert.ok(handlers !== undefined, 'the server started and handed its handlers over');
		const head = await handlers.request(new Request('http://app.test/api/health', { method: 'HEAD' }), { address: '127.0.0.1' });
		assert.equal(head.status, 200);
		assert.equal(head.body, null, 'HEAD is the headers alone');
		const get = await handlers.request(new Request('http://app.test/api/health'), { address: '127.0.0.1' });
		assert.equal(get.headers.get('content-length'), head.headers.get('content-length'));
		assert.equal(String(Buffer.byteLength(await get.text())), get.headers.get('content-length'));
	} finally {
		await server.stop();
	}
});

test('another method on the path, and another path, are what no route matched', async () => {
	const it = await boot({});
	try {
		for (const [method, path] of [['POST', '/api/health'], ['PUT', '/api/health'], ['GET', '/api/health/'], ['GET', '/health']] as const) {
			const answer = await fetch(`${it.url}${path}`, { method });
			assert.equal(answer.status, 404, `${method} ${path}`);
			await answer.arrayBuffer();
		}
		const query = await fetch(`${it.url}/api/health?probe=1`);
		assert.equal(query.status, 200, 'the query is not part of the path');
		await query.arrayBuffer();
	} finally {
		await it.stop();
	}
});

// --- the gate -------------------------------------------------------------------------------

test('under the auth gate, a poll with no cookie is answered with public true and refused with it false', async () => {
	const store = createStore({ driver: memoryDriver(), declare: paths });
	const served = await boot({}, { store, gated: true });
	try {
		const answer = await fetch(`${served.url}/api/health`);
		assert.equal(answer.status, 200);
		assert.equal(((await answer.json()) as { ok: boolean }).ok, true);
	} finally {
		await served.stop();
	}
	const kept = await boot({ public: false }, { store, gated: true });
	try {
		const answer = await fetch(`${kept.url}/api/health`);
		assert.equal(answer.status, 403);
		const body = await answer.json() as { reasons: { code: string }[] };
		assert.equal(body.reasons[0]?.code, 'private');
	} finally {
		await kept.stop();
		await store.stop();
	}
});

test('under open, which reads nothing, public false is served like anything else', async () => {
	const it = await boot({ public: false });
	try {
		const answer = await fetch(`${it.url}/api/health`);
		assert.equal(answer.status, 200);
		await answer.arrayBuffer();
	} finally {
		await it.stop();
	}
});

// --- configuration --------------------------------------------------------------------------

test('an invalid configuration is refused at load, with the fix on the error', async () => {
	const cases: Array<readonly [string, Record<string, unknown>]> = [
		['an info that is not an object', { info: 'abc123' }],
		['an info that is a list', { info: ['abc123'] }],
		['a null info', { info: null }],
		['an info JSON cannot write', { info: { size: 10n } }],
		['checks that are not an object', { checks: [() => 1] }],
		['a check that is not a function', { checks: { backup: { ok: true } } }],
		['a public that is not a boolean', { public: 'yes' }],
	];
	for (const [what, config] of cases) {
		let booted: Booted | undefined;
		try {
			booted = await boot(config);
		} catch (error) {
			assert.equal(reasonOf(error), 'failed', what);
			assert.equal(causeOf(error), 'invalid-config', what);
			assert.match((error as { cause: Error }).cause.message, /^invalid-config: health\/Check was given /, what);
			assert.ok(String(((error as { cause: { fix?: unknown } }).cause).fix).length > 0, `${what}: the fix is on the error`);
			continue;
		}
		// Stopped so a failure here is a red test rather than a server left running.
		await booted.stop();
		assert.fail(`${what} booted`);
	}
});
