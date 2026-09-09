// The three components that lay a form out (design 196). What they render, what entry each lands
// on, and the one thing a field learns from the controls inside it.
//
// What only a browser can answer, which is the container query and the measured row, is
// `browser.test.ts`. Every expected value here is written from the record, not taken from a run.

import test from 'node:test';
import assert from 'node:assert/strict';

import { mutable } from '@aweftjs/core';
import { createDocument } from '@aweftjs/dom';
import type { LightElement, NodeLike } from '@aweftjs/dom';
import {
	Field, FieldGroup, FieldSet, Icons, TextField, Validate, context, h, mount,
} from '@aweftjs/ui';
import type { Render } from '@aweftjs/ui';

import { testIcons } from './fixtures/icons.ts';

const elements = (node: NodeLike | null): LightElement[] => {
	const found: LightElement[] = [];
	for (let n = node; n !== null; n = n.nextSibling) {
		if (n.nodeType === 1) found.push(n as unknown as LightElement);
		found.push(...elements(n.firstChild));
	}
	return found;
};

/** Mount into a render of this test's own, so the stylesheet holds only what this page asked for. */
const page = (item: unknown): { render: Render; root: LightElement; stop: () => void } => {
	const render = context();
	const document = createDocument();
	const stop = mount(document.body, item, undefined, render);
	return {
		render,
		root: document.body.firstChild as unknown as LightElement,
		stop: () => { stop(); },
	};
};

/** The rules this element's generated class was given, which is what says its entry landed. */
const rulesOn = (render: Render, element: LightElement): string => {
	const name = element.getAttribute('class') ?? '';
	assert.notEqual(name, '', 'the element was given a generated class');
	const wanted = new RegExp(`\\.${name}\\b`);
	return render.theme.markup().split('\n').filter((line) => wanted.test(line)).join('\n');
};

test('a field is a group, a form is a column, and a fieldset is neither bordered nor padded', () => {
	const { render, root, stop } = page(h(Field as never, {}, 'x'));
	assert.equal(root.localName, 'div');
	assert.equal(root.getAttribute('role'), 'group', 'a field is a box of related things');
	const field = rulesOn(render, root);
	assert.match(field, /display: flex; flex-direction: column/);
	assert.match(field, /gap: 4px/, '$space between a label, its control and its notes');
	assert.match(field, /width: 100%/);
	stop();

	const group = page(h(FieldGroup as never, {}, 'x'));
	assert.equal(group.root.localName, 'div');
	const stack = rulesOn(group.render, group.root);
	assert.match(stack, /flex-direction: column/);
	assert.match(stack, /gap: 24px/, '$space6 between fields');
	assert.match(stack, /container-type: inline-size/, 'which is what a responsive field measures');
	group.stop();

	const set = page(h(FieldSet as never, { legend: 'Billing' }, 'x'));
	assert.equal(set.root.localName, 'fieldset');
	const box = rulesOn(set.render, set.root);
	assert.match(box, /gap: 24px/, 'the same column a group is');
	assert.match(box, /border: none/);
	assert.match(box, /padding: 0px/);
	assert.match(box, /min-width: 0px/, 'or it will not shrink inside one');
	set.stop();
});

test('an orientation cell moves the class while the field is on the page', () => {
	const how = mutable<unknown>('column');
	const { render, root, stop } = page(h(Field as never, { orientation: how }, 'x'));

	const column = rulesOn(render, root);
	assert.match(column, /flex-direction: column/);
	assert.doesNotMatch(column, /flex-direction: row/, 'a column is the default and adds nothing');

	how.set('inline');
	const inline = rulesOn(render, root);
	assert.match(inline, /flex-direction: row/, 'the control is beside its words');
	assert.match(inline, /min-height: 36px/, 'on a $control-tall line');
	assert.doesNotMatch(inline, /@container/, 'and it is a row at every width');

	how.set('responsive');
	const responsive = rulesOn(render, root);
	assert.match(responsive, /@container \(min-width: 28rem\) \{[^}]*flex-direction: row/,
		'a column that turns inline from 28rem of its container');
	const outside = responsive.replace(/@container[^{]*\{[\s\S]*?\}\s*\}/g, '');
	assert.doesNotMatch(outside, /flex-direction: row/, 'and nothing outside the query turns it');

	how.set('column');
	assert.doesNotMatch(rulesOn(render, root), /flex-direction: row/, 'and back again');
	stop();
});

