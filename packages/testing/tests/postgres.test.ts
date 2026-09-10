// The throwaway database: a cluster that exists for the run and goes away with it.

import test from 'node:test';
import assert from 'node:assert/strict';

import { throwaway } from '../src/postgres.ts';

test('a throwaway answers a working pool, and a schema of its own per call', async () => {
	const db = await throwaway();
	try {
		const one = await db.pool();
		const two = await db.pool();
		await one.query('CREATE TABLE thing (id int)');
		// The same statement again only works if the second pool is somewhere else.
		await two.query('CREATE TABLE thing (id int)');

		await one.query('INSERT INTO thing VALUES (1)');
		const counted = async (pool: { query(t: string): Promise<{ rows: Record<string, unknown>[] }> }): Promise<unknown> =>
			(await pool.query('SELECT count(*) FROM thing')).rows[0]?.count;
		assert.equal(await counted(one), '1');
		assert.equal(await counted(two), '0', 'the second pool is in a schema of its own');
	} finally {
		await db.stop();
	}
});

test('a pool a caller ended does not leave the cluster running', async () => {
	const db = await throwaway();
	const pool = await db.pool();
	// The README says the throwaway owns its pools, and somebody will end one anyway. If that
	// throw escaped, `stop` would abort before stopping the cluster and a Postgres would outlive
	// the run with no way to reach it: the flag is already set, so a second stop returns early.
	await pool.end();

	await db.stop();
	await db.stop();

	const { createConnection } = await import('node:net');
	const down = await new Promise<boolean>((resolve) => {
		const probe = createConnection({ host: 'localhost', port: db.port });
		probe.on('error', () => { resolve(true); });
		probe.on('connect', () => { probe.destroy(); resolve(false); });
	});
	assert.equal(down, true, 'the cluster is still listening, so stop did not finish');
});

test('stopping ends every pool it handed out, and is safe twice', async () => {
	const db = await throwaway();
	const pool = await db.pool();
	await db.stop();
	await db.stop();
	await assert.rejects(() => pool.query('SELECT 1'), 'a pool the throwaway ended is closed');
});

test('every pool listens for its own errors, so a dropped connection is not an uncaught exception', async () => {
	const db = await throwaway();
	try {
		// Stopping the cluster drops every connection still open, and a pool with no `error`
		// listener turns that into an uncaught exception in whatever test happens to be running.
		// Asserting the listener is the deterministic form of that: the failure it prevents is a
		// race, and a test that waits for the race to happen passes whether or not it is fixed.
		const pool = await db.pool();
		const emitter = pool as unknown as { listenerCount(event: string): number };
		assert.equal(emitter.listenerCount('error') > 0, true, 'the pool handed out has no error listener');
	} finally {
		await db.stop();
	}
});

test('a peer that will not load refuses with the name to install', async () => {
	await assert.rejects(
		() => throwaway(() => Promise.reject(new Error('not here'))),
		(error: Error & { reason?: string; fix?: string }) => {
			assert.equal(error.reason, 'peer-not-installed');
			assert.match(error.message, /embedded-postgres is not installed/);
			assert.match(String(error.fix), /Install embedded-postgres and pg/);
			return true;
		},
	);
});
