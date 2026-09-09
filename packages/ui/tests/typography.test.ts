// `Typography` and `TextModifiers`, in the light tree: the element each `type` picks, the theme
// segments it asks for, and what the modifiers do to a label.
//
// The segment list is asserted through the render's own class cache rather than by reading a
// class name: the cache is keyed on the exact list, so the class the element wears equals the
// class the expected list mints only when the component asked for that list and no other.
//
// What only a browser can answer, which is the computed weight and the wrap, is `browser.test.ts`.
// What the generated stylesheet says is `look.test.ts`.

import test from 'node:test';
import assert from 'node:assert/strict';

import { mutable } from '@aweftjs/core';
import { createDocument, parseHtml, toHtml } from '@aweftjs/dom';
import type { ElementLike, LightElement, NodeLike } from '@aweftjs/dom';
import {
	TextModifiers, Typography, context, h, hydrate, mount, render,
} from '@aweftjs/ui';

const elements = (node: NodeLike | null): LightElement[] => {
	const found: LightElement[] = [];
	for (let n = node; n !== null; n = n.nextSibling) {
		if (n.nodeType === 1) found.push(n as unknown as LightElement);
		found.push(...elements(n.firstChild));
	}
	return found;
};

/** Mount into a fresh light document on a render of its own, so the class cache is this test's. */
const page = (item: unknown): {
	body: ElementLike;
	ui: ReturnType<typeof context>;
	first(): LightElement;
	stop(): void;
} => {
	const ui = context();
	const document = createDocument();
	const stop = mount(document.body, item, undefined, ui);
	return {
		body: document.body,
		ui,
		first: () => {
			const found = elements(document.body.firstChild)[0];
			assert.ok(found !== undefined, 'the component rendered an element');
			return found;
		},
		stop: () => { stop(); },
	};
};

// --- every type string the four applications write ---------------------------------------------

// Measured across four applications. The
// expected element and segments are read off the grammar in design 180, not off a run: the first
// segment is the element when it is a heading or a paragraph and a `<span>` otherwise, and every
// segment including the first is a theme word after `text`.
const USED: readonly (readonly [type: string, element: string, segments: string[]])[] = [
	['p1', 'p', ['text', 'p1']],
	['p2', 'p', ['text', 'p2']],
	['p1_bold', 'p', ['text', 'p1', 'bold']],
	['h2', 'h2', ['text', 'h2']],
	['h4', 'h4', ['text', 'h4']],
	['h2_bold', 'h2', ['text', 'h2', 'bold']],
	['h1', 'h1', ['text', 'h1']],
	['body', 'span', ['text', 'body']],
	['body_bold', 'span', ['text', 'body', 'bold']],
	['validate', 'span', ['text', 'validate']],
	['p1_italic', 'p', ['text', 'p1', 'italic']],
	['p12_subtext', 'span', ['text', 'p12', 'subtext']],
	['h3_bold', 'h3', ['text', 'h3', 'bold']],
	['h3', 'h3', ['text', 'h3']],
	['fileDrop_expand', 'span', ['text', 'fileDrop', 'expand']],
	['h1_bold', 'h1', ['text', 'h1', 'bold']],
	['p2_bold', 'p', ['text', 'p2', 'bold']],
	['p3', 'span', ['text', 'p3']],
	['span', 'span', ['text', 'span']],
	['eyebrow', 'span', ['text', 'eyebrow']],
	['h5', 'h5', ['text', 'h5']],
	['h6', 'h6', ['text', 'h6']],
];

test('every type the applications write picks its element and asks for its segments', () => {
	for (const [type, tag, segments] of USED) {
		const own = page(h(Typography as never, { type, label: type }));
		const element = own.first();
		assert.equal(element.localName, tag, `${type} is a <${tag}>`);
		assert.equal(element.getAttribute('class'), own.ui.theme.classes(own.ui.theme.base(), segments),
			`${type} themes as ${segments.join(' ')}`);
		assert.equal(element.textContent, type);
		own.stop();
	}
});

test('no type at all is a span on the text entry and nothing more', () => {
	const own = page(h(Typography as never, { label: 'plain' }));
	assert.equal(own.first().localName, 'span');
	assert.equal(own.first().getAttribute('class'), own.ui.theme.classes(own.ui.theme.base(), ['text']));
	own.stop();
});

