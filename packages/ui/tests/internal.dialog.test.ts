// The dialog behaviour on its own (design 129). White box, because it is not exported.
//
// What a real `<dialog>` does with `showModal`, a focus trap and Escape belongs to the platform
// and is asserted in Chromium, in `browser.test.ts`. What is asserted here is the part this
// package adds: `inert` on the rest of the page, the focus that comes back, and the teardown.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createDocument } from '@aweftjs/dom';
import type { LightElement } from '@aweftjs/dom';

import { dialogControl } from '../src/dialog.ts';

/** A page with a dialog in it, installed as the global document for the length of the test. */
const stage = (nest = false): {
	dialog: LightElement;
	beside: LightElement;
	holder: LightElement;
	focused: { element: unknown };
	uninstall(): void;
} => {
	const document = createDocument();
	const holder = document.createElement('section');
	const dialog = document.createElement('dialog');
	const beside = document.createElement('main');
	document.body.appendChild(beside);
	if (nest) {
		document.body.appendChild(holder);
		holder.appendChild(dialog);
	} else {
		document.body.appendChild(dialog);
	}

	const focused = { element: null as unknown };
	Object.defineProperty(document, 'activeElement', { get: () => focused.element, configurable: true });

	const slot = globalThis as { document?: unknown };
	const had = 'document' in slot;
	const before = slot.document;
	slot.document = document;
	return {
		dialog, beside, holder, focused,
		uninstall: () => {
			if (had) slot.document = before;
			else delete slot.document;
		},
	};
};

const fire = (element: LightElement, type: string): void => {
	(element as unknown as { dispatchEvent(event: unknown): boolean }).dispatchEvent({ type, target: element });
};

test('opening marks the rest of the page inert and closing gives it back', () => {
	const page = stage();
	try {
		const modal = dialogControl(page.dialog);
		assert.equal(page.beside.getAttribute('inert'), null);

		modal.open();
		assert.equal(page.beside.getAttribute('inert'), '',
			'a screen reader and the Tab key both stop at the dialog');
		assert.equal(page.dialog.getAttribute('inert'), null, 'the dialog itself is still reachable');
		assert.equal(modal.isOpen(), true);

		modal.close();
		assert.equal(page.beside.getAttribute('inert'), null);
		assert.equal(modal.isOpen(), false);
	} finally {
		page.uninstall();
	}
});

test('the branch the dialog sits in stays reachable', () => {
	const page = stage(true);
	try {
		const modal = dialogControl(page.dialog);
		modal.open();
		assert.equal(page.holder.getAttribute('inert'), null, 'the wrapper holding the dialog is not inert');
		assert.equal(page.beside.getAttribute('inert'), '');
		modal.close();
	} finally {
		page.uninstall();
	}
});

test('the keyboard goes back where it was', () => {
	const page = stage();
	try {
		const focuses: number[] = [];
		const invoker = { focus: () => focuses.push(1) };
		page.focused.element = invoker;

		const modal = dialogControl(page.dialog);
		modal.open();
		page.focused.element = null;
		assert.deepEqual(focuses, [], 'not yet: it is still open');

		modal.close();
		assert.deepEqual(focuses, [1], 'the element that had the keyboard has it again');
	} finally {
		page.uninstall();
	}
});

test('closing it any way at all runs onClose once', () => {
	const page = stage();
	try {
		const closed: number[] = [];
		const modal = dialogControl(page.dialog, { onClose: () => closed.push(1) });

		modal.open();
		modal.close();
		assert.deepEqual(closed, [1]);

		modal.close();
		assert.deepEqual(closed, [1], 'closing a closed dialog does nothing');
	} finally {
		page.uninstall();
	}
});

test('the element\'s own close event is what undoes everything', () => {
	const page = stage();
	try {
		const closed: number[] = [];
		const modal = dialogControl(page.dialog, { onClose: () => closed.push(1) });
		modal.open();

		// This is the event Escape arrives as, once the platform has cancelled and closed it.
		fire(page.dialog, 'close');
		assert.deepEqual(closed, [1], 'Escape closes it through the element, with no key listener here');
		assert.equal(page.beside.getAttribute('inert'), null);
		assert.equal(modal.isOpen(), false);
	} finally {
		page.uninstall();
	}
});

test('opening twice does nothing the second time', () => {
	const page = stage();
	try {
		const modal = dialogControl(page.dialog);
		modal.open();
		const first = page.beside.getAttribute('inert');
		modal.open();
		assert.equal(page.beside.getAttribute('inert'), first);

		modal.close();
		assert.equal(page.beside.getAttribute('inert'), null,
			'one close is enough, so the page is not left inert');
	} finally {
		page.uninstall();
	}
});

test('the teardown closes it, so a dialog taken down never leaves the page inert', () => {
	const page = stage();
	try {
		const closed: number[] = [];
		const modal = dialogControl(page.dialog, { onClose: () => closed.push(1) });
		modal.open();
		modal.stop();

		assert.equal(page.beside.getAttribute('inert'), null);
		assert.deepEqual(closed, [1]);

		fire(page.dialog, 'close');
		assert.deepEqual(closed, [1], 'and the listener is off');
	} finally {
		page.uninstall();
	}
});

test('with no showModal the element carries the open attribute instead', () => {
	const page = stage();
	try {
		const modal = dialogControl(page.dialog);
		modal.open();
		assert.equal(page.dialog.getAttribute('open'), '',
			'which is what <dialog open> means, so a static render writes an open dialog');
		modal.close();
		assert.equal(page.dialog.getAttribute('open'), null);
	} finally {
		page.uninstall();
	}
});

test('two dialogs holding the same branch: it comes back when the last one lets go', () => {
	// A chooser's dialog inside an open modal act, or two country fields in one form: both dialogs
	// sit in the same branch, so both take the same other branch out of the reading order. The inner
	// one closing must not put back what the outer one is still holding (design 250).
	const page = stage(true);
	const second = (globalThis as unknown as { document: { createElement(tag: string): LightElement } })
		.document.createElement('dialog');
	page.holder.appendChild(second);
	try {
		const outer = dialogControl(page.dialog);
		const inner = dialogControl(second);

		outer.open();
		assert.equal(page.beside.getAttribute('inert'), '', 'the outer one took the rest of the page out');
		inner.open();
		assert.equal(page.beside.getAttribute('inert'), '', 'and so did the inner one, for its own reasons');

		inner.close();
		assert.equal(page.beside.getAttribute('inert'), '',
			'closing the inner one leaves what the outer one is still holding');

		outer.close();
		assert.equal(page.beside.getAttribute('inert'), null,
			'and the last one to let go is what puts it back');
	} finally {
		page.uninstall();
	}
});

test('a teardown while another dialog holds the same branch puts back only its own share', () => {
	const page = stage(true);
	const second = (globalThis as unknown as { document: { createElement(tag: string): LightElement } })
		.document.createElement('dialog');
	page.holder.appendChild(second);
	try {
		const outer = dialogControl(page.dialog);
		const inner = dialogControl(second);
		outer.open();
		inner.open();

		inner.stop();
		assert.equal(page.beside.getAttribute('inert'), '',
			'a dialog torn down while open leaves the other one\'s hold in place');
		outer.stop();
		assert.equal(page.beside.getAttribute('inert'), null);
	} finally {
		page.uninstall();
	}
});
