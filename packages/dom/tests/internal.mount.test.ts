// White-box: what a removed mount lets go of. Nothing here is reachable through the public
// exports, because a dead child handle answers null to everything a caller could ask it.

import test from 'node:test';
import assert from 'node:assert/strict';

import { mutable } from '@aweftjs/core';

import type { Signal } from '../src/bound.ts';
import { createDocument, h, mount } from '../src/index.ts';

test('a removed mount drops the child handles it made, so the last mount is not held (design 204)', () => {
	const doc = createDocument();
	const item = h('p', {}, mutable('a'), mutable('b'), 'tail') as { signals: Signal[] };
	const held = (): boolean[] => item.signals.map((signal) => signal.kind === 'child' && signal.handle !== null);

	const stop = mount(doc.body, item as never);
	assert.deepEqual(held(), [true, true]);
	stop();
	// The nodes the mount put in are out of the element by now (design 204); a handle still on
	// the signal would keep them, and everything they close over, for as long as the branch
	// value lives, which for a slot's markup is as long as the component around it.
	assert.deepEqual(held(), [false, false]);

	const again = mount(doc.body, item as never);
	assert.deepEqual(held(), [true, true]);
	again();
	assert.deepEqual(held(), [false, false]);
});