test('theme appends segments after the ones type asked for', () => {
	const own = page(h(Typography as never, { type: 'h2', theme: 'muted', label: 'x' }));
	assert.equal(own.first().getAttribute('class'),
		own.ui.theme.classes(own.ui.theme.base(), ['text', 'h2', 'muted']));
	own.stop();
});

test('a cell type re-splits and moves the theme, and the element it built stays', () => {
	const type = mutable('p1');
	const own = page(h(Typography as never, { type, label: 'x' }));
	const element = own.first();
	assert.equal(element.getAttribute('class'), own.ui.theme.classes(own.ui.theme.base(), ['text', 'p1']));

	type.set('p1_bold');
	assert.equal(element.getAttribute('class'),
		own.ui.theme.classes(own.ui.theme.base(), ['text', 'p1', 'bold']),
		'the new value was split again, not taken as one word');
	assert.equal(own.first(), element, 'and it is the element it was: a cell moves the theme, not the tag');
	own.stop();
});

test('a cell label is followed', () => {
	const label = mutable('first');
	const own = page(h(Typography as never, { type: 'p1', label }));
	assert.equal(own.first().textContent, 'first');
	label.set('second');
	assert.equal(own.first().textContent, 'second');
	own.stop();
});

test('a number label is stringified and a node label renders as given', () => {
	const own = page(h(Typography as never, { label: 12 }));
	assert.equal(own.first().textContent, '12');
	own.stop();

	const node = page(h(Typography as never, { label: h('b', {}, 'given') }));
	assert.equal(elements(node.body.firstChild).map((element) => element.localName).join(' '), 'span b');
	node.stop();
});

test('the label renders first and the children after it', () => {
	const own = page(h(Typography as never, { type: 'p1', label: 'label' }, 'child'));
	assert.equal(own.first().textContent, 'labelchild');
	own.stop();
});

test('element decorates the node it was handed rather than building one', () => {
	const document = createDocument();
	const given = document.createElement('h3') as unknown as ElementLike;
	const ui = context();
	const stop = mount(document.body, h(Typography as never, { type: 'h1', element: given, label: 'x' }), undefined, ui);

	const found = elements(document.body.firstChild)[0]!;
	assert.equal(found, given, 'the node handed in is the node in the page');
	assert.equal(found.localName, 'h3', 'the type did not build a second element');
	assert.equal(found.getAttribute('class'), ui.theme.classes(ui.theme.base(), ['text', 'h1']),
		'and it wears the theme the type asked for, which is what element is for');
	stop();
});

test('an element that is not an element is refused, and the message says what it was', () => {
	// A themed element written in a page is a function, not a node, and `h` would take it for a
	// component and render nothing.
	assert.throws(
		() => {
			const own = page(h(Typography as never, { type: 'h1', element: h('p', { theme: 'card' }), label: 'x' }));
			own.stop();
		},
		(error: Error) => {
			assert.match(error.message, /element must be an element/);
			assert.match(error.message, /a function/, 'the message names what it got');
			return true;
		},
	);

	const document = createDocument();
	assert.throws(
		() => {
			const stop = mount(document.body,
				h(Typography as never, { element: document.createTextNode('x'), label: 'x' }));
			stop();
		},
		(error: Error) => {
			assert.match(error.message, /element must be an element/);
			assert.match(error.message, /a node of type 3/, 'the message names what it got');
			return true;
		},
	);
});

// --- the modifiers -------------------------------------------------------------------------------

/** The children of the one element, as tag names and text, so a match is told from a gap. */
const partsOf = (element: LightElement): string[] => {
	const out: string[] = [];
	for (let n = element.firstChild; n !== null; n = n.nextSibling) {
		out.push(n.nodeType === 1
			? `<${(n as unknown as LightElement).localName}>${n.textContent ?? ''}`
			: String(n.textContent ?? ''));
	}
	return out;
};

const badge = (word: string): unknown => h('b', {}, word);

test('a string check matches everywhere and ignores case, and the gaps stay text', () => {
	const own = page(h(TextModifiers as never, { value: [{ check: 'todo', return: badge }] },
		h(Typography as never, { label: 'a TODO and a todo here' })));
	assert.deepEqual(partsOf(own.first()), ['a ', '<b>TODO', ' and a ', '<b>todo', ' here']);
	own.stop();
});

