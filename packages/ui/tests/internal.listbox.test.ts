// The listbox behaviour on its own (design 223). White box, because it is not exported.
//
// The trigger and the list are built by hand in the light tree, so what these tests say is what the
// behaviour does and not what a component asked it to do. The keys go to whatever holds the focus,
// which is the trigger for an `option` list and the list itself for a `menuitem` one (design 223).
// The pointer half and the outside click both listen on the page, so a stand-in page is installed
// around the call, which is the shape `internal.dismiss.test.ts` already uses.

import test from 'node:test';
import assert from 'node:assert/strict';

import { mutable } from '@aweftjs/core';
import { createDocument } from '@aweftjs/dom';
import type { LightElement } from '@aweftjs/dom';

import { listBox } from '../src/listbox.ts';

interface Listener { (event: unknown): void }

/** A stand-in page: it records what was listened for and delivers events on demand. */
const fakePage = (): {
	send(type: string, event: Record<string, unknown>): void;
	count(type: string): number;
	install(): () => void;
} => {
	const listeners = new Map<string, Set<Listener>>();
	const page = {
		addEventListener: (type: string, listener: Listener) => {
			const set = listeners.get(type) ?? new Set<Listener>();
			set.add(listener);
			listeners.set(type, set);
		},
		removeEventListener: (type: string, listener: Listener) => { listeners.get(type)?.delete(listener); },
	};
	return {
		send: (type, event) => { for (const listener of [...listeners.get(type) ?? []]) listener(event); },
		count: (type) => listeners.get(type)?.size ?? 0,
		install: () => {
			const slot = globalThis as { document?: unknown };
			const had = 'document' in slot;
			const before = slot.document;
			slot.document = page;
			return () => {
				if (had) slot.document = before;
				else delete slot.document;
			};
		},
	};
};

/** A cell, in the two lines the behaviour actually asks for. */
const cell = (start: unknown = null): { get(): unknown; set(value: unknown): void } => {
	let held = start;
	return { get: () => held, set: (value) => { held = value; } };
};

interface Rig {
	readonly trigger: LightElement;
	readonly list: LightElement;
	readonly rows: LightElement[];
	readonly open: { get(): boolean; set(value: boolean): void };
	readonly active: { get(): unknown; set(value: unknown): void };
	readonly picked: string[];
	readonly closed: string[];
	readonly opened: number[];
	/** How many times the list was asked for the focus. The light tree has none to give. */
	readonly focused: () => number;
	stop(): void;
	press(key: string): { prevented: boolean };
}

/** A trigger and a list of options named by their text: Apple, Apricot, Banana, Cherry. */
const rig = (options: {
	labels?: readonly string[];
	off?: readonly number[];
	chosen?: number;
	open?: boolean;
	role?: string;
	typeahead?: boolean;
	inside?: () => readonly unknown[];
} = {}): Rig => {
	const document = createDocument();
	const trigger = document.createElement('button');
	const list = document.createElement('div');
	const role = options.role ?? 'option';
	document.body.appendChild(trigger);
	document.body.appendChild(list);

	const labels = options.labels ?? ['Apple', 'Apricot', 'Banana', 'Cherry'];
	const rows: LightElement[] = [];
	for (let at = 0; at < labels.length; at += 1) {
		const row = document.createElement('div');
		row.setAttribute('role', role);
		row.setAttribute('id', `row-${String(at)}`);
		row.setAttribute('aria-selected', at === options.chosen ? 'true' : 'false');
		if (options.off?.includes(at) === true) row.setAttribute('aria-disabled', 'true');
		row.appendChild(document.createTextNode(labels[at]!));
		list.appendChild(row);
		rows.push(row);
	}

	const open = mutable(options.open ?? true);
	const active = cell();
	const picked: string[] = [];
	const closed: string[] = [];
	const opened: number[] = [];
	// The light tree has no focus, so the call is recorded: what matters is that it was asked for.
	const seat = { count: 0 };
	(list as unknown as { focus(): void }).focus = () => { seat.count += 1; };

	const stop = listBox(trigger, {
		list: () => list,
		role: options.role,
		open,
		active,
		onOpen: () => { opened.push(1); open.set(true); },
		onClose: (reason) => { closed.push(reason); open.set(false); },
		onPick: (item) => { picked.push((item as LightElement).getAttribute('id') ?? ''); },
		typeahead: options.typeahead,
		inside: options.inside,
	});

	return {
		trigger, list, rows, open, active, picked, closed, opened, stop,
		focused: () => seat.count,
		press: (key) => {
			let prevented = false;
			// Where a browser would deliver it: the trigger while the list is closed, and for a menu
			// the list itself once it is open and has taken the focus.
			const on = role === 'menuitem' && open.get() ? list : trigger;
			(on as unknown as { dispatchEvent(event: unknown): boolean }).dispatchEvent({
				type: 'keydown', key, target: on, preventDefault: () => { prevented = true; },
			});
			return { prevented };
		},
	};
};

