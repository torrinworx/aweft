// The drag behaviour on its own (design 221). White box, because it is not exported.
//
// The maths is a box and a point, so the box here is a fake one with numbers chosen by hand rather
// than measured off a layout: what a real element and a real pointer add is in `browser.test.ts`.

import test from 'node:test';
import assert from 'node:assert/strict';

import { drag } from '../src/drag.ts';

interface Box { left: number; top: number; width: number; height: number }

/** An element with a box of its own, recording what it was asked to capture and release. */
const boxed = (box: Box): {
	node: unknown;
	captured: number[];
	released: number[];
} => {
	const captured: number[] = [];
	const released: number[] = [];
	return {
		node: {
			getBoundingClientRect: () => box,
			setPointerCapture: (id: number) => { captured.push(id); },
			releasePointerCapture: (id: number) => { released.push(id); },
		},
		captured,
		released,
	};
};

/** A pointer event as the host sends one, with the element under it. */
const at = (node: unknown, x: number, y: number, id = 7): Record<string, unknown> => {
	let stopped = 0;
	return {
		currentTarget: node,
		pointerId: id,
		clientX: x,
		clientY: y,
		preventDefault: () => { stopped += 1; },
		get prevented(): number { return stopped; },
	};
};

/** A key event, with somewhere to record whether the default was taken away. */
const key = (name: string, shift = false): Record<string, unknown> => {
	const event: Record<string, unknown> = { key: name, shiftKey: shift, prevented: 0 };
	event['preventDefault'] = (): void => { event['prevented'] = (event['prevented'] as number) + 1; };
	return event;
};

// --- the maths -----------------------------------------------------------------------------------

test('a press reports where in the box it landed, as a fraction of each side', () => {
	const element = boxed({ left: 100, top: 50, width: 200, height: 100 });
	const moves: { x: number; y: number }[] = [];
	const grip = drag({ axes: 'xy', at: () => ({ x: 0, y: 0 }), onMove: (to) => { moves.push(to); } });

	// Four corners and the middle, each worked out by hand off the box above.
	for (const [x, y] of [[100, 50], [300, 150], [200, 100], [150, 75]] as [number, number][]) {
		grip.pointer.onPointerDown(at(element.node, x, y));
		grip.pointer.onPointerUp(at(element.node, x, y));
	}
	assert.deepEqual(moves, [
		{ x: 0, y: 0 },
		{ x: 1, y: 1 },
		{ x: 0.5, y: 0.5 },
		{ x: 0.25, y: 0.25 },
	]);
});

test('a press outside the box is the nearest edge, not a number past the end', () => {
	const element = boxed({ left: 0, top: 0, width: 100, height: 100 });
	const moves: { x: number; y: number }[] = [];
	const grip = drag({ axes: 'xy', at: () => ({ x: 0.5, y: 0.5 }), onMove: (to) => { moves.push(to); } });

	grip.pointer.onPointerDown(at(element.node, -40, 260));
	grip.pointer.onPointerMove(at(element.node, 500, -12));
	assert.deepEqual(moves, [{ x: 0, y: 1 }, { x: 1, y: 0 }],
		'a drag that leaves the box holds at the edge it left by');
});

test('a box with no width answers the near end rather than dividing by nothing', () => {
	const element = boxed({ left: 10, top: 10, width: 0, height: 0 });
	const moves: { x: number; y: number }[] = [];
	const grip = drag({ axes: 'xy', at: () => ({ x: 0.5, y: 0.5 }), onMove: (to) => { moves.push(to); } });

	grip.pointer.onPointerDown(at(element.node, 40, 40));
	assert.deepEqual(moves, [{ x: 0, y: 0 }], 'an element with no box yet is not a NaN');
});

test('an axis the caller left out keeps the value it already had', () => {
	const element = boxed({ left: 0, top: 0, width: 100, height: 100 });
	const moves: { x: number; y: number }[] = [];
	const grip = drag({ axes: 'x', at: () => ({ x: 0, y: 0.75 }), onMove: (to) => { moves.push(to); } });

	grip.pointer.onPointerDown(at(element.node, 20, 90));
	assert.deepEqual(moves, [{ x: 0.2, y: 0.75 }],
		'the horizontal moved and the vertical is what the caller says it is');
});

// --- the capture ---------------------------------------------------------------------------------

test('a press captures the pointer and a release gives it back', () => {
	const element = boxed({ left: 0, top: 0, width: 100, height: 100 });
	const grip = drag({ axes: 'xy', at: () => ({ x: 0, y: 0 }), onMove: () => undefined });

	grip.pointer.onPointerDown(at(element.node, 10, 10, 42));
	assert.deepEqual(element.captured, [42], 'the element holds the pointer for the whole drag');
	assert.deepEqual(element.released, []);

	grip.pointer.onPointerUp(at(element.node, 10, 10, 42));
	assert.deepEqual(element.released, [42]);
});

