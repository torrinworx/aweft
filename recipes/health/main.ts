// A deploy's verification, against the stack's own health endpoint.
//
// The job: a release built from `new` was shipped. The script that shipped it polls `/api/health`
// until the build answering is the one it shipped, with no cookie, through the auth gate. First
// it meets the process the release was meant to replace, still serving, and says so. Then the two
// states a poll must not mistake for health: an application check that threw, which is still 200
// with `{ ok: false }` under the check's name, and a store that stopped answering, which is 503
// with the build still readable and nothing of the error in the body.
//
// Run: node recipes/health/main.ts

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { auth, paths } from '@aweftjs/auth';
import { health } from '@aweftjs/health';
import { fromBundle } from '@aweftjs/modules';
import { fromDirectory } from '@aweftjs/modules/node';
import { createServer } from '@aweftjs/server';
import { node } from '@aweftjs/server/node';
import { createStore, memoryDriver } from '@aweftjs/store';
import type { Store } from '@aweftjs/store';

const here = fileURLToPath(new URL('.', import.meta.url));

interface Answer {
	readonly ok: boolean;
	readonly time: string;
	readonly started: string;
	readonly info: { readonly build: string | null };
	readonly checks: { readonly backup?: { readonly ok: boolean; readonly ageHours?: number } };
}

// --- the application ---------------------------------------------------------------------------

/**
 * One process of the application: its own modules directory, the health and auth batteries, a
 * store, the auth gate. `build` stands in for what a deploy writes into the environment, listed
 * ahead of the directory so each process here answers with its own.
 */
const boot = async (build: string, store: Store): Promise<{ url: string; stop(): Promise<void> }> => {
	const listener = node({ port: 0, host: '127.0.0.1' });
	const server = createServer({
		sources: [
			fromBundle({ './health/Check.ts': { config: { info: { build } } } }),
			fromDirectory(join(here, 'modules')),
			health,
			auth,
		],
		store,
		gate: 'auth/Gate',
		listener,
	});
	await server.start();
	return { url: `http://127.0.0.1:${String(listener.port)}`, stop: () => server.stop() };
};

// The nightly dump's status file, where the application's own check reads it from.
const dir = mkdtempSync(join(tmpdir(), 'aweft-health-'));
const status = join(dir, 'backup-status.json');
process.env.BACKUP_STATUS = status;
writeFileSync(status, JSON.stringify({ ok: true, at: Date.now() - 3 * 36e5 }));

// --- the deploy script's poll ------------------------------------------------------------------

type Verdict = 'deployed' | 'older process' | 'not answering';

/**
 * What a deploy script does after shipping: poll until the build answering is the one it shipped.
 * It reads the body, not the status alone, because a shell served for every unknown URL answers
 * 200 too. A 503 is a process that is up and wrong, and the script keeps polling; the process it
 * meant to replace answers 200 with the older build, and after enough of those it says so.
 */
const verify = async (url: string, shipped: string, attempts: number): Promise<Verdict> => {
	let verdict: Verdict = 'not answering';
	for (let attempt = 1; attempt <= attempts; attempt++) {
		const answer = await fetch(`${url}/api/health`);
		const body = await answer.json() as Answer;
		if (answer.status === 200 && body.ok && body.info.build === shipped) return 'deployed';
		verdict = answer.status === 200 && body.info.build !== shipped ? 'older process' : 'not answering';
		await new Promise((done) => setTimeout(done, 10));
	}
	return verdict;
};

const store = createStore({ driver: memoryDriver(), declare: paths });
const older = await boot('old', store);
const newer = await boot('new', store);

try {
	console.log('shipping build new');
	assert.equal(await verify(older.url, 'new', 3), 'older process', 'the process the release was meant to replace is still serving');
	console.log('  the older process is still serving: build old');
	await older.stop();

	assert.equal(await verify(newer.url, 'new', 20), 'deployed');
	const answer = await fetch(`${newer.url}/api/health`);
	assert.equal(answer.status, 200);
	assert.equal(answer.headers.get('cache-control'), 'no-store', 'nothing between the poll and the process keeps a copy');
	const body = await answer.json() as Answer;
	assert.equal(body.ok, true);
	assert.equal(body.info.build, 'new');
	assert.deepEqual(body.checks.backup, { ok: true, ageHours: 3 }, 'the application\'s own check, under its name');
	assert.ok(Date.parse(body.started) <= Date.parse(body.time), 'the process began before it answered');
	console.log(`  deployed: build ${String(body.info.build)}, started ${body.started}, backup ${String(body.checks.backup?.ageHours)}h ago`);

	// --- the two states a poll must not mistake -------------------------------------------------

	rmSync(status);
	const threw = await fetch(`${newer.url}/api/health`);
	assert.equal(threw.status, 200, 'a check that threw does not make the process unhealthy');
	const thrown = await threw.json() as Answer;
	assert.equal(thrown.ok, true);
	assert.deepEqual(thrown.checks.backup, { ok: false }, 'and is reported under its name, with nothing of what it threw');
	console.log('  the backup check threw: still 200, backup { ok: false }');

	await store.stop();
	const down = await fetch(`${newer.url}/api/health`);
	assert.equal(down.status, 503, 'a store that stopped answering is a process that is up and wrong');
	const text = await down.text();
	assert.ok(!text.includes('stopped') && !text.includes('Error'), `the body carries no error text: ${text}`);
	const gone = JSON.parse(text) as Answer;
	assert.equal(gone.ok, false);
	assert.equal(gone.info.build, 'new', 'the build is still readable when the store is down');
	assert.equal(await verify(newer.url, 'new', 3), 'not answering', 'and the deploy script keeps polling');
	console.log('  the store stopped answering: 503, ok false, build still new, no error in the body');

	console.log('recipes/health: ok');
} finally {
	await newer.stop();
	rmSync(dir, { recursive: true, force: true });
}

// What this does NOT do for you. It never lets a check decide `ok`: the backup above was stale and
// then gone, and the answer stayed 200, because a stale backup is not a reason to undo a deploy.
// An application that wants that rule writes its own `health/Check`. It puts no timeout on a
// check or on the store read; the poll's own timeout is what says the process is not answering.
