// The Metabase views over a throwaway Postgres: a visit is one row, its entries are rows joined
// to it. Skipped when the embedded database is not installed (design 261).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { postgresDriver } from '@aweftjs/store/postgres';
import { createStore } from '@aweftjs/store';
import { throwaway } from '@aweftjs/testing/postgres';

import { entry, module } from './helpers.ts';
import { paths as authPaths } from '@aweftjs/auth';
import type { Visits } from '../src/modules/Visits.ts';
import { paths } from '../src/index.ts';

const sql = readFileSync(fileURLToPath(new URL('../postgres/views.sql', import.meta.url)), 'utf8');

const available = async (): Promise<boolean> => {
	try {
		await import('embedded-postgres');
		await import('pg');
		return true;
	} catch {
		return false;
	}
};

test('the views read a visit and its entries out of the rows', { skip: (await available()) ? false : 'embedded-postgres not installed' }, async () => {
	const db = await throwaway();
	try {
		const pool = await db.pool();
		const store = createStore({ driver: postgresDriver(pool as never), declare: { ...authPaths, ...paths } });
		const { instance, stop } = await module<Visits>('Visits', store, {}, {});
		await instance.record({ visit: 'v1', build: 'abc', entries: [entry('status', { status: 'open' }, 100), entry('error', { message: 'boom' }, 200)] }, { user: 'u1' });
		await stop();
		await store.stop();

		await (pool as { query(t: string): Promise<unknown> }).query(sql);

		const visits = (await (pool as { query(t: string): Promise<{ rows: Record<string, unknown>[] }> }).query(
			"SELECT id, kind, \"user\", build, errors FROM aweft_log_visits WHERE id = 'visit:v1'")).rows;
		assert.equal(visits.length, 1);
		assert.deepEqual([visits[0]!.kind, visits[0]!.user, visits[0]!.build, Number(visits[0]!.errors)], ['visit', 'u1', 'abc', 1]);

		const entries = (await (pool as { query(t: string): Promise<{ rows: Record<string, unknown>[] }> }).query(
			"SELECT kind, message, status FROM aweft_log_entries WHERE visit = 'visit:v1' ORDER BY at")).rows;
		assert.deepEqual(entries.map((r) => r.kind), ['status', 'error']);
		assert.equal(entries[1]!.message, 'boom');
		assert.equal(entries[0]!.status, 'open');
	} finally {
		await db.stop();
	}
});