test('a move after the release moves nothing', () => {
	const element = boxed({ left: 0, top: 0, width: 100, height: 100 });
	const moves: { x: number; y: number }[] = [];
	const grip = drag({ axes: 'xy', at: () => ({ x: 0, y: 0 }), onMove: (to) => { moves.push(to); } });

	grip.pointer.onPointerDown(at(element.node, 10, 10));
	grip.pointer.onPointerMove(at(element.node, 20, 20));
	grip.pointer.onPointerUp(at(element.node, 20, 20));
	grip.pointer.onPointerMove(at(element.node, 90, 90));
	assert.deepEqual(moves, [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }],
		'a pointer merely passing over the box afterwards drags nothing');
});

test('a cancelled pointer releases the same way a lifted one does', () => {
	const element = boxed({ left: 0, top: 0, width: 100, height: 100 });
	const moves: { x: number; y: number }[] = [];
	const grip = drag({ axes: 'xy', at: () => ({ x: 0, y: 0 }), onMove: (to) => { moves.push(to); } });

	grip.pointer.onPointerDown(at(element.node, 10, 10, 3));
	grip.pointer.onPointerCancel(at(element.node, 10, 10, 3));
	assert.deepEqual(element.released, [3]);
	grip.pointer.onPointerMove(at(element.node, 90, 90));
	assert.equal(moves.length, 1, 'and the drag is over');
});

test('a move nobody pressed for moves nothing', () => {
	const element = boxed({ left: 0, top: 0, width: 100, height: 100 });
	const moves: unknown[] = [];
	const grip = drag({ axes: 'xy', at: () => ({ x: 0, y: 0 }), onMove: (to) => { moves.push(to); } });

	grip.pointer.onPointerMove(at(element.node, 50, 50));
	assert.deepEqual(moves, [], 'the pointer is over the box and no button is down');
});

test('a second pointer during a drag is ignored', () => {
	// A second finger on a touch screen. Its id is not the one that was captured, so it is not the
	// drag in progress and it does not steal it.
	const element = boxed({ left: 0, top: 0, width: 100, height: 100 });
	const moves: { x: number; y: number }[] = [];
	const grip = drag({ axes: 'xy', at: () => ({ x: 0, y: 0 }), onMove: (to) => { moves.push(to); } });

	grip.pointer.onPointerDown(at(element.node, 10, 10, 1));
	grip.pointer.onPointerMove(at(element.node, 80, 80, 2));
	assert.deepEqual(moves, [{ x: 0.1, y: 0.1 }]);
});

// --- the keyboard --------------------------------------------------------------------------------

test('the arrows step one axis each, and Shift makes the step coarse', () => {
	const moves: { x: number; y: number }[] = [];
	let held = { x: 0.5, y: 0.5 };
	const grip = drag({
		axes: 'xy',
		step: 0.01,
		coarse: 0.1,
		at: () => held,
		onMove: (to) => { held = to; moves.push(to); },
	});

	grip.keys.onKeyDown(key('ArrowRight'));
	grip.keys.onKeyDown(key('ArrowDown'));
	grip.keys.onKeyDown(key('ArrowLeft', true));
	grip.keys.onKeyDown(key('ArrowUp', true));
	// Rounded, because a fraction added and taken away again is not exactly what it started as.
	const round = (value: number): number => Math.round(value * 1000) / 1000;
	assert.deepEqual(moves.map((to) => [round(to.x), round(to.y)]), [
		[0.51, 0.5],
		[0.51, 0.51],
		[0.41, 0.51],
		[0.41, 0.41],
	], 'up is towards the top of the box, which is the small end of y');
});

test('a step the caller did not name is one hundredth, and Shift is ten of them', () => {
	const moves: { x: number; y: number }[] = [];
	let held = { x: 0.5, y: 0.5 };
	const grip = drag({ axes: 'xy', at: () => held, onMove: (to) => { held = to; moves.push(to); } });

	grip.keys.onKeyDown(key('ArrowRight'));
	grip.keys.onKeyDown(key('ArrowRight', true));
	const round = (value: number): number => Math.round(value * 1000) / 1000;
	assert.deepEqual(moves.map((to) => round(to.x)), [0.51, 0.61]);
});

