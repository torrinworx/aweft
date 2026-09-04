// The host's side, through the public surface, once per Node runner.

import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import { createArray, createObject } from '@aweftjs/core';
import { createSandbox, inProcess } from '@aweftjs/sandbox';

import { document, grantsOf, open, reasonOf, runners, until } from './helpers.ts';

const echo = `export default ({ imports, ...props }) => ({ echo: (x) => x, props: () => props, nothing: () => undefined, slow: () => new Promise(() => {}) });`;

for (const [label, make] of Object.entries(runners)) {
	test(`${label}: a module loads, answers with data, and sees the props`, async () => {
		const { sandbox } = await open(make, { 'app/Echo': echo }, [], { props: { site: 'demo', depth: { n: [1, 2] } } });
		try {
			const { 'app/Echo': stub } = await sandbox.load(['app/Echo']);
			assert.deepEqual(Object.keys(stub!).sort(), ['echo', 'nothing', 'props', 'slow']);
			assert.deepEqual(await stub!.echo!({ a: [1, 'b', null, { c: true }] }), { a: [1, 'b', null, { c: true }] });
			assert.equal(await stub!.nothing!(), null, 'undefined crosses as null');
			assert.deepEqual(await stub!.props!(), { site: 'demo', depth: { n: [1, 2] }, config: {}, extensions: {} });
			assert.deepEqual(await sandbox.loaded(), ['app/Echo']);
			assert.equal(await sandbox.unload('app/Echo'), true);
			assert.deepEqual(await sandbox.loaded(), []);
		} finally {
			await sandbox.stop();
		}
	});

	test(`${label}: expose puts an instance behind a name, and withdrawing it makes the name missing`, async () => {
		const { sandbox } = await open(make, {
			'app/Relay': `export const deps = ['files/Read']; export default ({ imports }) => ({ run: (n) => imports.Read.read(n) });`,
		}, ['files/Read']);
		try {
			const withdraw = sandbox.expose('files/Read', { read: (n: string) => `<${n}>` });
			const { 'app/Relay': relay } = await sandbox.load(['app/Relay']);
			assert.equal(await relay!.run!('a'), '<a>');
			withdraw();
			await assert.rejects(relay!.run!('b'), (e) => reasonOf(e) === 'missing');
			withdraw();
		} finally {
			await sandbox.stop();
		}
	});

	test(`${label}: a library arrives as a bundle the room imports`, async () => {
		const bundle = fileURLToPath(new URL('./fixtures/bundle.ts', import.meta.url));
		const { sandbox } = await open(make, {
			'app/Shout': `export const deps = ['lib/Upper']; export default ({ imports }) => ({ shout: (s) => imports.Upper.up(s) });`,
		}, [], { bundle });
		try {
			const { 'app/Shout': shout } = await sandbox.load(['app/Shout']);
			assert.equal(await shout!.shout!('hi'), 'HI');
		} finally {
			await sandbox.stop();
		}
	});

	test(`${label}: follow reloads an edited module inside the room and reports to the host`, async () => {
		const applied: string[] = [];
		const failed: string[] = [];
		const { sandbox, modules } = await open(make, { 'app/Echo': echo }, [], {
			follow: true,
			handlers: { applied: (n, a) => { applied.push(`${n} ${a}`); }, failed: (n, e) => { failed.push(`${n}: ${e}`); } },
		});
		try {
			const { 'app/Echo': before } = await sandbox.load(['app/Echo']);
			assert.equal(await before!.echo!(1), 1);
			(modules['app/Echo'] as { source: string }).source = `export default () => ({ echo: (x) => 'v2:' + x });`;
			await until('the reload', () => applied.length === 1);
			assert.deepEqual(applied, ['app/Echo reloaded']);
			const { 'app/Echo': after } = await sandbox.load(['app/Echo']);
			assert.equal(await after!.echo!(1), 'v2:1');

			(modules['app/Echo'] as { source: string }).source = 'export default () => { throw new Error("broken on purpose"); };';
			await until('the failure', () => failed.length === 1);
			assert.match(failed[0]!, /app\/Echo: .*broken on purpose/);
			assert.deepEqual(await sandbox.loaded(), [], 'a module whose reload failed is not loaded');

			(modules['app/Echo'] as { source: string }).source = echo;
			await sandbox.load(['app/Echo']);
			delete modules['app/Echo'];
			await until('the unload', () => applied.length === 2);
			assert.equal(applied[1], 'app/Echo unloaded');
			assert.deepEqual(await sandbox.loaded(), []);
		} finally {
			await sandbox.stop();
		}
	});

	test(`${label}: a call the room does not answer in time errors with timeout, and the room goes on`, async () => {
		const { sandbox } = await open(make, { 'app/Echo': echo }, [], { limits: { callMs: 1000 } });
		try {
			const { 'app/Echo': stub } = await sandbox.load(['app/Echo']);
			const started = Date.now();
			await assert.rejects(stub!.slow!(), (e) => reasonOf(e) === 'timeout');
			assert.ok(Date.now() - started >= 900, 'the limit is what was asked for');
			assert.equal(await stub!.echo!('still here'), 'still here');
		} finally {
			await sandbox.stop();
		}
	});

	test(`${label}: stop twice is not an error, and nothing answers afterwards`, async () => {
		const { sandbox } = await open(make, { 'app/Echo': echo });
		await sandbox.stop();
		await sandbox.stop();
		await assert.rejects(sandbox.loaded(), (e) => reasonOf(e) === 'closed');
	});
}

