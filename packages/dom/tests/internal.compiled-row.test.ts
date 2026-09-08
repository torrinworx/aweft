// Where the two templates meet: the row recorder against a compiled row body, and the hoisted
// template against the recording gate of design 098.
//
// White box because both things being checked are absences. A recording that does not start, and
// a walk that does not run, leave no mark on the tree they could be seen by.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createArray, createObject, observer } from '@aweftjs/core';

import { createDocument, h, mount, template, toHtml } from '../src/index.ts';
import type { LightElement } from '../src/index.ts';
import { isMade } from '../src/props.ts';
import { isRowRecording } from '../src/row-template.ts';

interface Row extends Record<string, unknown> { label: string }

test('a compiled row body takes the recorder once for the list, not once per row', () => {
	const document = createDocument();
	const line = template(['li', { class: 'row' }, ['span', null, 'x']], [['child', [], -1]]);

	let recorded = 0;
	const Item = ({ each }: { each: Row }) => {
		if (isRowRecording()) recorded += 1;
		return line([observer(each).path('label')]);
	};

	const rows = createArray<Row>([1, 2, 3, 4, 5].map((n) => createObject<Row>({ label: `r${n}` })));
	mount(document.body, h('ul', {}, h(Item, { each: rows })));

	assert.equal(recorded, 1, 'the recorder starts for the first row and the call site is off after it');
	assert.equal(
		toHtml(document.body),
		'<body><ul><li class="row"><span>x</span>r1</li><li class="row"><span>x</span>r2</li>'
		+ '<li class="row"><span>x</span>r3</li><li class="row"><span>x</span>r4</li>'
		+ '<li class="row"><span>x</span>r5</li></ul></body>',
	);

	// A row added later finds the call site already off, so nothing records again.
	rows.push(createObject<Row>({ label: 'r6' }));
	assert.equal(recorded, 1, 'a row appended after the list is live records nothing either');
	assert.ok(toHtml(document.body).endsWith('<li class="row"><span>x</span>r6</li></ul></body>'));
});

test('a clone made inside a mount that is not hydrating is never walked to be marked', () => {
	// What this pins is design 098 reaching the clone path: inside a mount that is not hydrating
	// nothing marks. That the walk down the clone is skipped rather than run to call a no-op is a
	// cost, not a behavior, so it is a number in design 098 and not an assertion here.
	const document = createDocument();
	const line = template(['li', { class: 'row' }, ['span', null, 'x']], []);
	// Inside a component, so the instance is made while a mount is running. An instance made in
	// the argument list of `mount` is made before it, which is the case the next test covers.
	const List = () => h('ul', {}, line([]));
	mount(document.body, h(List));

	const li = document.body.firstChild!.firstChild!;
	assert.equal(li.nodeName.toLowerCase(), 'li');
	assert.equal(isMade(li), false, 'the clone itself is not marked');
	assert.equal(isMade(li.firstChild!), false, 'and the walk down its children never ran');
});

test('an instance made outside a mount is not marked, so nothing pays for a hydration that cannot come', () => {
	// `hydrate` takes what makes the item and builds it inside the hydrating mount, so an
	// instance made out here is never one a hydration will claim (design 157).
	const global = globalThis as { document?: unknown };
	global.document = createDocument();
	try {
		const line = template(['li', { class: 'row' }, ['span', null, 'x']], []);
		const instance = line([]) as LightElement;
		assert.equal(isMade(instance), false, 'the clone is not marked');
		assert.equal(isMade(instance.firstChild!), false, 'and the walk down its children never ran');
	} finally {
		delete global.document;
	}
});
