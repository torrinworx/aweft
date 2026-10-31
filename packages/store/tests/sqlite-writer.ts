// One writer thread for the SQLite suite: its own handle on the shared file, waiting at a barrier
// so every thread starts writing at the same moment, then writing one slot of its own over and
// over. It reports the sequences it was given, or the error that stopped it.

import { DatabaseSync } from 'node:sqlite';
import { parentPort, workerData } from 'node:worker_threads';

import { sqliteDriver } from '../src/sqlite.ts';

const { path, writer, writes, gate, root } = workerData as {
	path: string; writer: number; writes: number; gate: SharedArrayBuffer; root: string;
};

const db = new DatabaseSync(path);
db.exec('PRAGMA busy_timeout = 20000');
const driver = sqliteDriver(db);

const barrier = new Int32Array(gate);
Atomics.add(barrier, 0, 1);
while (Atomics.load(barrier, 1) === 0) Atomics.wait(barrier, 1, 0, 50);

const seqs: number[] = [];
try {
	for (let i = 0; i < writes; i++) {
		seqs.push(await driver.write({
			doc: 'shared', root, rootKind: 'object', dropped: [], body: new Uint8Array([writer, i]),
			rows: [{ id: root, kind: 'object', set: { [`w${String(writer)}`]: i }, unset: [] }],
		}));
	}
	parentPort!.postMessage({ seqs });
} catch (e) {
	parentPort!.postMessage({ seqs, error: (e as Error).message });
} finally {
	await driver.close();
	db.close();
}
