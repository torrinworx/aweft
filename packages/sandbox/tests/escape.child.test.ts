// The child runner's own half of the escape suite: what Node's permission model denies inside
// the room, from a hostile module's point of view. Append-only.
//
// What this proves is exactly what the runner claims and no more: files, network, spawning,
// workers, native addons, eval and the parent's environment are denied. Node says the
// permission model is not a boundary against a determined escape, and neither does this file.

import test from 'node:test';
import assert from 'node:assert/strict';

import { fileURLToPath } from 'node:url';

import { child } from '@aweftjs/sandbox/node';

import { open, reasonOf } from './helpers.ts';

const probe = `export default () => ({
	probe: async () => {
		const out = {};
		const attempt = async (name, fn) => { try { await fn(); out[name] = 'ALLOWED'; } catch (e) { out[name] = e.code ?? e.name; } };
		const fs = await import('node:fs');
		await attempt('fs.read', () => fs.readFileSync('/etc/hostname'));
		await attempt('fs.write', () => fs.writeFileSync('/tmp/aweft-escape-' + Date.now(), 'x'));
		await attempt('net', async () => { const net = await import('node:net'); await new Promise((res, rej) => { const s = net.connect(1, '127.0.0.1'); s.on('error', rej); s.on('connect', res); }); });
		await attempt('dns', async () => { const dns = await import('node:dns'); await new Promise((res, rej) => dns.lookup('example.com', (e, a) => e ? rej(e) : res(a))); });
		await attempt('spawn', async () => (await import('node:child_process')).execSync('id'));
		await attempt('worker', async () => new (await import('node:worker_threads')).Worker('1', { eval: true }));
		await attempt('eval', () => eval('1'));
		await attempt('Function', () => new Function('return 1')());
		await attempt('binding', () => process.binding('fs'));
		out.env = Object.keys(process.env).sort();
		out.argv = process.argv.length;
		return out;
	},
	die: () => { setTimeout(() => process.exit(7), 5); return 'dying'; },
	stubborn: () => { process.on('SIGTERM', () => {}); return 'ignoring SIGTERM'; },
	corrupt: () => { process.send({ aweft: new Uint8Array([0xff, 0xff, 0xff]) }); return 'sent garbage'; },
	loop: () => new Promise(() => {}),
});`;

test('child: files, network, spawning, workers, eval and the environment are denied inside the room', async () => {
	const { sandbox } = await open(() => child({ env: { ONLY_THIS: '1' } }), { 'evil/Probe': probe });
	try {
		const { 'evil/Probe': evil } = await sandbox.load(['evil/Probe']);
		const out = await evil!.probe!() as Record<string, unknown>;
		const env = out.env as string[];
		delete out.env;
		assert.deepEqual(out, {
			'fs.read': 'ERR_ACCESS_DENIED', 'fs.write': 'ERR_ACCESS_DENIED',
			net: 'ERR_ACCESS_DENIED', dns: 'ERR_ACCESS_DENIED',
			spawn: 'ERR_ACCESS_DENIED', worker: 'ERR_ACCESS_DENIED',
			eval: 'EvalError', Function: 'EvalError', binding: 'ERR_ACCESS_DENIED',
			argv: 2,
		});
		// The environment holds what was handed over, plus Node's own plumbing for a child it
		// spawns (the IPC channel, and NODE_V8_COVERAGE under a coverage run). Nothing of the
		// parent's is there: the next test proves a parent secret does not cross.
		assert.ok(env.includes('ONLY_THIS'), 'the handed-over value is there');
		assert.deepEqual(env.filter((k) => !k.startsWith('NODE_')).sort(), ['ONLY_THIS'], `nothing but NODE_* plumbing besides it: ${env.join(',')}`);
	} finally {
		await sandbox.stop();
	}
});

