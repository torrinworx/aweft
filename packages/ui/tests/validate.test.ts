// `Validate` and `ValidateContext` in the light tree (design 138): when a check runs, where its
// message goes, and what a form makes of every answer under it.

import test from 'node:test';
import assert from 'node:assert/strict';

import { mutable } from '@aweftjs/core';
import { createDocument } from '@aweftjs/dom';
import type { ElementLike, LightElement, NodeLike } from '@aweftjs/dom';
import { Icons, Shown, TextField, Validate, ValidateContext, h, mount } from '@aweftjs/ui';

import { testIcons } from './fixtures/icons.ts';

const elements = (node: NodeLike | null): LightElement[] => {
	const found: LightElement[] = [];
	for (let n = node; n !== null; n = n.nextSibling) {
		if (n.nodeType === 1) found.push(n as unknown as LightElement);
		found.push(...elements(n.firstChild));
	}
	return found;
};

const page = (item: unknown): { body: ElementLike; stop: () => void } => {
	const document = createDocument();
	// `Validate` shows a `triangle-alert`, and `Icons` starts empty (design 144).
	const stop = mount(document.body, h(Icons as never, { value: testIcons }, item));
	return { body: document.body, stop: () => { stop(); } };
};

/** The live region the message is in, or null while there is nothing to say. */
const messageOf = (root: NodeLike | null): LightElement | null =>
	elements(root).find((element) => element.getAttribute('role') === 'alert') ?? null;

const textOf = (root: NodeLike | null): string => messageOf(root)?.textContent ?? '';

const inputOf = (root: NodeLike | null): LightElement =>
	elements(root).find((element) => element.localName === 'input')!;

/** A cell, a validator and a field, which is what nearly every test here needs. */
const field = (props: Record<string, unknown>): { body: ElementLike; stop: () => void } =>
	page(h(Validate as never, props, h(TextField as never, { label: 'Email', value: props['value'] })));

// --- when a check runs --------------------------------------------------------------------------

test('a function validator is given the cell and its answer is the message', () => {
	const name = mutable('');
	const seen: unknown[] = [];
	const { body, stop } = field({
		value: name,
		validate: (cell: { get(): unknown }) => {
			seen.push(cell);
			return String(cell.get()).length < 3 ? 'that is too short' : '';
		},
	});

	assert.equal(seen[0], name, 'the validator is handed the cell, not what it holds');
	assert.equal(textOf(body.firstChild), 'that is too short');

	name.set('Rosalind');
	assert.equal(messageOf(body.firstChild), null, 'and the message goes when the problem does');
	stop();
});

test('a named validator is one of the eight', () => {
	const email = mutable('nope');
	const { body, stop } = field({ value: email, validate: 'email' });
	assert.match(textOf(body.firstChild), /does not look like an email address/);
	email.set('ada@example.com');
	assert.equal(messageOf(body.firstChild), null);
	stop();
});

test('a name that is not one of the eight asserts, listing them', () => {
	const document = createDocument();
	assert.throws(
		() => {
			mount(document.body, h(Validate as never, { value: mutable(''), validate: 'zipcode' },
				h('input', { 'aria-label': 'zip' })));
		},
		/no built-in validator named zipcode[^]*phone, email, pan, expDate, postalCode, date, number, float/,
	);
});

test('a Validate with no cell to check asserts', () => {
	const document = createDocument();
	assert.throws(
		() => { mount(document.body, h(Validate as never, { validate: 'email' }, h('input', {}))); },
		/Validate needs a value cell to check/,
	);
});

test('nothing is checked before the signal, and everything is after it', () => {
	const email = mutable('nope');
	const submit = mutable(false);
	const { body, stop } = field({ value: email, validate: 'email', signal: submit });

	assert.equal(messageOf(body.firstChild), null, 'a person typing is not a person who is wrong yet');
	email.set('still nope');
	assert.equal(messageOf(body.firstChild), null, 'and a second keystroke is not either');

	submit.set(true);
	assert.match(textOf(body.firstChild), /email address/, 'the signal is what starts the checking');

	email.set('ada@example.com');
	assert.equal(messageOf(body.firstChild), null, 'and after it, every change is checked live');
	email.set('broken again');
	assert.match(textOf(body.firstChild), /email address/);
	stop();
});

