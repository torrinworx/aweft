// What the typed call sites in `fixtures/typed.tsx` do when they run (design 308).
//
// The fixture is what the root typecheck reads. This proves the shapes it accepts are the shapes
// that work, so a type that took a call the runtime refuses would show up here.

import test from 'node:test';
import assert from 'node:assert/strict';

import { mutable } from '@aweftjs/core';
import { createDocument, toHtml } from '@aweftjs/dom';
import type { LightElement } from '@aweftjs/dom';
import { createRouter } from '@aweftjs/dom/router';
import { fromBundle } from '@aweftjs/modules';
import { Stage, StageContext, h, mount, render } from '@aweftjs/ui';

import { List, acts, items, open, picker, refused, wrongAct } from './fixtures/typed.tsx';

test('a row typed by its item renders once per item from a list, a Set, and a list cell', () => {
	const picked = mutable<string | null>(null);
	const extra = mutable(['x', 'y']);
	const document = createDocument();
	const stop = mount(document.body as never, h(List, { picked, extra }));
	const markup = toHtml(document.body.childNodes).replace(/<!--.?-->/g, '');
	assert.equal((markup.match(/data-id="a"/g) ?? []).length, 3, 'from the array, the Set and the list cast to its item');
	assert.match(markup, /<li>x<\/li><li>y<\/li>/, 'the loose row follows the cell it was handed');

	const first = document.body.firstChild!.firstChild!.firstChild as LightElement;
	first.dispatchEvent({ type: 'click', target: first } as never);
	assert.equal(picked.get(), 'a', 'the row wrote the cell its prop is typed as');

	extra.set(['z']);
	assert.match(toHtml(document.body.childNodes), /<li>z<\/li>/);
	stop();
});

test('h with a component checks its props and runs them, an inline callback typed by the prop', () => {
	const seen: string[] = [];
	const document = createDocument();
	const stop = mount(document.body as never, picker(seen));
	const buttons = [...(document.body.firstChild as LightElement).childNodes] as LightElement[];
	assert.equal(buttons.length, items.length);
	buttons[1]!.dispatchEvent({ type: 'click', target: buttons[1] } as never);
	assert.deepEqual(seen, ['B']);
	stop();
});

test('acts that declare stage, params and a refusal are taken by the stage as they are', async () => {
	// The one act named by module needs a source to come from.
	const sources = [fromBundle({ 'site/About.ts': { default: () => ({ component: () => h('main', null, 'about') }) } }, { prefix: '' })];
	const at = async (url: string): Promise<string> =>
		(await render(h(StageContext, { router: createRouter({ url }), acts, sources }, h(Stage, null)))).replace(/<!--.?-->/g, '');
	assert.match(await at('/posts/7'), /<main[^>]*>7<\/main>/, 'the act read stage.params');
	assert.match(await at('/'), /<main><\/main>/, 'the act read stage.current, which names the index act');
	assert.match(await at('/about'), /<main[^>]*>about<\/main>/);
	assert.equal(open.get(), false, 'Cell is the type mutable answers');
});

test('the refused shapes are refused by the types and are never called here', () => {
	assert.deepEqual(Object.keys(refused).sort(), ['cell', 'direct', 'extra', 'missing', 'mistyped', 'numbers']);
	assert.equal(typeof wrongAct, 'function');
});
