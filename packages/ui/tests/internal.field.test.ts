// The field wiring on its own (design 129). White box, because it is not exported.

import test from 'node:test';
import assert from 'node:assert/strict';

import { mutable } from '@aweftjs/core';
import { createDocument, mount as domMount, toHtml } from '@aweftjs/dom';
import { context, h, mount } from '@aweftjs/ui';

import { empty, wireField } from '../src/field.ts';

/** Run a body with a real mount context in hand, and hand back what it returned. */
const inMount = <T>(body: (context: unknown) => T, render = context()): { held: T; stop: () => void } => {
	let held: T | undefined;
	const Probe = () => (_elem: never, _item: unknown, _before: never, ctx: unknown) => {
		held = body(ctx);
		return () => undefined;
	};
	const document = createDocument();
	const stop = mount(document.body, h(Probe as never, {}), undefined, render);
	return { held: held as T, stop: () => { stop(); } };
};

test('nothing to say is undefined, null, false and the empty string', () => {
	for (const value of [undefined, null, false, '']) assert.equal(empty(value), true, String(value));
	for (const value of [0, 'x', true, []]) assert.equal(empty(value), false, String(value));
});

test('the ids come off the render and count from zero', () => {
	const render = context();
	const one = inMount((ctx) => wireField(ctx, { label: 'a' }), render);
	assert.equal(one.held.id, 'field-0');
	one.stop();
	const two = inMount((ctx) => wireField(ctx, { label: 'b' }), render);
	assert.equal(two.held.id, 'field-1', 'a second field in one render gets a second id');
	two.stop();
});

test('a field with none of the three parts is not wrapped', () => {
	const { held, stop } = inMount((ctx) => wireField(ctx, {}));
	assert.equal(held.wrapped, false);
	assert.equal(held.label(), null);
	assert.deepEqual(held.aria['aria-describedby'], null);
	assert.deepEqual(held.aria['aria-invalid'], null);
	stop();
});

test('an error given as a plain value is described and invalid from the start', () => {
	const { held, stop } = inMount((ctx) => wireField(ctx, { error: 'no' }));
	assert.equal(held.aria['aria-invalid'], 'true');
	assert.equal(held.aria['aria-describedby'], `${held.id}-error`);
	stop();
});

test('an error cell drives aria-invalid and aria-describedby together', () => {
	const error = mutable<string | null>(null);
	const { held, stop } = inMount((ctx) => wireField(ctx, { description: 'why', error }));
	const invalid = held.aria['aria-invalid'] as { get(): unknown };
	const describedBy = held.aria['aria-describedby'] as { get(): unknown };

	assert.equal(invalid.get(), null);
	assert.equal(describedBy.get(), `${held.id}-note`, 'the description alone');

	error.set('bad');
	assert.equal(invalid.get(), 'true');
	assert.equal(describedBy.get(), `${held.id}-note ${held.id}-error`, 'both, in reading order');

	error.set('');
	assert.equal(invalid.get(), null, 'an empty message is no message');
	assert.equal(describedBy.get(), `${held.id}-note`);
	stop();
});

test('the label points at the control and carries its own id', () => {
	const Probe = () => (elem: never, _item: unknown, before: never, ctx: unknown) => {
		const field = wireField(ctx, { label: 'Email' });
		return domMount(elem, field.label(), before, ctx);
	};
	const document = createDocument();
	const stop = mount(document.body, h(Probe as never, {}));
	assert.equal(
		toHtml(document.body.childNodes),
		'<label id="field-0-label" for="field-0" class="aw0">Email</label>',
	);
	stop();
});

test('the error is a live region, so it is read out when it arrives', () => {
	const error = mutable<string | null>(null);
	const Probe = () => (elem: never, _item: unknown, before: never, ctx: unknown) => {
		const field = wireField(ctx, { error });
		return domMount(elem, field.notes(), before, ctx);
	};
	const document = createDocument();
	const stop = mount(document.body, h(Probe as never, {}));

	assert.doesNotMatch(toHtml(document.body.childNodes), /role="alert"/);
	error.set('That is not an address');
	const markup = toHtml(document.body.childNodes);
	assert.match(markup, /role="alert"/);
	assert.match(markup, /That is not an address/);
	error.set(null);
	assert.doesNotMatch(toHtml(document.body.childNodes), /That is not an address/);
	stop();
});
