// The scored placement solver (design 113). A pure function of four numbers, so it is checked
// exhaustively with no browser, which is what leaves the browser suite only what needs a browser.
//
// Every expected answer here is worked out by hand from the rule, not read off a run.

import test from 'node:test';
import assert from 'node:assert/strict';

import { CORNERS, PLACEMENTS, SIDES, place } from '../src/placement.ts';

const view = { width: 1000, height: 800 };
const middle = { left: 400, top: 300, width: 100, height: 40 };
const popup = { width: 200, height: 120 };

test('a popup with room everywhere takes the first mode the caller asked for', () => {
	// The anchor is in the middle and every corner mode fits, so the preference decides.
	assert.equal(place(middle, popup, view, ['above-end', 'below-start'])!.mode, 'above-end');
	assert.equal(place(middle, popup, view, ['below-start', 'above-end'])!.mode, 'below-start');
});

test('a corner mode puts the popup at the corner it names', () => {
	const below = place(middle, popup, view, ['below-start'])!;
	assert.equal(below.left, 400);
	assert.equal(below.top, 340, 'directly under the anchor');
	assert.equal(below.transformOrigin, 'top left');

	const above = place(middle, popup, view, ['above-end'])!;
	assert.equal(above.left, 300, 'right edges lined up: 500 minus the popup width');
	assert.equal(above.top, 180, 'directly above: 300 minus the popup height');
});

test('a side mode centres the popup on the edge it faces', () => {
	const below = place(middle, popup, view, ['below'])!;
	assert.equal(below.left, 350, 'centred: 400 plus half of 100 minus half of 200');
	assert.equal(below.top, 340);
	assert.equal(below.transformOrigin, 'top center');
});

test('a side mode with no room in its direction is rejected before it is scored', () => {
	// 30 pixels of room above and the popup wants 120, so `above` cannot be honoured at all.
	const tight = { left: 400, top: 30, width: 100, height: 40 };
	assert.equal(place(tight, popup, view, ['above']), null, 'the one mode asked for had no room');
	assert.equal(place(tight, popup, view, ['above', 'below'])!.mode, 'below');
	// The corner mode is not rejected the same way: it is scored on how much of it shows.
	assert.equal(place(tight, popup, view, ['above-start'])!.mode, 'above-start');
});

test('among the side modes with room, the closest one wins', () => {
	// The anchor is a wide, short bar: `below` puts the popup's centre 60 away from the edge
	// midpoint, and `right` puts it 100 plus half the popup's height away, so `below` is closer.
	const bar = { left: 300, top: 300, width: 400, height: 40 };
	assert.equal(place(bar, popup, view, ['right', 'below'])!.mode, 'below');
});

test('when nothing fits, the mode showing the most of the popup wins', () => {
	// Hard against the top left. `above-start` would show none of it, `below-start` all of it.
	const corner = { left: 0, top: 0, width: 40, height: 20 };
	const small = { width: 900, height: 700 };
	const chosen = place(corner, small, { width: 1000, height: 400 }, ['above-start', 'below-start'])!;
	assert.equal(chosen.mode, 'below-start');
});

test('the box is nudged back onto the screen, and says what room is left', () => {
	const edge = { left: 950, top: 760, width: 40, height: 20 };
	const chosen = place(edge, popup, view, ['below-start'])!;
	assert.equal(chosen.left, 800, 'pushed left so the popup ends at the right edge');
	assert.equal(chosen.top, 680, 'pushed up so it ends at the bottom edge');
	assert.equal(chosen.maxWidth, 200);
	assert.equal(chosen.maxHeight, 120);
});

test('every mode has an origin, and the two lists together are the twelve', () => {
	assert.equal(CORNERS.length, 8);
	assert.equal(SIDES.length, 4);
	assert.equal(PLACEMENTS.length, 12);
	assert.equal(new Set(PLACEMENTS).size, 12, 'no mode is named twice');
	for (const mode of PLACEMENTS) {
		const chosen = place(middle, { width: 10, height: 10 }, view, [mode]);
		assert.ok(chosen !== null, `${mode} was rejected with room everywhere`);
		assert.match(chosen!.transformOrigin, /^(top|bottom|center) (left|right|center)$/, `${mode} has no origin`);
	}
});

test('an empty list means every corner mode', () => {
	assert.equal(place(middle, popup, view, [])!.mode, 'below-start');
	assert.equal(place(middle, popup, view)!.mode, 'below-start');
});
