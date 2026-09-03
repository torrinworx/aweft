// `follow`: the one helper that acts on its own, and exactly what it acts on.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { createObject } from '@aweftjs/core';

import { createLoader, follow, fromDocument } from '../src/index.ts';

type Entry = { source: string; note?: string };
type Doc = Record<string, unknown>;

declare global {
	// eslint-disable-next-line no-var
	var followTrace: string[];
}
globalThis.followTrace = [];

const base = (v: number): string =>
	`export default () => ({ v: ${v}, stop() { globalThis.followTrace.push('stop Base'); } })`;
const top = 'export const deps = ["p/Base"]; export default ({ imports }) => ({ v: () => imports.Base.v * 10, stop() { globalThis.followTrace.push("stop Top"); } })';
const other = (v: number): string => `export default () => ({ v: ${v} })`;

const setup = async () => {
	globalThis.followTrace = [];
	const doc = createObject<Doc>({
		'p/Base': createObject<Entry>({ source: base(1) }),
		'p/Top': createObject<Entry>({ source: top }),
		'p/Other': createObject<Entry>({ source: other(1) }),
	});
	const loader = createLoader({ sources: [fromDocument(doc)] });
	await loader.load(['p/Top']);
	return { doc, loader, entry: (name: string) => doc[name] as Entry };
};

/** Wait for a condition the follow queue will bring about, or fail with what was seen. */
const until = async (what: string, ok: () => boolean): Promise<void> => {
	for (let i = 0; i < 200; i++) {
		if (ok()) return;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	assert.fail(`timed out waiting for: ${what}`);
};

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 40));

test('a changed source reloads the module and its loaded dependents, dependents first out and dependency order back', async () => {
	const { doc, loader, entry } = await setup();
	const stop = follow(loader, doc);
	const before = loader.get('p/Top') as { v(): number };
	assert.equal(before.v(), 10);

	entry('p/Base').source = base(2);
	await until('the reload', () => loader.get('p/Top') !== before && loader.get('p/Top') !== undefined);
	assert.equal((loader.get('p/Top') as { v(): number }).v(), 20);
	assert.deepEqual(globalThis.followTrace, ['stop Top', 'stop Base']);
	assert.deepEqual(loader.loaded(), ['p/Base', 'p/Top']);
	stop();
});

test('a change to a field other than source does nothing', async () => {
	const { doc, loader, entry } = await setup();
	const stop = follow(loader, doc);
	const before = loader.get('p/Top');
	entry('p/Base').note = 'reviewed';
	await settle();
	assert.equal(loader.get('p/Top'), before);
	assert.deepEqual(globalThis.followTrace, []);
	stop();
});

test('a change to an entry nothing has loaded does nothing', async () => {
	const { doc, loader, entry } = await setup();
	const stop = follow(loader, doc);
	entry('p/Other').source = other(2);
	await settle();
	assert.equal(loader.get('p/Other'), undefined);
	assert.deepEqual(loader.loaded(), ['p/Base', 'p/Top']);
	stop();
});

test('a removed entry unloads the module and its loaded dependents', async () => {
	const { doc, loader } = await setup();
	const stop = follow(loader, doc);
	delete doc['p/Base'];
	await until('the unload', () => loader.loaded().length === 0);
	assert.deepEqual(globalThis.followTrace, ['stop Top', 'stop Base']);
	stop();
});

test('a reload that fails goes to the handler, with the module named; without one it is raised', async () => {
	const { doc, loader, entry } = await setup();
	const failures: [string, unknown][] = [];
	const stop = follow(loader, doc, { failed: (name, error) => failures.push([name, error]) });
	entry('p/Base').source = 'export default ({';
	await until('the failure', () => failures.length === 1);
	assert.equal(failures[0]![0], 'p/Base');
	assert.ok(failures[0]![1] instanceof Error);
	// The old instances are gone: the unload half happened, and the load half could not.
	assert.equal(loader.get('p/Base'), undefined);
	stop();
});

test('stopping the follow stops it', async () => {
	const { doc, loader, entry } = await setup();
	const stop = follow(loader, doc);
	stop();
	const before = loader.get('p/Top');
	entry('p/Base').source = base(3);
	await settle();
	assert.equal(loader.get('p/Top'), before);
});

test('a module loaded after the follow started is followed too', async () => {
	const { doc, loader, entry } = await setup();
	const stop = follow(loader, doc);
	await loader.load(['p/Other']);
	const before = loader.get('p/Other');
	entry('p/Other').source = other(2);
	await until('the reload', () => loader.get('p/Other') !== before && loader.get('p/Other') !== undefined);
	assert.deepEqual(loader.get('p/Other'), { v: 2 });
	stop();
});

test('two changes in a row reload in the order they landed, one at a time', async () => {
	const { doc, loader, entry } = await setup();
	const stop = follow(loader, doc);
	entry('p/Base').source = base(5);
	entry('p/Base').source = base(6);
	await until('both reloads', () => (loader.get('p/Top') as { v(): number } | undefined)?.v() === 60);
	await settle();
	assert.equal((loader.get('p/Top') as { v(): number }).v(), 60);
	assert.deepEqual(globalThis.followTrace, ['stop Top', 'stop Base', 'stop Top', 'stop Base']);
	stop();
});