test('a signal written false again is not-yet-checked again', () => {
	// A form that clears itself after a successful submit wrote every field back to empty, and
	// every field went red on the empty form (design 208).
	const email = mutable('nope');
	const submit = mutable(false);
	const valid = mutable<unknown>(null);
	const error = mutable<unknown>(null);
	const { body, stop } = field({ value: email, validate: 'email', signal: submit, valid, error });

	submit.set(true);
	assert.match(textOf(body.firstChild), /email address/, 'the signal starts the checking');
	assert.equal(valid.get(), false);

	submit.set(false);
	email.set('');
	assert.equal(messageOf(body.firstChild), null, 'and writing it back leaves the form quiet');
	assert.equal(valid.get(), true, 'a form nobody has submitted does not hold itself back');
	assert.equal(error.get(), null);

	email.set('still nope');
	assert.equal(messageOf(body.firstChild), null, 'typing into the quiet form says nothing');

	submit.set(true);
	assert.match(textOf(body.firstChild), /email address/, 'and the next submit checks it again');
	stop();
});

test('a signal that starts truthy is checked from the start', () => {
	const email = mutable('nope');
	const { body, stop } = field({ value: email, validate: 'email', signal: mutable(true) });
	assert.match(textOf(body.firstChild), /email address/);
	stop();
});

test('a check that reads another field in the form runs again when that field moves', () => {
	// Confirm-must-match, written the way a form writes it: the confirm field's validator reads
	// the other password's cell (design 208).
	const next = mutable('longenough1');
	const again = mutable('longenough1');
	const allValid = mutable(false);
	const matches = (cell: { get(): unknown }): string =>
		(cell.get() === next.get() ? '' : 'The two passwords do not match.');

	const { body, stop } = page(h(ValidateContext as never, { value: allValid },
		h(Validate as never, { value: next, validate: () => '' }, h('input', {})),
		h(Validate as never, { value: again, validate: matches }, h('input', {}))));

	assert.equal(messageOf(body.firstChild), null, 'two matching passwords is nothing to say');
	assert.equal(allValid.get(), true);

	next.set('longenough2');
	assert.match(textOf(body.firstChild), /do not match/,
		'editing the other field is what makes this one wrong');
	assert.equal(allValid.get(), false, 'and the form knows');

	next.set('longenough1');
	assert.equal(messageOf(body.firstChild), null, 'and editing it back makes it right again');
	assert.equal(allValid.get(), true);
	stop();
});

test('a Validate outside a form follows only its own cell', () => {
	const other = mutable('a');
	const mine = mutable('a');
	const { body, stop } = page(h(Validate as never, {
		value: mine,
		validate: (cell: { get(): unknown }) => (cell.get() === other.get() ? '' : 'no match'),
	}, h('input', {})));

	assert.equal(messageOf(body.firstChild), null);
	other.set('b');
	assert.equal(messageOf(body.firstChild), null,
		'nothing above it knows about the other cell, so nothing re-runs the check');
	mine.set('c');
	assert.equal(textOf(body.firstChild), 'no match', 'its own cell still runs it');
	stop();
});

test('one round per write, even when a check writes its own cell back', () => {
	const phone = mutable('5195551234');
	const other = mutable('');
	const rounds: number[] = [];
	const { stop } = page(h(ValidateContext as never, { value: mutable(true) },
		h(Validate as never, { value: phone, validate: 'phone' }, h('input', {})),
		h(Validate as never, {
			value: other,
			validate: () => { rounds.push(1); return ''; },
		}, h('input', {}))));

	const before = rounds.length;
	phone.set('5195559999');
	// `core` queues a write made during a delivery, so the formatter's write is a delivery of its
	// own after this one rather than a round inside it.
	assert.equal(rounds.length - before, 1, 'one write is one round for every other field');
	stop();
});

test('a check that writes its own cell as it mounts does not run again inside itself', () => {
	// The mount is the one place a write reaches the check that made it: `value.effect` calls back
	// as it registers, and that first call is not a delivery, so `core` has nothing to queue it
	// behind. With the guard taken out this validator ran twice on one mount.
	const phone = mutable('5195551234');
	let calls = 0;
	const { stop } = page(h(Validate as never, {
		value: phone,
		validate: (cell: { get(): unknown; set(value: unknown): void }) => {
			calls += 1;
			const held = String(cell.get());
			if (!held.startsWith('(')) cell.set(`(${held.slice(0, 3)}) ${held.slice(3)}`);
			return '';
		},
	}, h('input', {})));

	assert.equal(calls, 1, 'one check on the mount, not a second one on the value it just wrote');
	assert.equal(phone.get(), '(519) 5551234', 'and the write it made still landed');
	stop();
});