test('a string check is escaped, so its punctuation is not a pattern', () => {
	const own = page(h(TextModifiers as never, { value: [{ check: 'a.c', return: badge }] },
		h(Typography as never, { label: 'abc and a.c' })));
	assert.deepEqual(partsOf(own.first()), ['abc and ', '<b>a.c'],
		'abc would have matched if the dot were still a pattern');
	own.stop();
});

test('a regex check is used as it was written', () => {
	const own = page(h(TextModifiers as never, { value: [{ check: /@\w+/g, return: badge }] },
		h(Typography as never, { label: 'hi @ada and @grace' })));
	assert.deepEqual(partsOf(own.first()), ['hi ', '<b>@ada', ' and ', '<b>@grace']);
	own.stop();
});

test('a regex that is not global is refused with the fix in the message', () => {
	assert.throws(
		() => {
			const own = page(h(TextModifiers as never, { value: [{ check: /@\w+/, return: badge }] },
				h(Typography as never, { label: 'hi @ada' })));
			own.stop();
		},
		(error: Error) => {
			assert.match(error.message, /must be global/);
			assert.match(error.message, /add the g flag/, 'the message says what to do about it');
			return true;
		},
	);
});

test('an overlap goes to the match that started first, and a tie to the earlier modifier', () => {
	// `abcd` and `bc` overlap from index 1. The first is earlier and takes it.
	const first = page(h(TextModifiers as never, {
		value: [{ check: 'abcd', return: badge }, { check: 'bc', return: (word: string) => h('i', {}, word) }],
	}, h(Typography as never, { label: 'x abcd y' })));
	assert.deepEqual(partsOf(first.first()), ['x ', '<b>abcd', ' y']);
	first.stop();

	// Both start at the same place, so the one written first wins whichever is longer.
	const tie = page(h(TextModifiers as never, {
		value: [{ check: 'ab', return: badge }, { check: 'abc', return: (word: string) => h('i', {}, word) }],
	}, h(Typography as never, { label: 'abc' })));
	assert.deepEqual(partsOf(tie.first()), ['<b>ab', 'c'], 'the earlier modifier took the tie');
	tie.stop();

	// And the other way round, so the assertion above is about declaration order and not length.
	const other = page(h(TextModifiers as never, {
		value: [{ check: 'abc', return: (word: string) => h('i', {}, word) }, { check: 'ab', return: badge }],
	}, h(Typography as never, { label: 'abc' })));
	assert.deepEqual(partsOf(other.first()), ['<i>abc']);
	other.stop();
});

test('a later match is still rendered after an earlier one has been taken', () => {
	const own = page(h(TextModifiers as never, {
		value: [{ check: 'one', return: badge }, { check: 'two', return: (word: string) => h('i', {}, word) }],
	}, h(Typography as never, { label: 'two one two' })));
	assert.deepEqual(partsOf(own.first()), ['<i>two', ' ', '<b>one', ' ', '<i>two'],
		'the matches render in the order they sit in the label, not the order they were declared');
	own.stop();
});

test('a key the list does not name is ignored', () => {
	const own = page(h(TextModifiers as never, {
		value: [{ check: 'TODO', return: badge, atomic: true, whatever: 3 }],
	}, h(Typography as never, { label: 'a TODO' })));
	assert.deepEqual(partsOf(own.first()), ['a ', '<b>TODO']);
	own.stop();
});

test('a nested provider replaces the list above it rather than adding to it', () => {
	const own = page(h(TextModifiers as never, { value: [{ check: 'one', return: badge }] },
		h(Typography as never, { label: 'one two' }),
		h(TextModifiers as never, { value: [{ check: 'two', return: badge }] },
			h(Typography as never, { label: 'one two' }))));

	const [outer, inner] = elements(own.body.firstChild).filter((element) => element.localName === 'span');
	assert.deepEqual(partsOf(outer!), ['<b>one', ' two']);
	assert.deepEqual(partsOf(inner!), ['one ', '<b>two'], 'the outer list is gone, not joined');
	own.stop();
});

test('children never go through the modifiers', () => {
	const own = page(h(TextModifiers as never, { value: [{ check: 'TODO', return: badge }] },
		h(Typography as never, {}, 'a TODO in a child')));
	assert.deepEqual(partsOf(own.first()), ['a TODO in a child']);
	own.stop();
});

