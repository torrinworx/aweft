// The tooltip trigger on its own (design 129). White box, because it is not exported.
//
// The delay is real time, so the tests use a short one and wait for it rather than replacing the
// clock: a fake clock would prove the code calls `setTimeout` and not that it waits.

import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';

import { mutable } from '@aweftjs/core';

import { tooltipTrigger } from '../src/tooltip-trigger.ts';

interface Listener { (event: unknown): void }

/** A node that records what was listened for and delivers events on demand. */
const trigger = (): {
	node: unknown;
	listeners: Map<string, Set<Listener>>;
	send(type: string): void;
} => {
	const listeners = new Map<string, Set<Listener>>();
	const node = {
		addEventListener: (type: string, listener: Listener) => {
			const set = listeners.get(type) ?? new Set<Listener>();
			set.add(listener);
			listeners.set(type, set);
		},
		removeEventListener: (type: string, listener: Listener) => { listeners.get(type)?.delete(listener); },
	};
	return { node, listeners, send: (type) => { for (const listener of [...listeners.get(type) ?? []]) listener({ type }); } };
};

/** A page, so the Escape half has something to listen on. */
const withPage = (): { send(type: string, event: Record<string, unknown>): void; uninstall(): void } => {
	const listeners = new Map<string, Set<Listener>>();
	const page = {
		addEventListener: (type: string, listener: Listener) => {
			const set = listeners.get(type) ?? new Set<Listener>();
			set.add(listener);
			listeners.set(type, set);
		},
		removeEventListener: (type: string, listener: Listener) => { listeners.get(type)?.delete(listener); },
	};
	const slot = globalThis as { document?: unknown };
	const had = 'document' in slot;
	const before = slot.document;
	slot.document = page;
	return {
		send: (type, event) => { for (const listener of [...listeners.get(type) ?? []]) listener(event); },
		uninstall: () => {
			if (had) slot.document = before;
			else delete slot.document;
		},
	};
};

test('a hover shows it after the pause, and not before', async () => {
	const anchor = trigger();
	const open = mutable(false);
	const page = withPage();
	try {
		const stop = tooltipTrigger({ nodes: () => [anchor.node], open, delay: 20 });

		anchor.send('mouseenter');
		assert.equal(open.get(), false, 'a pointer passing over it shows nothing');
		await sleep(40);
		assert.equal(open.get(), true, 'a pointer resting on it does');

		anchor.send('mouseleave');
		assert.equal(open.get(), false, 'and leaving hides it at once');
		stop();
	} finally {
		page.uninstall();
	}
});

test('a pointer that leaves before the pause is up shows nothing', async () => {
	const anchor = trigger();
	const open = mutable(false);
	const page = withPage();
	try {
		const stop = tooltipTrigger({ nodes: () => [anchor.node], open, delay: 40 });
		anchor.send('mouseenter');
		anchor.send('mouseleave');
		await sleep(80);
		assert.equal(open.get(), false, 'the pending timer was cancelled, not left to fire');
		stop();
	} finally {
		page.uninstall();
	}
});

test('focus shows it at once, because the keyboard arrived on purpose', () => {
	const anchor = trigger();
	const open = mutable(false);
	const page = withPage();
	try {
		const stop = tooltipTrigger({ nodes: () => [anchor.node], open, delay: 10_000 });
		anchor.send('focusin');
		assert.equal(open.get(), true, 'no wait for a keyboard');
		anchor.send('focusout');
		assert.equal(open.get(), false);
		stop();
	} finally {
		page.uninstall();
	}
});

test('Escape hides it', () => {
	const anchor = trigger();
	const open = mutable(false);
	const page = withPage();
	try {
		const stop = tooltipTrigger({ nodes: () => [anchor.node], open, delay: 0 });
		anchor.send('focusin');
		assert.equal(open.get(), true);

		page.send('keydown', { key: 'a' });
		assert.equal(open.get(), true, 'another key is not Escape');
		page.send('keydown', { key: 'Escape' });
		assert.equal(open.get(), false);
		stop();
	} finally {
		page.uninstall();
	}
});

test('a mousedown on the trigger leaves it up, and one anywhere else hides it', () => {
	const anchor = trigger();
	const open = mutable(false);
	const page = withPage();
	try {
		const stop = tooltipTrigger({ nodes: () => [anchor.node], open, delay: 0 });
		anchor.send('focusin');

		page.send('mousedown', { target: anchor.node });
		assert.equal(open.get(), true, 'clicking the thing the tip is about is not clicking away');
		page.send('mousedown', { target: { parentNode: null } });
		assert.equal(open.get(), false);
		stop();
	} finally {
		page.uninstall();
	}
});