test('after a reload, an unrelated change does not reload again', async () => {
	// The follow has to remember the source it last saw after every commit, or the next commit
	// of any kind would compare the new source against the old one and reload a second time.
	const { doc, loader, entry } = await setup();
	const stop = follow(loader, doc);
	entry('p/Base').source = base(2);
	await until('the reload', () => (loader.get('p/Top') as { v(): number } | undefined)?.v() === 20);
	const reloaded = loader.get('p/Top');
	globalThis.followTrace = [];

	entry('p/Other').note = 'unrelated';
	await settle();
	assert.equal(loader.get('p/Top'), reloaded);
	assert.deepEqual(globalThis.followTrace, []);
	stop();
});

test('an entry added after the follow started, then loaded, then changed, is reloaded', async () => {
	const { doc, loader } = await setup();
	const stop = follow(loader, doc);
	doc['p/New'] = createObject<Entry>({ source: other(1) });
	await loader.load(['p/New']);
	const before = loader.get('p/New');

	(doc['p/New'] as Entry).source = other(2);
	await until('the reload of the new entry', () => loader.get('p/New') !== before && loader.get('p/New') !== undefined);
	assert.deepEqual(loader.get('p/New'), { v: 2 });
	stop();
});

test('applied hears each reload and each unload as it finishes, so nobody has to poll', async () => {
	const { doc, loader, entry } = await setup();
	const applied: [string, string][] = [];
	const stop = follow(loader, doc, { applied: (name, action) => applied.push([name, action]) });

	entry('p/Base').source = base(2);
	await until('the reload to be announced', () => applied.length === 1);
	assert.deepEqual(applied, [['p/Base', 'reloaded']]);
	assert.equal((loader.get('p/Top') as { v(): number }).v(), 20, 'by the time applied fires, the new instances are in place');

	delete doc['p/Base'];
	await until('the unload to be announced', () => applied.length === 2);
	assert.deepEqual(applied[1], ['p/Base', 'unloaded']);
	assert.deepEqual(loader.loaded(), []);
	stop();
});

test('a failed reload goes to failed and not to applied', async () => {
	const { doc, loader, entry } = await setup();
	const applied: string[] = [];
	const failed: string[] = [];
	const stop = follow(loader, doc, { applied: (name) => applied.push(name), failed: (name) => failed.push(name) });
	entry('p/Base').source = 'export default ({';
	await until('the failure', () => failed.length === 1);
	await settle();
	assert.deepEqual(applied, []);
	stop();
});

test('a stop that throws during a reload costs that change, not the follow: failed hears it, the reload still lands, later changes still follow', async () => {
	globalThis.followTrace = [];
	const doc = createObject<Doc>({
		'p/Base': createObject<Entry>({ source: base(1) }),
		'p/Angry': createObject<Entry>({ source: 'export const deps = ["p/Base"]; export default ({ imports }) => ({ v: () => imports.Base.v, stop() { throw new Error("cannot close"); } })' }),
		'p/Ok': createObject<Entry>({ source: other(1) }),
	});
	const loader = createLoader({ sources: [fromDocument(doc)] });
	await loader.load(['p/Angry', 'p/Ok']);
	const failures: string[] = [];
	const applied: string[] = [];
	const stop = follow(loader, doc, { failed: (name, error) => failures.push(`${name}: ${(error as Error).message}`), applied: (name) => applied.push(name) });

	(doc['p/Base'] as Entry).source = base(2);
	await until('the failure to be reported', () => failures.length === 1);
	assert.deepEqual(failures, ['p/Base: cannot close']);
	assert.equal((loader.get('p/Angry') as { v(): number }).v(), 2, 'the reload still happened; only the stop misbehaved');

	(doc['p/Ok'] as Entry).source = other(2);
	await until('a later healthy change to follow', () => applied.includes('p/Ok'));
	assert.deepEqual(loader.get('p/Ok'), { v: 2 });
	stop();
});

test('an applied handler that throws does not stop the follow', async () => {
	const { doc, loader, entry } = await setup();
	const failures: string[] = [];
	let calls = 0;
	const stop = follow(loader, doc, {
		applied: () => { calls++; if (calls === 1) throw new Error('handler broke'); },
		failed: (name, error) => failures.push(`${name}: ${(error as Error).message}`),
	});
	entry('p/Base').source = base(2);
	await until('the handler throw to be reported', () => failures.length === 1);
	assert.deepEqual(failures, ['p/Base: handler broke']);
	entry('p/Base').source = base(3);
	await until('the next reload', () => calls === 2);
	assert.equal((loader.get('p/Top') as { v(): number }).v(), 30);
	stop();
});

test('without a failed handler, a failed reload is raised where nothing catches it, and the process says so', () => {
	const script = `
		import { createObject } from '@aweftjs/core';
		import { createLoader, follow, fromDocument } from '@aweftjs/modules';
		const doc = createObject({ m: createObject({ source: 'export default () => ({ v: 1 })' }) });
		const loader = createLoader({ sources: [fromDocument(doc)] });
		await loader.load(['m']);
		follow(loader, doc);
		doc.m.source = 'export default ({';
		setTimeout(() => console.log('still alive'), 300);
	`;
	const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
		cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', timeout: 20_000,
	});
	assert.notEqual(run.status, 0, `the process should have died: ${run.stdout} ${run.stderr}`);
	assert.match(run.stderr, /SyntaxError|Unexpected end of input/);
	assert.doesNotMatch(run.stdout, /still alive/);
});
