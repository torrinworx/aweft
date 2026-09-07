// How `ui`'s template reaches the elements inside a `dom` instance (design 108).
//
// White-box, because the mechanism is not something a caller can see: the marker rides in as a
// property `dom` files as a signal, and `ui` takes it back out before the instance is mounted.
// Leaving one in would change nothing a page can observe and would hand `dom` a signal per
// wrapped element that it binds, holds and tears down for no reason.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createDocument, toHtml } from '@aweftjs/dom';

import { Theme } from '../src/theme-api.ts';
import { mount } from '../src/render.ts';
import { template } from '../src/template.ts';

Theme.define({ boxed: { padding: 8 } });

/** What `dom` hands back for an instance with something reactive in it. */
interface Bound { readonly signals: { readonly source?: unknown; readonly name?: string }[] }

const openWrapped = (made: unknown): Bound => {
	const inner = (made as { [key: symbol]: unknown });
	const held = Object.getOwnPropertySymbols(inner)
		.map((key) => inner[key])
		.find((value) => typeof value === 'object' && value !== null && 'made' in (value as object));
	return (held as { made: Bound }).made;
};

test('every marker is taken back out of the instance before it is mounted', () => {
	const row = template(
		['tr', null, ['td', null, 'one']],
		[['props', []], ['props', [0]]],
	);
	const made = row([{ theme: 'boxed' }, { class: 'cell' }]);
	assert.equal(typeof made, 'function', 'a claimed prop means the instance mounts rather than being one');

	const inner = openWrapped(made);
	assert.ok(Array.isArray(inner.signals));
	// The markers are gone, and the one signal `dom` is left holding is the `class` attribute cell
	// `ui` handed it: the theme's answer goes in there, so it reaches a node a hydration adopts
	// (design 133). The cell edit was a literal attribute `dom` wrote outright.
	assert.deepEqual(inner.signals.map((signal) => signal.name), ['class']);
});

test('a template with nothing ui claims is dom\'s instance exactly', () => {
	const row = template(['tr', null, ['td', null, 'one']], [['props', [0]]]);
	const made = row([{ class: 'cell' }]);
	assert.notEqual(typeof made, 'function', 'nothing claimed means nothing to apply at mount');

	const document = createDocument();
	const stop = mount(document.body, made);
	assert.equal(toHtml(document.body.childNodes), '<tr><td class="cell">one</td></tr>');
	stop();
});
