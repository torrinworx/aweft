// Coming back: the delays, the reset, and the two moments a browser knows before a timer does.
//
// Every socket here refuses to open, so the run is the backoff and nothing else, and the clock
// is Node's mock so the arithmetic is asserted rather than waited out.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createClient } from '../src/index.ts';

import { opens, socketPair, spin } from './helpers.ts';
import type { PairedSocket } from '@aweftjs/testing';

/** Sockets that drop the moment they are made, and the list of them. */
const failing = (openable: () => boolean = () => false): { open(): PairedSocket; sockets: PairedSocket[] } => {
	const sockets: PairedSocket[] = [];
	return {
		sockets,
		open: () => {
			const [socket] = socketPair(0);
			sockets.push(socket);
			queueMicrotask(() => {
				if (openable()) opens(socket);
				else socket.close();
			});
			return socket;
		},
	};
};

test('the backoff doubles from 500 ms and stops at 10 000', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const dial = failing();
	const client = createClient({ url: 'ws://app.test/', open: dial.open });
	await spin();
	assert.equal(dial.sockets.length, 1, 'the first socket is made at once');

	const at = async (ms: number): Promise<number> => {
		t.mock.timers.tick(ms);
		await spin();
		return dial.sockets.length;
	};

	assert.equal(await at(499), 1);
	assert.equal(await at(1), 2, 'the first retry is 500 ms after the drop');
	assert.equal(await at(999), 2);
	assert.equal(await at(1), 3, 'the second is 1000 ms after that, so 1500 in');
	assert.equal(await at(2000), 4, 'then 2000, so 3500 in');
	assert.equal(await at(4000), 5);
	assert.equal(await at(8000), 6);
	assert.equal(await at(9999), 6);
	assert.equal(await at(1), 7, 'and the delay stops doubling at 10 000');
	assert.equal(await at(10_000), 8, 'every wait after that is the same 10 000');

	client.close();
});

test('a socket that opens puts the delay back to 500 ms', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	let works = false;
	const dial = failing(() => works);
	const client = createClient({ url: 'ws://app.test/', open: dial.open });
	await spin();

	t.mock.timers.tick(500);
	await spin();
	assert.equal(dial.sockets.length, 2, 'two failures, so the next wait is 1000');

	works = true;
	t.mock.timers.tick(1000);
	await spin();
	assert.equal(dial.sockets.length, 3);
	assert.equal(client.status.get(), 'open');

	works = false;
	dial.sockets[2]!.close();
	await spin();
	assert.equal(client.status.get(), 'closed');

	t.mock.timers.tick(499);
	await spin();
	assert.equal(dial.sockets.length, 3, 'the wait after a socket that opened is 500 again');
	t.mock.timers.tick(1);
	await spin();
	assert.equal(dial.sockets.length, 4);

	client.close();
});

test('reconnect drops the socket and opens a new one now', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const dial = failing(() => true);
	const client = createClient({ url: 'ws://app.test/', open: dial.open, reconnect: false });
	await spin();
	assert.equal(client.status.get(), 'open');

	client.reconnect();
	assert.equal(dial.sockets.length, 2);
	assert.equal(dial.sockets[0]!.readyState, 3, 'the old socket is closed');
	await spin();
	assert.equal(client.status.get(), 'open');

	client.close();
});

test('reconnect puts the delay back to 500 ms as well', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const dial = failing();
	const client = createClient({ url: 'ws://app.test/', open: dial.open });
	await spin();
	t.mock.timers.tick(500);
	await spin();
	assert.equal(dial.sockets.length, 2, 'two failures, so the next wait would have been 1000');

	client.reconnect();
	await spin();
	assert.equal(dial.sockets.length, 3);
	t.mock.timers.tick(499);
	await spin();
	assert.equal(dial.sockets.length, 3);
	t.mock.timers.tick(1);
	await spin();
	assert.equal(dial.sockets.length, 4, 'the wait after a reconnect is 500 again');

	client.close();
});