test('a cell label runs the pass again, so a typed value re-renders its matches', () => {
	const label = mutable('nothing yet');
	const own = page(h(TextModifiers as never, { value: [{ check: 'TODO', return: badge }] },
		h(Typography as never, { label })));
	assert.deepEqual(partsOf(own.first()), ['nothing yet']);

	label.set('a TODO now');
	assert.deepEqual(partsOf(own.first()), ['a ', '<b>TODO', ' now'], 'the write re-ran the modifiers');
	own.stop();
});

test('a zero-width match is skipped, so a pattern that can match nothing changes nothing', () => {
	// /x*/g hits at every position in `ab`, which would be five children rather than one.
	const own = page(h(TextModifiers as never, { value: [{ check: /x*/g, return: badge }] },
		h(Typography as never, { label: 'ab' })));
	assert.deepEqual(partsOf(own.first()), ['ab']);
	own.stop();
});

test('an empty string check is refused with the fix in the message', () => {
	assert.throws(
		() => {
			const own = page(h(TextModifiers as never, { value: [{ check: '', return: badge }] },
				h(Typography as never, { label: 'ab' })));
			own.stop();
		},
		(error: Error) => {
			assert.match(error.message,
				/a TextModifiers check cannot be the empty string; write the text to match$/);
			return true;
		},
	);
});

test('what a modifier returns runs no modifiers of its own, so a nested Typography terminates', () => {
	let calls = 0;
	const nested = (word: string): unknown => {
		calls += 1;
		// A bound rather than a wait: without the guard this runs until the heap is gone, and a
		// test that dies takes the whole run with it.
		assert.ok(calls <= 4, 'the modifier ran again under its own return: the list is still in force below it');
		assert.match(word, /TODO/, 'and the match still satisfies the check, so nothing else stops it');
		return h(Typography as never, { label: word });
	};

	const own = page(h(TextModifiers as never, { value: [{ check: 'TODO', return: nested }] },
		h(Typography as never, { label: 'a TODO here' })));
	assert.equal(calls, 1, 'the modifier ran once');

	const [outer, inner] = elements(own.body.firstChild);
	assert.deepEqual(partsOf(outer!), ['a ', '<span>TODO', ' here']);
	assert.deepEqual(partsOf(inner!), ['TODO'], 'the inner run rendered the plain text');
	own.stop();
});

test('a list held in a cell is read rather than handed through as the cell', () => {
	const list = mutable([{ check: 'TODO', return: badge }]);
	const own = page(h(TextModifiers as never, { value: list },
		h(Typography as never, { label: 'a TODO or a NOTE' })));
	assert.deepEqual(partsOf(own.first()), ['a ', '<b>TODO', ' or a NOTE'],
		'an unread cell would have applied nothing at all');
	own.stop();
});

// --- markup, and taking it over ------------------------------------------------------------------

const specimens = (): unknown => h('div', {},
	h(Typography as never, { type: 'h1', label: 'A heading' }),
	h(Typography as never, { type: 'p1_bold', label: 'A paragraph' }),
	h(Typography as never, { type: 'eyebrow', label: 'An app word' }),
	h(TextModifiers as never, { value: [{ check: 'TODO', return: badge }] },
		h(Typography as never, { type: 'p2', label: 'a TODO here' })));

test('typography renders to markup and hydrates onto the nodes the server wrote', async () => {
	const server = context();
	// Both sides go through a maker, so the server writes the regions the hydration claims
	// (design 157).
	const markup = await render(h(specimens as never), { context: server });
	assert.match(markup, /<h1 class="aw\d+">A heading<\/h1>/, 'the server wrote the heading itself');
	assert.match(markup, /<b>TODO<\/b>/, 'and the modifier ran on the server');

	const document = createDocument();
	for (const node of parseHtml(markup, document)) document.body.appendChild(node);
	for (const node of parseHtml(`<style data-aweft>${server.theme.markup()}</style>`, document)) {
		document.head.appendChild(node);
	}

	const before = elements(document.body.firstChild);
	const stop = hydrate(document.body, specimens);
	const after = elements(document.body.firstChild);

	assert.equal(after.length, before.length, 'the page has the elements it had');
	assert.deepEqual(before.filter((element, at) => after[at] !== element).map((element) => element.localName), [],
		'a hydration that swaps a node has replaced something it should have adopted');
	assert.equal(toHtml(document.body.childNodes), markup, 'and the page is the page the server sent');
	stop();
});