test('with no signal, checking is live from the start', () => {
	const email = mutable('nope');
	const { body, stop } = field({ value: email, validate: 'email' });
	assert.match(textOf(body.firstChild), /email address/);
	stop();
});

// --- where the answer goes -----------------------------------------------------------------------

test('the valid and error cells are written with the outcome', () => {
	const email = mutable('nope');
	const valid = mutable<unknown>(null);
	const error = mutable<unknown>(null);
	const { stop } = field({ value: email, validate: 'email', valid, error });

	assert.equal(valid.get(), false);
	assert.match(String(error.get()), /email address/);

	email.set('ada@example.com');
	assert.equal(valid.get(), true);
	assert.equal(error.get(), null);
	stop();
});

test('the message reaches the control it wraps, and points at the element on the page', () => {
	const email = mutable('nope');
	const { body, stop } = field({ value: email, validate: 'email' });
	const input = inputOf(body.firstChild);
	const message = messageOf(body.firstChild)!;

	assert.equal(input.getAttribute('aria-invalid'), 'true');
	assert.equal(input.getAttribute('aria-describedby'), message.getAttribute('id'),
		'the control names the message that is on the page, not one it would have rendered');

	// One message, not two: `Validate` renders it and the field wiring does not (design 138).
	assert.equal(elements(body.firstChild).filter((e) => e.getAttribute('role') === 'alert').length, 1);

	email.set('ada@example.com');
	assert.equal(input.getAttribute('aria-invalid'), null);
	assert.equal(input.getAttribute('aria-describedby'), null);
	stop();
});

test('a control with an error of its own keeps it, and the wrapper still shows its own', () => {
	const email = mutable('nope');
	const own = mutable('the server said no');
	const { body, stop } = page(h(Validate as never, { value: email, validate: 'email' },
		h(TextField as never, { label: 'Email', value: email, error: own })));

	const input = inputOf(body.firstChild);
	const named = (input.getAttribute('aria-describedby') ?? '').split(' ');
	const pointed = elements(body.firstChild).find((e) => e.getAttribute('id') === named[0]);
	assert.equal(pointed?.textContent, 'the server said no', 'the caller\'s own error is the one it points at');
	assert.equal(elements(body.firstChild).filter((e) => e.getAttribute('role') === 'alert').length, 2,
		'and both messages are on the page, which is what asking for two of them gets');
	stop();
});

test('showError false takes the message off the screen and leaves it announced', () => {
	// Both in one page, because a class name is minted per render and two renders both start at zero.
	const { body, stop } = page([
		h(Validate as never, { value: mutable('nope'), validate: 'email', showError: false },
			h('input', {})),
		h(Validate as never, { value: mutable('nope'), validate: 'email' }, h('input', {})),
	]);
	const messages = elements(body.firstChild).filter((element) => element.getAttribute('role') === 'alert');
	assert.equal(messages.length, 2, 'the hidden one is still on the page, so it can still be named');
	assert.notEqual(messages[0]!.getAttribute('class'), messages[1]!.getAttribute('class'),
		'and it wears a class the visible one does not');
	stop();
});

// --- the form's tally -----------------------------------------------------------------------------

test('a context goes false when one child is invalid and true again when it is fixed', () => {
	const one = mutable('a@b.co');
	const two = mutable('a@b.co');
	const allValid = mutable(true);
	const { stop } = page(h(ValidateContext as never, { value: allValid },
		h(Validate as never, { value: one, validate: 'email' }, h('input', {})),
		h(Validate as never, { value: two, validate: 'email' }, h('input', {}))));

	assert.equal(allValid.get(), true, 'two happy fields is a happy form');
	two.set('nope');
	assert.equal(allValid.get(), false, 'one unhappy field is an unhappy form');
	one.set('also nope');
	assert.equal(allValid.get(), false);
	two.set('a@b.co');
	assert.equal(allValid.get(), false, 'and it stays unhappy while the other one is wrong');
	one.set('a@b.co');
	assert.equal(allValid.get(), true);
	stop();
});