test('a room made from what is not a document, or a grants list that is not observable, is refused', async () => {
	await assert.rejects(createSandbox({ runner: inProcess(), modules: {}, grants: grantsOf() }), (e) => reasonOf(e) === 'malformed');
	await assert.rejects(createSandbox({ runner: inProcess(), modules: createArray(), grants: grantsOf() }), (e) => reasonOf(e) === 'malformed');
	await assert.rejects(createSandbox({ runner: inProcess(), modules: document({}), grants: ['plain'] }), (e) => reasonOf(e) === 'malformed');
	await assert.rejects(createSandbox({ runner: inProcess(), modules: document({}), grants: createObject() as unknown as string[] }), (e) => reasonOf(e) === 'malformed');
});

test('a prop that is not plain data is refused by name before the room starts', async () => {
	let started = 0;
	const runner = { start: async () => { started += 1; return inProcess().start(); }, stop: async () => {} };
	for (const [props, path] of [
		[{ db: { query: () => 1 } }, 'props.db.query'],
		[{ n: Number.NaN }, 'props.n'],
		[{ list: [1, undefined] }, 'props.list[1]'],
		[{ bytes: new Uint8Array(2) }, 'props.bytes'],
		[{ doc: createObject() }, 'props.doc'],
	] as const) {
		await assert.rejects(
			createSandbox({ runner, modules: document({}), grants: grantsOf(), props }),
			(e) => reasonOf(e) === 'not-data' && (e as { path?: string }).path === path,
			path,
		);
	}
	const cyclic: Record<string, unknown> = {};
	cyclic.self = cyclic;
	await assert.rejects(createSandbox({ runner, modules: document({}), grants: grantsOf(), props: { cyclic } }), (e) => reasonOf(e) === 'not-data');
	assert.equal(started, 0, 'the runner never started');
});

test('the host hears applied and failed only as data, and a handler that throws costs nothing', async () => {
	const { sandbox, modules } = await open(() => inProcess(), { 'app/Echo': echo }, [], {
		follow: true,
		handlers: { applied: () => { throw new Error('the handler is broken'); } },
	});
	try {
		await sandbox.load(['app/Echo']);
		(modules['app/Echo'] as { source: string }).source = `export default () => ({ echo: (x) => 'v2:' + x });`;
		await until('the reload', async () => (await sandbox.load(['app/Echo']))['app/Echo']!.echo!(1).then((v) => v === 'v2:1'));
		assert.equal(await (await sandbox.load(['app/Echo']))['app/Echo']!.echo!(2), 'v2:2', 'the bridge is still answering');
	} finally {
		await sandbox.stop();
	}
});

test('a runner that fails to start fails createSandbox, and a room whose channel ends rejects what waits', async () => {
	const failing = { start: async () => { throw new Error('no room today'); }, stop: async () => {} };
	await assert.rejects(createSandbox({ runner: failing, modules: document({}), grants: grantsOf() }), /no room today/);

	const inner = inProcess();
	let channel: Awaited<ReturnType<typeof inner.start>> | undefined;
	const runner = { start: async () => (channel = await inner.start()), stop: () => inner.stop() };
	const sandbox = await createSandbox({ runner, modules: document({ 'app/Echo': echo }), grants: grantsOf() });
	const { 'app/Echo': stub } = await sandbox.load(['app/Echo']);
	const waiting = stub!.slow!();
	channel!.close();
	await assert.rejects(waiting, (e) => reasonOf(e) === 'closed');
	await assert.rejects(stub!.echo!(1), (e) => reasonOf(e) === 'closed');
	await sandbox.stop();
});
