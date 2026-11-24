// googleMark: the mark an application's own Continue with Google button carries, the same one
// auth/SignIn draws.

import test from 'node:test';
import assert from 'node:assert/strict';

import { googleMark } from '../src/client.ts';

test('googleMark is Google\'s G in its four brand colours, square, for Icon', () => {
	assert.equal(googleMark.width, 48);
	assert.equal(googleMark.height, 48, 'a square mark sits on a button line without stretching');
	const fills = [...googleMark.body.matchAll(/<path fill="(#[0-9A-F]{6})"/g)].map((found) => found[1]);
	// The colours Google's sign-in branding guidelines name for the G: blue, green, yellow and red.
	assert.deepEqual(new Set(fills), new Set(['#4285F4', '#34A853', '#FBBC05', '#EA4335']));
	assert.equal(fills.length, 4, 'one filled path per colour, nothing else drawn');
});
