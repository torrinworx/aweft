// The public surface, by name. Written fromdesigns 077 to 080, never
// from the module, so an export that appears without being decided turns this red.

import test from 'node:test';
import assert from 'node:assert/strict';

import * as dom from '../src/index.ts';

test('the entry file exports exactly what was decided', () => {
	const decided = [
		'createDocument', 'createElement', 'createTextNode',
		'getFirst', 'h', 'htm', 'html', 'hydrate',
		'mount', 'parseHtml', 'render', 'setAttribute', 'toHtml', 'watch',
	];
	assert.deepEqual(Object.keys(dom).sort(), decided);
});
