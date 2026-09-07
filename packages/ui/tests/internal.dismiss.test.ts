// The dismiss behaviour on its own (design 129). White box, because it is not exported.
//
// Both halves listen on the page, so these tests install a page around the call and take it away
// after, which is the same shape design 121 uses for the router's browser path.

import test from 'node:test';
import assert from 'node:assert/strict';

import { dismiss } from '../src/dismiss.ts';

interface Listener { (event: unknown): void }

/** A stand-in page: it records what was listened for, and delivers events on demand. */
const fakePage = (): {
	listeners: Map<string, Set<Listener>>;
	send(type: string, event: Record<string, unknown>): void;
	install(): () => void;
} => {
	const listeners = new Map<string, Set<Listener>>();
	const page = {
		addEventListener: (type: string, listener: Listener) => {
			const set = listeners.get(type) ?? new Set<Listener>();
			set.add(listener);
			listeners.set(type, set);
		},
		removeEventListener: (type: string, listener: Listener) => {
			listeners.get(type)?.delete(listener);
		},
	};
	return {
		listeners,
		send: (type, event) => { for (const listener of [...listeners.get(type) ?? []]) listener(event); },
		install: () => {
			const slot = globalThis as { document?: unknown };
			const had = 'document' in slot;
			const before = slot.document;
			slot.document = page;
			return () => {
				if (had) slot.document = before;
				else delete slot.document;
			};
		},
	};
};

/** A node with a parent chain, which is what the outside test walks. */
const node = (parent: unknown = null): { parentNode: unknown } => ({ parentNode: parent });

test('a mousedown outside closes it, and one inside does not', () => {
	const page = fakePage();
	const uninstall = page.install();
	try {
		const panel = node();
		const inside = node(panel);
		const outside = node();
		const closed: unknown[] = [];

		const stop = dismiss({
			inside: () => [panel],
			active: () => true,
			onDismiss: (event) => closed.push(event),
		});

		page.send('mousedown', { target: inside });
		assert.deepEqual(closed, [], 'a click on something inside the panel is not a click away from it');

		page.send('mousedown', { target: outside });
		assert.equal(closed.length, 1, 'a click anywhere else closed it');
		stop();
	} finally {
		uninstall();
	}
});

test('nothing is dismissed while it is not showing', () => {
	const page = fakePage();
	const uninstall = page.install();
	try {
		let showing = false;
		const closed: unknown[] = [];
		const stop = dismiss({
			inside: () => [],
			active: () => showing,
			onDismiss: () => closed.push(1),
		});

		page.send('mousedown', { target: node() });
		assert.deepEqual(closed, [], 'a click while it is closed closes nothing');

		showing = true;
		page.send('mousedown', { target: node() });
		assert.equal(closed.length, 1);
		stop();
	} finally {
		uninstall();
	}
});

test('canClose can refuse a click', () => {
	const page = fakePage();
	const uninstall = page.install();
	try {
		let allow = false;
		const closed: unknown[] = [];
		const stop = dismiss({
			inside: () => [],
			active: () => true,
			canClose: () => allow,
			onDismiss: () => closed.push(1),
		});

		page.send('mousedown', { target: node() });
		assert.deepEqual(closed, []);
		allow = true;
		page.send('mousedown', { target: node() });
		assert.equal(closed.length, 1);
		stop();
	} finally {
		uninstall();
	}
});

test('Escape closes it only when the caller asked for Escape', () => {
	const page = fakePage();
	const uninstall = page.install();
	try {
		const quiet: unknown[] = [];
		const stopQuiet = dismiss({ inside: () => [], active: () => true, onDismiss: () => quiet.push(1) });
		assert.equal(page.listeners.get('keydown'), undefined, 'no key listener was installed at all');
		stopQuiet();

		const closed: unknown[] = [];
		const stop = dismiss({
			inside: () => [],
			active: () => true,
			escape: true,
			onDismiss: () => closed.push(1),
		});

		page.send('keydown', { key: 'a' });
		assert.deepEqual(closed, [], 'another key is not Escape');
		page.send('keydown', { key: 'Escape' });
		assert.equal(closed.length, 1);
		stop();
	} finally {
		uninstall();
	}
});

test('the teardown takes both listeners off', () => {
	const page = fakePage();
	const uninstall = page.install();
	try {
		const closed: unknown[] = [];
		const stop = dismiss({
			inside: () => [],
			active: () => true,
			escape: true,
			onDismiss: () => closed.push(1),
		});
		assert.equal(page.listeners.get('mousedown')?.size, 1);
		assert.equal(page.listeners.get('keydown')?.size, 1);

		stop();
		assert.equal(page.listeners.get('mousedown')?.size, 0);
		assert.equal(page.listeners.get('keydown')?.size, 0);

		page.send('mousedown', { target: node() });
		page.send('keydown', { key: 'Escape' });
		assert.deepEqual(closed, [], 'and nothing arrives after it');
	} finally {
		uninstall();
	}
});

test('with no page it installs nothing and the teardown is safe to call', () => {
	const slot = globalThis as { document?: unknown };
	const had = 'document' in slot;
	const before = slot.document;
	delete slot.document;
	try {
		const stop = dismiss({ inside: () => [], active: () => true, onDismiss: () => undefined });
		assert.doesNotThrow(stop);
	} finally {
		if (had) slot.document = before;
	}
});
