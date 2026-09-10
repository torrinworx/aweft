// A Postgres that exists for the run and goes away with it.
//
// The driver's obligations are transactional and nothing but a real server enforces a row lock
// (design 160), so a suite that means it needs a cluster. Three copies of this boot were written
// before it shipped once (design 254).
//
// `embedded-postgres` and `pg` are optional peers, reached through `await import` so a project
// that never opens a store installs neither.

import { codecError } from '@aweftjs/codec';

/**
 * The minimum of `pg.Pool` this module hands back, typed here so `pg` stays an optional peer.
 *
 * It carries `connect` as well as `query` because the pool is handed straight to
 * `postgresDriver`, which takes connections rather than queries; a pool that could only answer
 * `query` would make the one thing this module is for fail to compile.
 */
export interface PoolLike {
	query(text: string, values?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
	connect(): Promise<{
		query(text: string, values?: readonly unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
		release(): void;
	}>;
	end(): Promise<void>;
}

/**
 * A Postgres that exists for one run: the cluster's port, pools in schemas of their own, and the
 * teardown that ends all of them.
 *
 * @example
 * const db = await throwaway();
 * const pool = await db.pool();
 * await db.stop();
 */
export interface Throwaway {
	/** Where the cluster is listening, for anything that wants to connect its own way. */
	readonly port: number;
	/** A pool in a schema of its own, so two of them never see each other's tables. */
	pool(): Promise<PoolLike>;
	/**
	 * End every pool handed out, stop the cluster, and remove its directory.
	 *
	 * Safe to call twice, and safe after a caller has ended a pool itself: a pool that refuses to
	 * end again is not allowed to leave the cluster running.
	 */
	stop(): Promise<void>;
}

// Two throwaways started at once used to be handed the same port: `freePort` releases it, and
// `initialise` runs for about half a second before `start` binds it, so the window is wide. The
// second cluster then fails to bind, its pool connects to the first one, and stopping either
// terminates the other's queries. Starting one at a time closes that window inside a process.
let queue: Promise<unknown> = Promise.resolve();

/** A port nothing is listening on, asked for and released before the cluster takes it. */
const freePort = async (): Promise<number> => {
	const { createServer } = await import('node:net');
	return new Promise((resolve, reject) => {
		const probe = createServer();
		probe.on('error', reject);
		probe.listen(0, () => {
			const at = probe.address();
			const port = typeof at === 'object' && at !== null ? at.port : 0;
			probe.close(() => { resolve(port); });
		});
	});
};

const missing = (name: string): Error => codecError(
	'peer-not-installed',
	`${name} is not installed, and the throwaway database needs it`,
	'Install embedded-postgres and pg as devDependencies.',
);

/**
 * Start a Postgres for this run: an empty cluster in a temporary directory on a free port.
 *
 * Every pool it answers is in a schema of its own, which is how two checks in one file stay
 * apart and how two applications share one database.
 *
 * @param load How the two peers are reached. The default is a plain dynamic import of each;
 *   a loader that rejects is how the refusal below is reached without uninstalling anything.
 * @returns The cluster's port, `pool` for a fresh schema, and `stop`.
 * @throws `peer-not-installed` when `embedded-postgres` or `pg` is not installed.
 * @example
 * const db = await throwaway();
 * const store = createStore({ driver: postgresDriver(await db.pool()) });
 * // ...
 * await db.stop();
 */
export const throwaway = async (load: Load = defaultLoad): Promise<Throwaway> => {
	// Serialised, and retried: the port is picked before the cluster binds it, so a machine busy
	// enough can still hand the same one to something else in between. A lost race is a retry on a
	// fresh port rather than a red suite.
	const mine = queue.then(async () => {
		let last: unknown;
		for (let attempt = 0; attempt < 3; attempt++) {
			try {
				return await start(load);
			} catch (error) { last = error; }
		}
		throw last;
	});
	queue = mine.catch(() => undefined);
	return mine;
};

/** How the optional peers are reached, so a test can reach the refusal without uninstalling one. */
export type Load = (name: 'embedded-postgres' | 'pg') => Promise<unknown>;

const defaultLoad: Load = (name) => (name === 'pg' ? import('pg') : import('embedded-postgres'));

const start = async (load: Load): Promise<Throwaway> => {
	const { mkdtempSync, rmSync } = await import('node:fs');
	const { tmpdir } = await import('node:os');
	const { join } = await import('node:path');

	const reach = async (name: 'embedded-postgres' | 'pg'): Promise<{ default: unknown }> => {
		try {
			return await load(name) as { default: unknown };
		} catch {
			throw missing(name);
		}
	};
	const Embedded = (await reach('embedded-postgres')).default as new (options: object) => {
		initialise(): Promise<void>; start(): Promise<void>; stop(): Promise<void>;
	};
	const pg = (await reach('pg')).default as { Pool: new (options: object) => unknown };

	const credentials = { user: 'postgres', password: 'password' };

	// The prefix matters: a run killed part way through leaves a Postgres behind, and this is how
	// it is found and stopped.
	const directory = mkdtempSync(join(tmpdir(), 'aweft-pg-'));
	const port = await freePort();
	const cluster = new Embedded({
		databaseDir: directory, port, ...credentials,
		persistent: false, onLog: () => {}, onError: () => {},
	});
	await cluster.initialise();
	await cluster.start();

	const connection = { host: 'localhost', port, ...credentials, database: 'postgres' };

	// A pool with no `error` listener turns a dropped connection into an uncaught exception, and
	// stopping the cluster drops every connection still open: the suite then fails with
	// "terminating connection due to administrator command" in whichever test happened to be
	// running. Shutting the database down is what this module is for, so the noise is expected
	// and swallowed here rather than left for a caller who did nothing wrong.
	const quiet = (made: unknown): PoolLike => {
		(made as { on(event: string, fn: () => void): void }).on('error', () => {});
		return made as PoolLike;
	};

	const admin = quiet(new pg.Pool(connection));

	// `start` resolves when the log says the server is up, and a server that is up can still be
	// finishing its own startup. The throwaway is not handed over until the database has answered.
	const ready = Date.now() + 30_000;
	for (;;) {
		try {
			await admin.query('SELECT 1');
			break;
		} catch (error) {
			if (Date.now() > ready) throw error;
			await new Promise((done) => setTimeout(done, 50));
		}
	}
	const open: PoolLike[] = [admin];
	let schemas = 0;

	return {
		port,
		pool: async () => {
			const schema = `check_${String(schemas++)}`;
			await admin.query(`CREATE SCHEMA ${schema}`);
			// The search path is what puts a pool in its schema: the driver names no schema of its
			// own, so it owns its tables wherever the pool is pointed (design 160).
			const pool = quiet(new pg.Pool({ ...connection, options: `-c search_path=${schema}` }));
			open.push(pool);
			return pool;
		},
		stop: async () => {
			try {
				// A pool a caller already ended throws here, and the cluster must come down anyway:
				// leaving it up with `stopped` set makes it unstoppable through this interface, and
				// a leaked Postgres outlives the run that made it.
				for (const pool of open) await pool.end().catch(() => undefined);
			} finally {
				await cluster.stop();
				rmSync(directory, { recursive: true, force: true });
			}
		},
	};
};