test('the panel is asked for the top layer as a hint, and let go again', () => {
	const anchor = trigger();
	const open = mutable(false);
	const page = withPage();
	try {
		const asked: boolean[] = [];
		const attributes: [string, string][] = [];
		const panel = {
			isConnected: true,
			togglePopover: (force: boolean) => { asked.push(force); return force; },
			setAttribute: (name: string, value: string) => { attributes.push([name, value]); },
		};

		const stop = tooltipTrigger({ nodes: () => [anchor.node], panel: () => panel, open, delay: 0 });
		anchor.send('focusin');
		assert.deepEqual(attributes, [['popover', 'hint']],
			'hint, not manual: a tip does not close a menu that is already open');
		assert.deepEqual(asked, [true]);

		anchor.send('focusout');
		assert.deepEqual(asked, [true, false]);
		stop();
	} finally {
		page.uninstall();
	}
});

test('a panel on a host with no Popover API is left alone', () => {
	const anchor = trigger();
	const open = mutable(false);
	const page = withPage();
	try {
		const attributes: [string, string][] = [];
		const panel = { setAttribute: (name: string, value: string) => { attributes.push([name, value]); } };
		const stop = tooltipTrigger({ nodes: () => [anchor.node], panel: () => panel, open, delay: 0 });

		anchor.send('focusin');
		assert.equal(open.get(), true, 'it still shows');
		assert.deepEqual(attributes, [], 'and nothing was written on the panel');
		stop();
	} finally {
		page.uninstall();
	}
});

test('the teardown takes every listener off and cancels the pending timer', async () => {
	const anchor = trigger();
	const open = mutable(false);
	const page = withPage();
	try {
		const stop = tooltipTrigger({ nodes: () => [anchor.node], open, delay: 20 });
		anchor.send('mouseenter');
		stop();

		await sleep(40);
		assert.equal(open.get(), false, 'the timer that was in flight did not fire');
		for (const type of ['mouseenter', 'mouseleave', 'focusin', 'focusout']) {
			assert.equal(anchor.listeners.get(type)?.size, 0, `${type} was removed`);
		}
		page.send('keydown', { key: 'Escape' });
		assert.equal(open.get(), false);
	} finally {
		page.uninstall();
	}
});

/** A host that hands out frames on demand, so a retry loop is countable. */
const withFrames = (): {
	run(): void;
	asked: number;
	cancelled: number[];
	uninstall(): void;
} => {
	const slot = globalThis as {
		requestAnimationFrame?: (fn: () => void) => number;
		cancelAnimationFrame?: (id: number) => void;
	};
	const had = {
		request: 'requestAnimationFrame' in slot ? slot.requestAnimationFrame : undefined,
		cancel: 'cancelAnimationFrame' in slot ? slot.cancelAnimationFrame : undefined,
	};
	const queued = new Map<number, () => void>();
	const state = {
		asked: 0,
		cancelled: [] as number[],
		run: (): void => {
			for (const [id, fn] of [...queued]) {
				queued.delete(id);
				fn();
			}
		},
		uninstall: (): void => {
			if (had.request === undefined) delete slot.requestAnimationFrame;
			else slot.requestAnimationFrame = had.request;
			if (had.cancel === undefined) delete slot.cancelAnimationFrame;
			else slot.cancelAnimationFrame = had.cancel;
		},
	};
	slot.requestAnimationFrame = (fn: () => void): number => {
		state.asked += 1;
		queued.set(state.asked, fn);
		return state.asked;
	};
	slot.cancelAnimationFrame = (id: number): void => { state.cancelled.push(id); queued.delete(id); };
	return state;
};

test('a panel that never joins the document stops being asked for', () => {
	const anchor = trigger();
	const open = mutable(false);
	const page = withPage();
	const frames = withFrames();
	try {
		const panel = {
			isConnected: false,
			togglePopover: (): boolean => true,
			setAttribute: (): void => undefined,
		};
		const stop = tooltipTrigger({ nodes: () => [anchor.node], panel: () => panel, open, delay: 0 });
		anchor.send('focusin');

		for (let at = 0; at < 40; at += 1) frames.run();
		assert.equal(frames.asked, 10, 'ten frames and then it gives up, rather than for the life of the page');
		stop();
	} finally {
		frames.uninstall();
		page.uninstall();
	}
});

test('the teardown cancels the frame it was waiting on', () => {
	const anchor = trigger();
	const open = mutable(false);
	const page = withPage();
	const frames = withFrames();
	try {
		const panel = {
			isConnected: false,
			togglePopover: (): boolean => true,
			setAttribute: (): void => undefined,
		};
		const stop = tooltipTrigger({ nodes: () => [anchor.node], panel: () => panel, open, delay: 0 });
		anchor.send('focusin');
		assert.equal(frames.asked, 1, 'one frame is out');

		stop();
		assert.deepEqual(frames.cancelled, [1], 'and the teardown took it back');

		frames.run();
		assert.equal(frames.asked, 1, 'nothing is asked for after the teardown');
	} finally {
		frames.uninstall();
		page.uninstall();
	}
});