test('Home and End go to the ends of the first axis in play', () => {
	const moves: { x: number; y: number }[] = [];
	const grip = drag({ axes: 'xy', at: () => ({ x: 0.4, y: 0.4 }), onMove: (to) => { moves.push(to); } });
	grip.keys.onKeyDown(key('Home'));
	grip.keys.onKeyDown(key('End'));
	assert.deepEqual(moves, [{ x: 0, y: 0.4 }, { x: 1, y: 0.4 }]);

	// With only the vertical in play there is no first axis but the vertical, so that is the one
	// the two ends reach. Otherwise the two keys do nothing at all on a vertical control.
	const down: { x: number; y: number }[] = [];
	const vertical = drag({ axes: 'y', at: () => ({ x: 0.4, y: 0.4 }), onMove: (to) => { down.push(to); } });
	vertical.keys.onKeyDown(key('Home'));
	vertical.keys.onKeyDown(key('End'));
	assert.deepEqual(down, [{ x: 0.4, y: 0 }, { x: 0.4, y: 1 }]);
});

test('a key steps to the end and no further', () => {
	const moves: { x: number; y: number }[] = [];
	let held = { x: 0.98, y: 0.02 };
	const grip = drag({ axes: 'xy', at: () => held, onMove: (to) => { held = to; moves.push(to); } });

	grip.keys.onKeyDown(key('ArrowRight', true));
	grip.keys.onKeyDown(key('ArrowUp', true));
	assert.deepEqual(moves, [{ x: 1, y: 0.02 }, { x: 1, y: 0 }]);
});

test('an axis the caller left out has no keys', () => {
	const moves: unknown[] = [];
	const grip = drag({ axes: 'x', at: () => ({ x: 0.5, y: 0.5 }), onMove: (to) => { moves.push(to); } });
	grip.keys.onKeyDown(key('ArrowUp'));
	grip.keys.onKeyDown(key('ArrowDown'));
	assert.deepEqual(moves, [], 'a horizontal drag does not answer the vertical arrows');
});

test('a key that moved takes the default away, and one that did not leaves it', () => {
	const grip = drag({ axes: 'xy', at: () => ({ x: 0.5, y: 0.5 }), onMove: () => undefined });

	const moved = key('ArrowRight');
	grip.keys.onKeyDown(moved);
	assert.equal(moved['prevented'], 1, 'an arrow inside the box does not also scroll the page');

	const other = key('a');
	grip.keys.onKeyDown(other);
	assert.equal(other['prevented'], 0, 'and a key this behaviour has no use for is left alone');
});

// --- disabled ------------------------------------------------------------------------------------

test('a disabled drag answers neither the pointer nor the keyboard', () => {
	const element = boxed({ left: 0, top: 0, width: 100, height: 100 });
	const moves: unknown[] = [];
	const grip = drag({
		axes: 'xy',
		at: () => ({ x: 0.5, y: 0.5 }),
		onMove: (to) => { moves.push(to); },
		disabled: () => true,
	});

	grip.pointer.onPointerDown(at(element.node, 10, 10));
	grip.pointer.onPointerMove(at(element.node, 90, 90));
	grip.keys.onKeyDown(key('End'));
	assert.deepEqual(moves, []);
	assert.deepEqual(element.captured, [], 'and nothing was captured, so nothing has to be given back');
});

// --- what the host may not have --------------------------------------------------------------

test('a host with no pointer capture still drags', () => {
	// `setPointerCapture` is the host keeping the events coming while the pointer is off the
	// element. Where it is missing the drag is the behaviour's own flag, which is why the flag is
	// what the move reads rather than asking the host whether it still has the pointer.
	const bare = {
		getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
	};
	const moves: { x: number; y: number }[] = [];
	const grip = drag({ axes: 'xy', at: () => ({ x: 0, y: 0 }), onMove: (to) => { moves.push(to); } });

	grip.pointer.onPointerDown(at(bare, 10, 10));
	grip.pointer.onPointerMove(at(bare, 30, 30));
	grip.pointer.onPointerUp(at(bare, 30, 30));
	assert.deepEqual(moves, [{ x: 0.1, y: 0.1 }, { x: 0.3, y: 0.3 }]);
});

test('an event with no element under it moves nothing', () => {
	const moves: unknown[] = [];
	const grip = drag({ axes: 'xy', at: () => ({ x: 0, y: 0 }), onMove: (to) => { moves.push(to); } });
	grip.pointer.onPointerDown({ pointerId: 1, clientX: 5, clientY: 5 });
	assert.deepEqual(moves, []);
});

test('the event target stands in for the element the handler is on', () => {
	// A light tree delivers an event with a `target` and no `currentTarget`, and a host delivers
	// both. The box is the element the handler is written on, so `currentTarget` comes first.
	const element = boxed({ left: 0, top: 0, width: 100, height: 100 });
	const moves: { x: number; y: number }[] = [];
	const grip = drag({ axes: 'xy', at: () => ({ x: 0, y: 0 }), onMove: (to) => { moves.push(to); } });

	grip.pointer.onPointerDown({ target: element.node, pointerId: 1, clientX: 60, clientY: 20 });
	assert.deepEqual(moves, [{ x: 0.6, y: 0.2 }]);
});