test('a fieldset renders its legend first, which is where the host needs it', () => {
	// A `<legend>` anywhere else in a fieldset is laid out as an ordinary child and stops naming
	// the box.
	const { root, stop } = page(h(FieldSet as never, { legend: 'Billing address' },
		h(Field as never, {}, 'a'),
		h(Field as never, {}, 'b')));
	const inside = elements(root.firstChild);
	assert.equal(inside[0]?.localName, 'legend');
	assert.equal(inside[0]?.textContent, 'Billing address');
	assert.deepEqual(inside.slice(1, 3).map((element) => element.localName), ['div', 'div'],
		'and the fields follow it');

	// No legend, no element: an empty `<legend>` would name the box nothing.
	const bare = page(h(FieldSet as never, {}, h(Field as never, {}, 'a')));
	assert.equal(elements(bare.root.firstChild).some((element) => element.localName === 'legend'), false);
	bare.stop();
	stop();
});

test('a field marks itself while a control inside it has something wrong, and unmarks when it clears', () => {
	const problem = mutable<unknown>('');
	const { root, stop } = page(h(Field as never, {},
		h(TextField as never, { label: 'Email', error: problem })));

	assert.equal(root.getAttribute('data-invalid'), null, 'nothing is wrong yet');
	problem.set('That is not an address');
	assert.equal(root.getAttribute('data-invalid'), 'true', 'the control said so, and the field heard');
	problem.set('');
	assert.equal(root.getAttribute('data-invalid'), null, 'and the attribute goes rather than saying false');
	stop();
});

test('a field hears an error that came from a Validate rather than from the control', () => {
	// A control with no `error` of its own takes the message a `Validate` above it is showing
	// (design 138), and that is the value the field follows too. The `Icons` above is for the
	// `triangle-alert` beside the message, which is the `Validate`'s and not the field's.
	const email = mutable('nope');
	const { root, stop } = page(h(Icons as never, { value: testIcons },
		h(Field as never, {},
			h(Validate as never, { value: email, validate: 'email' },
				h(TextField as never, { label: 'Email', value: email })))));

	assert.equal(root.getAttribute('data-invalid'), 'true', 'the address is not one');
	email.set('ada@example.com');
	assert.equal(root.getAttribute('data-invalid'), null, 'and now it is');
	stop();
});

test('a field with no control in it is one empty group', () => {
	const { root, stop } = page(h(Field as never, {}));
	assert.equal(root.localName, 'div');
	assert.equal(root.getAttribute('role'), 'group');
	assert.equal(root.getAttribute('data-invalid'), null, 'nothing reported, nothing marked');
	assert.deepEqual(elements(root.firstChild).map((element) => element.localName), [],
		'and it holds nothing');
	stop();
});

test('a box takes any element the caller hands it, and a fieldset takes one', () => {
	// The two boxes only lay things out, so a `<section>` or an `<li>` is as good as a `<div>`. A
	// `FieldSet` is the element or nothing: the legend and the native disabling are that element's.
	const document = createDocument();
	const held = document.createElement('section');
	const stop = mount(document.body, h(Field as never, { element: held }, 'x'), undefined, context());
	assert.equal(held.getAttribute('role'), 'group', 'the node handed in is the one decorated');
	stop();

	assert.throws(
		() => { mount(createDocument().body, h(FieldSet as never, { element: document.createElement('div') })); },
		/element must be <fieldset> and this one is <div>/,
	);
	assert.throws(
		() => { mount(createDocument().body, h(FieldGroup as never, { element: 'div' })); },
		/element must be an element and this one is a string/,
	);
});