/** A stand-in for the two page globals, installed for one test and taken away after it. */
interface Shim {
	fire(where: 'global' | 'page', type: string): void;
	visible(state: string): void;
	count(): number;
	remove(): void;
}

const shim = (): Shim => {
	const global = new Map<string, Set<() => void>>();
	const page = new Map<string, Set<() => void>>();
	const of = (map: Map<string, Set<() => void>>, type: string): Set<() => void> => {
		const held = map.get(type) ?? new Set<() => void>();
		map.set(type, held);
		return held;
	};
	const listeners = (map: Map<string, Set<() => void>>) => ({
		addEventListener: (type: string, fn: () => void) => { of(map, type).add(fn); },
		removeEventListener: (type: string, fn: () => void) => { of(map, type).delete(fn); },
	});

	const document = { visibilityState: 'hidden', ...listeners(page) };
	const target = globalThis as unknown as Record<string, unknown>;
	Object.assign(target, listeners(global), { document });

	return {
		fire: (where, type) => {
			for (const fn of [...of(where === 'global' ? global : page, type)]) fn();
		},
		visible: (state) => { document.visibilityState = state; },
		count: () => [...global.values(), ...page.values()].reduce((n, set) => n + set.size, 0),
		remove: () => {
			delete target.addEventListener;
			delete target.removeEventListener;
			delete target.document;
		},
	};
};

test('online and a tab becoming visible try at once, and close lets go of both', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const page = shim();
	try {
		const dial = failing();
		const client = createClient({ url: 'ws://app.test/', open: dial.open });
		await spin();
		assert.equal(page.count(), 2, 'both listeners are on');
		assert.equal(dial.sockets.length, 1);

		// The second one lands while the attempt it caused is still in flight, and must do nothing.
		page.fire('global', 'online');
		page.fire('global', 'online');
		await spin();
		assert.equal(dial.sockets.length, 2, 'online tries once, without waiting out the delay');

		page.fire('page', 'visibilitychange');
		await spin();
		assert.equal(dial.sockets.length, 2, 'a tab that is still hidden is not a reason to try');

		page.visible('visible');
		page.fire('page', 'visibilitychange');
		await spin();
		assert.equal(dial.sockets.length, 3);

		client.close();
		assert.equal(page.count(), 0, 'close lets go of both listeners');
	} finally {
		page.remove();
	}
});

test('reconnect false listens for neither global', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const page = shim();
	try {
		const dial = failing();
		const client = createClient({ url: 'ws://app.test/', open: dial.open, reconnect: false });
		await spin();
		assert.equal(page.count(), 0);
		assert.equal(dial.sockets.length, 1);

		t.mock.timers.tick(60_000);
		await spin();
		assert.equal(dial.sockets.length, 1, 'nothing retries on its own');
		client.close();
	} finally {
		page.remove();
	}
});

test('a socket seam that throws from the retry timer is a drop, not an error the page loses', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const sockets: PairedSocket[] = [];
	let attempts = 0;
	const client = createClient({
		url: 'ws://app.test/',
		// A browser's WebSocket constructor refuses this way, and it refuses on every attempt
		// rather than only the first.
		open: () => {
			attempts += 1;
			if (attempts === 2) throw new Error('the browser refused to make the socket');
			const [socket] = socketPair(0);
			sockets.push(socket);
			return socket;
		},
	});
	await spin();
	assert.equal(attempts, 1, 'the first attempt is made under the caller');

	sockets[0]!.close();
	await spin();
	assert.equal(client.status.get(), 'closed');

	t.mock.timers.tick(500);
	await spin();
	assert.equal(attempts, 2, 'the retry ran and the seam refused');
	assert.equal(client.status.get(), 'closed', 'a seam that refuses reads as a drop');

	t.mock.timers.tick(1000);
	await spin();
	assert.equal(attempts, 3, 'and the backoff went on to the next delay');
	assert.equal(client.status.get(), 'connecting');

	client.close();
});
