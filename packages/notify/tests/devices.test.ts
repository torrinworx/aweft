// notify/Devices: register, refresh, forget, the caps, the shapes refused, and a document no
// connection is ever handed.

import test from 'node:test';
import assert from 'node:assert/strict';

import type { Devices } from '../src/index.ts';

import { anyone, asUser, connectTo, reasonOf, started } from './helpers.ts';

const user = 'ada';

const devicesOf = (running: Awaited<ReturnType<typeof started>>): Devices => running.server.loader.get('notify/Devices') as Devices;

test('a page registers a device, refreshes it under the same id, and forgets it', async () => {
	const running = await started({ gate: asUser(user) });
	const a = await connectTo(running.handlers);
	assert.deepEqual(await a.asks.ask('notify/Devices', { register: { device: 'phone', platform: 'android', transport: 'fcm', endpoint: 'tok-1' } }), { devices: 1 });
	assert.deepEqual(await a.asks.ask('notify/Devices', { register: { device: 'phone', platform: 'android', transport: 'fcm', endpoint: 'tok-2' } }), { devices: 1 }, 'a refresh is not a second device');
	assert.deepEqual(await a.asks.ask('notify/Devices', { register: { device: 'tab', platform: 'web', transport: 'none' } }), { devices: 2 });
	const listed = await devicesOf(running).list(user);
	assert.deepEqual(Object.keys(listed).sort(), ['phone', 'tab']);
	assert.equal(listed.phone!.endpoint, 'tok-2');
	assert.equal(listed.tab!.endpoint, null);
	assert.equal(typeof listed.phone!.seenAt, 'number');
	assert.deepEqual(await a.asks.ask('notify/Devices', { forget: { device: 'phone' } }), { devices: 1 });
	assert.deepEqual(await a.asks.ask('notify/Devices', { forget: { device: 'never-there' } }), { devices: 1 });
	assert.deepEqual(Object.keys(await devicesOf(running).list(user)), ['tab']);
	a.socket.close();
	await running.stop();
});

test('a user has at most perUser devices, and a field out of shape is invalid-device with the fix on it', async () => {
	const running = await started({ gate: asUser(user), config: { './notify/Devices.ts': { config: { perUser: 2, endpointBytes: 8 } } } });
	const a = await connectTo(running.handlers);
	await a.asks.ask('notify/Devices', { register: { device: 'one', platform: 'ios', transport: 'fcm', endpoint: 'short' } });
	await a.asks.ask('notify/Devices', { register: { device: 'two', platform: 'ios', transport: 'fcm', endpoint: 'short' } });
	await assert.rejects(a.asks.ask('notify/Devices', { register: { device: 'three', platform: 'ios', transport: 'fcm', endpoint: 'short' } }), (error: unknown) => reasonOf(error) === 'capped');
	await a.asks.ask('notify/Devices', { register: { device: 'two', platform: 'ios', transport: 'none' } });
	for (const bad of [
		{ register: { device: 'has space', platform: 'ios', transport: 'fcm' } },
		{ register: { device: 'x'.repeat(65), platform: 'ios', transport: 'fcm' } },
		{ register: { device: 'ok', platform: 'watch', transport: 'fcm' } },
		{ register: { device: 'ok', platform: 'ios', transport: 'sms' } },
		{ register: { device: 'ok', platform: 'ios', transport: 'fcm', endpoint: 'nine char' } },
		{ register: { device: 'ok', platform: 'ios', transport: 'fcm', endpoint: 'ééééé' } },
		{ register: { device: 'ok', platform: 'ios', transport: 'fcm', endpoint: 7 } },
		{ register: { device: 'ok', platform: 'ios', transport: 'fcm', endpoint: '' } },
		{ register: 'phone' },
		{ forget: { device: '' } },
		{ forget: 'phone' },
		{},
		null,
	]) {
		await assert.rejects(a.asks.ask('notify/Devices', bad), (error: unknown) => {
			assert.equal(reasonOf(error), 'invalid-device', JSON.stringify(bad));
			return true;
		});
	}
	a.socket.close();
	await running.stop();
});

test('an anonymous connection has no device list, and a server with no store says so', async () => {
	const running = await started({ gate: anyone });
	const a = await connectTo(running.handlers);
	await assert.rejects(a.asks.ask('notify/Devices', { register: { device: 'x', platform: 'web', transport: 'none' } }), (error: unknown) => reasonOf(error) === 'anonymous');
	a.socket.close();
	await running.stop();
	const bare = await started({ store: null, gate: asUser(user) });
	const b = await connectTo(bare.handlers);
	await assert.rejects(b.asks.ask('notify/Devices', { register: { device: 'x', platform: 'web', transport: 'none' } }), (error: unknown) => reasonOf(error) === 'no-store');
	await assert.rejects(devicesOf(bare).list(user), (error: unknown) => reasonOf(error) === 'no-store');
	b.socket.close();
	await bare.stop();
});

test('the device list is never shared on a connection, and a user with none lists none', async () => {
	const running = await started({ gate: asUser(user) });
	assert.equal((devicesOf(running) as { connection?: unknown }).connection, undefined, 'no connection hook, so no topic to share it under');
	assert.deepEqual(await devicesOf(running).list(user), {});
	assert.equal(await running.store!.head(`devices:${user}`), 0, 'a read of a list nobody wrote writes nothing');
	await running.stop();
});

test('a configuration out of shape is invalid-config at load', async () => {
	for (const config of [{ perUser: 0 }, { endpointBytes: 'a lot' }]) {
		await assert.rejects(started({ config: { './notify/Devices.ts': { config } } }), (error: unknown) => reasonOf(error) === 'invalid-config');
	}
});

test('twenty devices is the default, and the twenty-first is refused', async () => {
	const running = await started({ gate: asUser(user) });
	const a = await connectTo(running.handlers);
	for (let n = 0; n < 20; n += 1) await a.asks.ask('notify/Devices', { register: { device: `d${String(n)}`, platform: 'web', transport: 'none' } });
	await assert.rejects(a.asks.ask('notify/Devices', { register: { device: 'd20', platform: 'web', transport: 'none' } }), (error: unknown) => reasonOf(error) === 'capped');
	assert.deepEqual(await a.asks.ask('notify/Devices', { register: { device: 'd0', platform: 'web', transport: 'none' } }), { devices: 20 }, 'a refresh of one of the twenty is not the twenty-first');
	a.socket.close();
	await running.stop();
});