test('the arrows move the active option and wrap at each end', () => {
	const page = fakePage();
	const uninstall = page.install();
	try {
		const one = rig();
		assert.equal(one.active.get(), null, 'nothing is active before a key');

		one.press('ArrowDown');
		assert.equal(one.active.get(), 'row-0', 'the first key lands on the first option');
		one.press('ArrowDown');
		assert.equal(one.active.get(), 'row-1');

		// The wrap, which is the choice design 223 records: the tablist wraps and so does this.
		one.press('ArrowUp');
		one.press('ArrowUp');
		assert.equal(one.active.get(), 'row-3', 'up past the first option is the last one');
		one.press('ArrowDown');
		assert.equal(one.active.get(), 'row-0', 'and down past the last is the first');

		assert.equal(one.press('ArrowDown').prevented, true, 'the page does not scroll under it');
		one.stop();
	} finally {
		uninstall();
	}
});

test('Home and End go to the ends, and a disabled option is stepped over', () => {
	const page = fakePage();
	const uninstall = page.install();
	try {
		const one = rig({ off: [0, 3] });
		one.press('End');
		assert.equal(one.active.get(), 'row-2', 'the last option anyone may choose, not the last one');
		one.press('Home');
		assert.equal(one.active.get(), 'row-1');
		one.press('ArrowUp');
		assert.equal(one.active.get(), 'row-2', 'and the arrows step over the two out of reach');
		one.stop();
	} finally {
		uninstall();
	}
});

test('type-ahead finds an option by what it reads, and a pause starts again', (t) => {
	// The buffer's life is measured against the clock, so the clock is the mock's here: a run of
	// keys in one tick is one buffer, and a tick past its life is a new search.
	t.mock.timers.enable({ apis: ['Date'] });
	const page = fakePage();
	const uninstall = page.install();
	try {
		const one = rig();
		one.press('b');
		assert.equal(one.active.get(), 'row-2', 'the first option beginning with b');

		t.mock.timers.tick(1000);
		one.press('a');
		one.press('p');
		one.press('r');
		assert.equal(one.active.get(), 'row-1', 'apr is Apricot, not Apple');

		// The same letter twice, after the pause, is a request for the next option beginning with it.
		t.mock.timers.tick(1000);
		one.press('a');
		assert.equal(one.active.get(), 'row-0', 'a fresh buffer starts after the option it is on');
		one.press('a');
		assert.equal(one.active.get(), 'row-1', 'and a letter repeated steps to the next one');

		t.mock.timers.tick(1000);
		assert.equal(one.press('c').prevented, true, 'a letter the list used is not the page\'s');
		assert.equal(one.active.get(), 'row-3');

		t.mock.timers.tick(1000);
		one.press('z');
		assert.equal(one.active.get(), 'row-3', 'a letter nothing begins with moves nothing');
		one.stop();
	} finally {
		uninstall();
	}
});

test('Enter and Space pick the active option, and Escape and Tab close', () => {
	const page = fakePage();
	const uninstall = page.install();
	try {
		const one = rig();
		one.press('ArrowDown');
		one.press('Enter');
		assert.deepEqual(one.picked, ['row-0']);

		one.open.set(true);
		one.press('ArrowDown');
		assert.equal(one.press(' ').prevented, true);
		assert.deepEqual(one.picked, ['row-0', 'row-1'], 'Space picks as Enter does');

		one.open.set(true);
		const escape = one.press('Escape');
		assert.deepEqual(one.closed, ['escape']);
		assert.equal(escape.prevented, true);

		one.open.set(true);
		const tab = one.press('Tab');
		assert.deepEqual(one.closed, ['escape', 'tab']);
		assert.equal(tab.prevented, false, 'Tab keeps its own default, which is the point of it');
		one.stop();
	} finally {
		uninstall();
	}
});

