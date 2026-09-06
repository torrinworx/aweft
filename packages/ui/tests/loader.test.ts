// The gate compiles this package with this stack's own compiler (design 110). This is the
// smallest statement of that: a `.tsx` fixture with JSX in it, imported and run.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createDocument, toHtml } from '@aweftjs/dom';
import { mount } from '@aweftjs/ui';

import { Greeting, greetingTag } from './fixtures/greeting.tsx';

test('a .tsx file loads, and its JSX compiled to this package\'s h', () => {
	const document = createDocument();
	const stop = mount(document.body, Greeting({ name: 'world', children: [] }));

	assert.equal(toHtml(document.body.childNodes), '<p class="aw0">hello world</p>');
	assert.equal(greetingTag, 'p');

	stop();
	assert.equal(toHtml(document.body.childNodes), '');
});