test('a Validate that unmounts stops holding the form invalid', () => {
	const kept = mutable('a@b.co');
	const going = mutable('nope');
	const there = mutable(true);
	const allValid = mutable(true);
	const { stop } = page(h(ValidateContext as never, { value: allValid },
		h(Validate as never, { value: kept, validate: 'email' }, h('input', {})),
		h(Shown as never, { value: there },
			h(Validate as never, { value: going, validate: 'email' }, h('input', {})))));

	assert.equal(allValid.get(), false, 'the field that is wrong holds the form');
	there.set(false);
	assert.equal(allValid.get(), true, 'and it stops holding it when it goes away');
	there.set(true);
	assert.equal(allValid.get(), false, 'and holds it again when it comes back');
	stop();
});

// --- the eight -------------------------------------------------------------------------------------

/** One accepted value and one refused value per built-in, worked out by hand from what each name promises. */
const CASES: readonly [name: string, good: string, bad: string][] = [
	['phone', '5195551234', '12345'],
	['email', 'ada@example.com', 'ada@example'],
	['pan', '4111111111111111', '4111111111111112'],
	['expDate', '12/25', '13/25'],
	['postalCode', 'N2G 1A1', 'N2G 1A'],
	['date', '2026-09-07', '2026-02-30'],
	['number', '-42', '4.2'],
	['float', '4.2', 'four'],
];

test('each of the eight takes what its name promises and refuses what it does not', () => {
	for (const [name, good, bad] of CASES) {
		const wrong = mutable(bad);
		const refused = field({ value: wrong, validate: name });
		assert.notEqual(messageOf(refused.body.firstChild), null, `${name} refuses ${bad}`);
		refused.stop();

		const right = mutable(good);
		const taken = field({ value: right, validate: name });
		assert.equal(messageOf(taken.body.firstChild), null,
			`${name} takes ${good}, and said "${textOf(taken.body.firstChild)}"`);
		taken.stop();
	}
});

test('an empty value is nobody\'s problem yet', () => {
	for (const [name] of CASES) {
		const empty = mutable('');
		const { body, stop } = field({ value: empty, validate: name });
		assert.equal(messageOf(body.firstChild), null, `${name} says nothing about an empty field`);
		stop();
	}
});

test('four of the eight write the value back, formatted, and four do not', () => {
	const formatted: [name: string, typed: string, written: string][] = [
		['phone', '5195551234', '(519) 555-1234'],
		['pan', '4111111111111111', '4111 1111 1111 1111'],
		['expDate', '1225', '12/25'],
		['postalCode', 'n2g1a1', 'N2G 1A1'],
	];
	for (const [name, typed, written] of formatted) {
		const cell = mutable(typed);
		const { stop } = field({ value: cell, validate: name });
		assert.equal(cell.get(), written, `${name} punctuates what was typed`);
		stop();
	}

	for (const [name, good] of [['email', 'ada@example.com'], ['date', '2026-09-07'],
		['number', '-42'], ['float', '4.2']] as const) {
		const cell = mutable(good);
		const { stop } = field({ value: cell, validate: name });
		assert.equal(cell.get(), good, `${name} reads and does not write`);
		stop();
	}
});

test('a validator that throws is reported, and the value counts as invalid', () => {
	const real = globalThis.queueMicrotask;
	const thrown: string[] = [];
	globalThis.queueMicrotask = (fn: () => void): void => {
		try { fn(); } catch (error) { thrown.push(String(error)); }
	};

	try {
		const cell = mutable('anything');
		const all = mutable(true);
		const { body, stop } = page(h(ValidateContext as never, { value: all },
			h(Validate as never, {
				value: cell,
				validate: () => { throw new Error('the check blew up'); },
			}, h(TextField as never, { label: 'Email', value: cell }))));

		assert.deepEqual(thrown, ['Error: the check blew up'],
			'reported where a handler that throws is reported, not thrown into the mount');
		assert.equal(textOf(body.firstChild), 'the check blew up',
			'the message is what the error said');
		assert.equal(inputOf(body.firstChild).getAttribute('aria-invalid'), 'true');
		assert.equal(all.get(), false,
			'a form is never quietly valid because its check crashed');
		stop();
	} finally {
		globalThis.queueMicrotask = real;
	}
});