test('a closed list opens on the keys that would move it, and a letter opens and moves', () => {
	const page = fakePage();
	const uninstall = page.install();
	try {
		const down = rig({ open: false });
		down.press('ArrowDown');
		assert.equal(down.opened.length, 1);
		assert.equal(down.active.get(), 'row-0');
		down.stop();

		const up = rig({ open: false });
		up.press('ArrowUp');
		assert.equal(up.active.get(), 'row-3', 'up into a closed list arrives at the end of it');
		up.stop();

		const enter = rig({ open: false, chosen: 2 });
		enter.press('Enter');
		assert.deepEqual(enter.picked, [], 'Enter on a closed list opens it rather than picking');
		assert.equal(enter.active.get(), 'row-2', 'and arrives on the option that is chosen');
		enter.stop();

		const typed = rig({ open: false });
		typed.press('c');
		assert.equal(typed.opened.length, 1, 'a letter opens it');
		assert.equal(typed.active.get(), 'row-3', 'and moves in the same press');
		typed.stop();

		const other = rig({ open: false });
		assert.equal(other.press('F2').prevented, false, 'a key the map does not know is the page\'s');
		assert.equal(other.opened.length, 0);
		other.stop();
	} finally {
		uninstall();
	}
});

test('the active option is settled when the cell names an option that is not there', () => {
	const page = fakePage();
	const uninstall = page.install();
	try {
		const one = rig({ chosen: 2 });
		one.active.set('row-gone');
		one.press('ArrowDown');
		assert.equal(one.active.get(), 'row-3',
			'settled onto the chosen option, then moved one from there');

		const fresh = rig({ off: [0] });
		fresh.active.set('row-gone');
		fresh.press('Home');
		assert.equal(fresh.active.get(), 'row-1', 'with nothing chosen, the first that can take it');
		one.stop();
		fresh.stop();
	} finally {
		uninstall();
	}
});

test('the pointer sets the active option and a click picks it', () => {
	const page = fakePage();
	const uninstall = page.install();
	try {
		const one = rig({ off: [3] });
		page.send('mouseover', { target: one.rows[2] });
		assert.equal(one.active.get(), 'row-2');

		page.send('mouseover', { target: one.rows[3] });
		assert.equal(one.active.get(), 'row-2', 'an option nobody may choose is not hovered onto');

		page.send('click', { target: one.rows[1] });
		assert.deepEqual(one.picked, ['row-1']);

		page.send('click', { target: one.trigger });
		assert.deepEqual(one.picked, ['row-1'], 'a click outside the list picks nothing');

		one.open.set(false);
		page.send('mouseover', { target: one.rows[0] });
		assert.equal(one.active.get(), 'row-2', 'and nothing moves while the list is closed');
		one.stop();
	} finally {
		uninstall();
	}
});

test('a mousedown away from the trigger and the list closes it', () => {
	const page = fakePage();
	const uninstall = page.install();
	try {
		const one = rig();
		page.send('mousedown', { target: one.rows[0] });
		page.send('mousedown', { target: one.trigger });
		assert.deepEqual(one.closed, [], 'the trigger and the list both count as inside');

		one.open.set(true);
		page.send('mousedown', { target: { parentNode: null } });
		assert.deepEqual(one.closed, ['outside']);
		one.stop();
	} finally {
		uninstall();
	}
});

test('the role is the parameter, so a menu gets the same map', () => {
	const page = fakePage();
	const uninstall = page.install();
	try {
		const one = rig({ role: 'menuitem', labels: ['Mute', 'Block', 'Delete'] });
		one.press('ArrowDown');
		one.press('ArrowDown');
		assert.equal(one.active.get(), 'row-1');
		one.press('Enter');
		assert.deepEqual(one.picked, ['row-1']);

		// And nothing answers to the other role, so the two lists cannot read each other's rows.
		const wrong = rig({ role: 'menuitem' });
		wrong.list.setAttribute('role', 'listbox');
		wrong.stop();
		one.stop();
	} finally {
		uninstall();
	}
});