test('child: the room reads the stack it imports but not the workspace around it', async () => {
	const probe = `export default () => ({ paths: async (roots) => {
		const fs = await import('node:fs');
		const out = {};
		for (const [name, path] of Object.entries(roots)) {
			try { fs.readFileSync(path); out[name] = 'ALLOWED'; } catch (e) { out[name] = e.code ?? e.name; }
		}
		return out;
	} });`;
	const repo = fileURLToPath(new URL('../../../', import.meta.url));
	const { sandbox } = await open(() => child(), { 'evil/Paths': probe });
	try {
		const { 'evil/Paths': evil } = await sandbox.load(['evil/Paths']);
		const out = await evil!.paths!({
			ownSource: `${repo}packages/sandbox/src/inside.ts`,
			nodeModules: `${repo}node_modules/typescript/package.json`,
			gitConfig: `${repo}.git/config`,
			docs: `${repo}docs/architecture.md`,
			sibling: `${repo}packages/store/README.md`,
		}) as Record<string, string>;
		assert.equal(out.ownSource, 'ALLOWED', 'it can read the stack source it imports');
		assert.equal(out.nodeModules, 'ALLOWED', 'and the node_modules it resolves through');
		assert.equal(out.gitConfig, 'ERR_ACCESS_DENIED', 'but not the workspace .git');
		assert.equal(out.docs, 'ERR_ACCESS_DENIED', 'nor the docs');
		assert.equal(out.sibling, 'ALLOWED', 'a sibling package under packages/ is readable, which is why the wall matters');
	} finally {
		await sandbox.stop();
	}
});

test('child: the parent environment does not reach the room unless it is handed over', async () => {
	process.env['AWEFT_SECRET_PROBE'] = 'would leak';
	try {
		const { sandbox } = await open(() => child(), { 'evil/Probe': probe });
		try {
			const out = await (await sandbox.load(['evil/Probe']))['evil/Probe']!.probe!() as { env: string[] };
			assert.ok(!out.env.includes('AWEFT_SECRET_PROBE'), 'the secret stayed with the parent');
		} finally {
			await sandbox.stop();
		}
	} finally {
		delete process.env['AWEFT_SECRET_PROBE'];
	}
});

test('child: a room that dies mid-call rejects the call with closed rather than waiting', async () => {
	const { sandbox } = await open(() => child(), { 'evil/Probe': probe });
	const { 'evil/Probe': evil } = await sandbox.load(['evil/Probe']);
	assert.equal(await evil!.die!(), 'dying');
	await assert.rejects(evil!.loop!(), (e) => reasonOf(e) === 'closed');
	await sandbox.stop();
});

test('child: a room that ignores SIGTERM is killed anyway, and stop returns', async () => {
	const { sandbox } = await open(() => child(), { 'evil/Probe': probe });
	const { 'evil/Probe': evil } = await sandbox.load(['evil/Probe']);
	assert.equal(await evil!.stubborn!(), 'ignoring SIGTERM');
	const started = Date.now();
	await sandbox.stop();
	assert.ok(Date.now() - started < 5000, 'stop did not wait on a process that would not leave');
});

test('child: a room that corrupts its own channel loses the channel, and the host carries on', async () => {
	const { sandbox } = await open(() => child(), { 'evil/Probe': probe });
	const { 'evil/Probe': evil } = await sandbox.load(['evil/Probe']);
	const answer = evil!.corrupt!();
	await assert.rejects(answer, (e) => reasonOf(e) === 'closed');
	await sandbox.stop();
});

test('child: a wrap goes in front of the command, and a memory limit reaches the process', async () => {
	const { sandbox } = await open(() => child({ wrap: ['/usr/bin/env'], limits: { memoryMB: 64 } }), {
		'app/Flags': `export default () => ({ flags: () => process.execArgv.filter((f) => f.startsWith('--max-old') || f === '--permission') });`,
	});
	try {
		const { 'app/Flags': flags } = await sandbox.load(['app/Flags']);
		assert.deepEqual(await flags!.flags!(), ['--permission', '--max-old-space-size=64']);
	} finally {
		await sandbox.stop();
	}
});