test('a menu list takes the focus and the keys as it opens, and an option list does not', () => {
	const page = fakePage();
	const uninstall = page.install();
	try {
		// ARIA does not allow `aria-activedescendant` on the `role="button"` a menu opens from, so the
		// focus goes into the `role="menu"` instead (designs 223, 225).
		const menu = rig({ role: 'menuitem', open: false, labels: ['Mute', 'Block'] });
		assert.equal(menu.focused(), 0, 'a closed menu leaves the focus where the person put it');
		assert.equal(menu.list.listeners.get('keydown')?.size ?? 0, 0);

		menu.open.set(true);
		assert.equal(menu.focused(), 1, 'opening it moved the focus into the list');
		assert.equal(menu.list.listeners.get('keydown')?.size ?? 0, 1,
			'and the keys are listened for there, because that is where they now arrive');
		menu.press('ArrowDown');
		assert.equal(menu.active.get(), 'row-0', 'a key on the list moves the active row');

		menu.open.set(false);
		assert.equal(menu.list.listeners.get('keydown')?.size ?? 0, 0, 'closing gives the keys back');

		// A select's trigger is a `role="combobox"`, which may carry the attribute, so nothing moves.
		const select = rig({ open: false });
		select.open.set(true);
		assert.equal(select.focused(), 0, 'an option list is driven from the trigger it opened from');
		assert.equal(select.list.listeners.get('keydown')?.size ?? 0, 0);

		menu.stop();
		select.stop();
	} finally {
		uninstall();
	}
});

test('an option added after it was installed is followed, and the teardown removes everything', () => {
	const page = fakePage();
	const uninstall = page.install();
	try {
		const one = rig({ labels: ['Apple', 'Banana'] });
		const grown = one.list.ownerDocument.createElement('div');
		grown.setAttribute('role', 'option');
		grown.setAttribute('id', 'row-2');
		grown.appendChild(one.list.ownerDocument.createTextNode('Cherry'));
		one.list.appendChild(grown);

		one.press('End');
		assert.equal(one.active.get(), 'row-2', 'the options are read again on every event');

		one.stop();
		assert.equal(one.trigger.listeners.get('keydown')?.size ?? 0, 0);
		assert.equal(page.count('mouseover'), 0);
		assert.equal(page.count('click'), 0);
		assert.equal(page.count('mousedown'), 0);
	} finally {
		uninstall();
	}
});

test('with no element to listen on it installs nothing and removes nothing', () => {
	// A static render has no page and no listeners, and the behaviour is called all the same.
	const stop = listBox(null, {
		list: () => null,
		open: mutable(true),
		active: cell(),
		onClose: () => { throw new Error('nothing to close'); },
		onPick: () => { throw new Error('nothing to pick'); },
	});
	assert.doesNotThrow(stop);
});

test('with the type-ahead off a printable character is left alone, open or closed', () => {
	const page = fakePage();
	const uninstall = page.install();
	try {
		// What a search box needs: the character has to reach it, and a key this swallows never gets
		// there (design 250). Everything else about the map is unchanged.
		const one = rig({ typeahead: false });
		const first = one.press('b');
		assert.equal(one.active.get(), null, 'no jump to Banana');
		assert.equal(first.prevented, false, 'and the character is the box\'s to keep');

		one.press('ArrowDown');
		assert.equal(one.active.get(), 'row-0', 'the arrows still move');
		assert.equal(one.press('Enter').prevented, true, 'and Enter still picks');
		assert.deepEqual(one.picked, ['row-0']);

		const two = rig({ typeahead: false, open: false });
		const closed = two.press('b');
		assert.deepEqual(two.opened, [], 'a character does not open it either');
		assert.equal(closed.prevented, false);
		two.press('ArrowDown');
		assert.deepEqual(two.opened, [1], 'while the arrows still do');

		one.stop();
		two.stop();
	} finally {
		uninstall();
	}
});

test('inside widens what a mousedown counts as inside, for a list in a dialog', () => {
	const page = fakePage();
	const uninstall = page.install();
	try {
		const one = rig();
		page.send('mousedown', { target: one.list.parentNode });
		assert.deepEqual(one.closed, ['outside'],
			'the box the trigger and the list sit in is outside both of them');
		one.stop();

		// What a dialog hands over (design 250): a press on its heading, its padding or its backdrop
		// is a press inside the thing the list belongs to.
		const held: unknown[] = [];
		const two = rig({ inside: () => held });
		held.push(two.list.parentNode);
		page.send('mousedown', { target: two.list.parentNode });
		assert.deepEqual(two.closed, [], 'and the same press is inside once it has been');
		two.stop();
	} finally {
		uninstall();
	}
});
