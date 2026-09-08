// `FileDrop` in the light tree (design 137): what it accepts, what it refuses and why, what it
// tells the page through `ready`, and the two ways of opening the file dialog.
//
// The platform `File` never appears here. What the component holds is whatever the host handed it,
// so a plain object with a name, a type and a size is exactly as much as it reads.

import test from 'node:test';
import assert from 'node:assert/strict';

import { mutable, mutableArray } from '@aweftjs/core';
import { createDocument, parseHtml } from '@aweftjs/dom';
import type { ElementLike, LightElement, NodeLike } from '@aweftjs/dom';
import { FileDrop, Icons, context, h, hydrate, mount, render } from '@aweftjs/ui';

import { testIcons } from './fixtures/icons.ts';

// The zone's prompt shows an `upload`, and `Icons` starts empty (design 144).
const answered = (item: unknown): unknown => h(Icons as never, { value: testIcons }, item);

const elements = (node: NodeLike | null): LightElement[] => {
	const found: LightElement[] = [];
	for (let n = node; n !== null; n = n.nextSibling) {
		if (n.nodeType === 1) found.push(n as unknown as LightElement);
		found.push(...elements(n.firstChild));
	}
	return found;
};

const byTag = (root: NodeLike | null, tag: string): LightElement => {
	const found = elements(root).find((element) => element.localName === tag);
	assert.ok(found !== undefined, `no <${tag}> on the page`);
	return found;
};

const fire = (element: LightElement, type: string, extra: Record<string, unknown> = {}): void => {
	(element as unknown as { dispatchEvent(event: unknown): boolean })
		.dispatchEvent({ type, target: element, preventDefault: () => undefined, ...extra });
};

/** What a host hands over: a name, a MIME type and a size. */
const file = (name: string, type: string, size = 10): Record<string, unknown> => ({ name, type, size });

interface Entry {
	readonly name: string;
	readonly file: unknown;
	readonly status: string;
	readonly error?: string;
}

/** A zone, its input and its list, ready to be given files. */
const zone = (props: Record<string, unknown> = {}, ...children: unknown[]): {
	body: ElementLike;
	input: LightElement;
	files: Entry[];
	list: ReturnType<typeof mutableArray<Entry>>;
	give(...given: Record<string, unknown>[]): void;
	stop(): void;
} => {
	const list = mutableArray<Entry>();
	const document = createDocument();
	const stop = mount(document.body, answered(h(FileDrop as never, { files: list, ...props }, ...children)));
	const input = byTag(document.body.firstChild, 'input');
	return {
		body: document.body,
		input,
		get files() { return [...list]; },
		list,
		give: (...given) => {
			(input as unknown as Record<string, unknown>)['files'] = given;
			fire(input, 'change');
		},
		stop: () => { stop(); },
	};
};

// --- what it takes and what it refuses -----------------------------------------------------------

test('a file the zone accepts lands as a ready entry, and the page hears about it', () => {
	const dropped: unknown[][] = [];
	const picked = file('shot.png', 'image/png');
	const held = zone({ extensions: ['image/png'], onDrop: (given: unknown[]) => dropped.push(given) });

	held.give(picked);
	assert.deepEqual(held.files.map((entry) => [entry.name, entry.status]), [['shot.png', 'ready']]);
	assert.equal(held.files[0]!.file, picked, 'the entry carries the file the host handed over');
	assert.deepEqual(dropped, [[picked]], 'onDrop is called with what was accepted, once');
	held.stop();
});

test('a file of the wrong type is refused, and stays in the list saying why', () => {
	const held = zone({ extensions: ['image/png'] });
	held.give(file('notes.pdf', 'application/pdf'));

	assert.equal(held.files.length, 1, 'a refused file is not dropped in silence');
	assert.equal(held.files[0]!.status, 'error');
	assert.match(held.files[0]!.error ?? '', /notes\.pdf is not one of the accepted types/);
	held.stop();
});

test('extensions match a dotted suffix, a MIME type and a wildcard', () => {
	for (const [wanted, name, type, ok] of [
		[['.csv'], 'rows.csv', 'text/csv', true],
		[['.csv'], 'rows.tsv', 'text/tab-separated-values', false],
		[['image/*'], 'shot.jpg', 'image/jpeg', true],
		[['image/*'], 'notes.pdf', 'application/pdf', false],
		[['image/png'], 'shot.png', 'image/png', true],
	] as const) {
		const held = zone({ extensions: [...wanted] });
		held.give(file(name, type));
		assert.equal(held.files[0]!.status, ok ? 'ready' : 'error',
			`${wanted.join(',')} ${ok ? 'takes' : 'refuses'} ${name}`);
		held.stop();
	}
});

test('with no extensions declared, anything is taken', () => {
	const held = zone();
	held.give(file('anything.bin', ''));
	assert.equal(held.files[0]!.status, 'ready');
	held.stop();
});

test('a file over the limit is refused, and the limit is in the reason', () => {
	const held = zone({ limit: 100 });
	held.give(file('big.png', 'image/png', 101));
	assert.equal(held.files[0]!.status, 'error');
	assert.match(held.files[0]!.error ?? '', /over the 100 byte limit/);

	held.give(file('small.png', 'image/png', 100));
	assert.equal(held.files[1]!.status, 'ready', 'exactly the limit is inside it');
	held.stop();
});

test('multiple false keeps one file and replaces the one before it', () => {
	const held = zone({ multiple: false });
	held.give(file('one.png', 'image/png'));
	assert.deepEqual(held.files.map((entry) => entry.name), ['one.png']);

	held.give(file('two.png', 'image/png'));
	assert.deepEqual(held.files.map((entry) => entry.name), ['two.png'], 'the second replaces the first');

	held.give(file('three.png', 'image/png'), file('four.png', 'image/png'));
	assert.deepEqual(held.files.map((entry) => [entry.name, entry.status]),
		[['three.png', 'ready'], ['four.png', 'error']],
		'and a second file in one batch is refused rather than taken quietly');
	assert.match(held.files[1]!.error ?? '', /only one file is accepted/);
	held.stop();
});

test('multiple true adds to the list rather than replacing it', () => {
	const held = zone();
	held.give(file('one.png', 'image/png'));
	held.give(file('two.png', 'image/png'), file('three.png', 'image/png'));
	assert.deepEqual(held.files.map((entry) => entry.name), ['one.png', 'two.png', 'three.png']);
	held.stop();
});

test('a disabled zone takes nothing', () => {
	const held = zone({ disabled: true });
	held.give(file('one.png', 'image/png'));
	assert.deepEqual(held.files, []);
	held.stop();
});

// --- the ready cell --------------------------------------------------------------------------------

test('ready follows the entries, and goes null while one of them is loading', () => {
	const ready = mutable<unknown>('start');
	const held = zone({ ready });
	assert.deepEqual(ready.get(), [], 'an empty zone is ready with nothing');

	const one = file('one.png', 'image/png');
	held.give(one);
	assert.deepEqual(ready.get(), [one]);

	// The application says it is uploading by writing the entry back, which is the edit a list hears.
	held.list[0] = { ...held.list[0]!, status: 'loading' };
	assert.equal(ready.get(), null, 'nothing is ready while anything is still going up');

	held.list[0] = { ...held.list[0]!, status: 'ready' };
	assert.deepEqual(ready.get(), [one], 'and it comes back when the upload lands');
	held.stop();
});

test('ready is the one file when multiple is false, and counts no refusal', () => {
	const ready = mutable<unknown>(null);
	const held = zone({ ready, multiple: false, extensions: ['image/png'] });

	const one = file('one.png', 'image/png');
	held.give(one);
	assert.equal(ready.get(), one, 'the file itself, not a list of one');

	held.give(file('notes.pdf', 'application/pdf'));
	assert.equal(ready.get(), null, 'a refused file is not a ready file');
	held.stop();
});

test('ready counts every entry that is not in error', () => {
	const ready = mutable<unknown>(null);
	const held = zone({ ready, extensions: ['image/png'] });
	const good = file('one.png', 'image/png');
	held.give(good, file('notes.pdf', 'application/pdf'));
	assert.deepEqual(ready.get(), [good]);
	held.stop();
});

// --- opening the dialog ------------------------------------------------------------------------------

test('a click on the zone opens the dialog, and clickable false does not', () => {
	for (const [clickable, expected] of [[undefined, 1], [false, 0]] as const) {
		const held = zone(clickable === undefined ? {} : { clickable });
		let clicks = 0;
		(held.input as unknown as Record<string, unknown>)['click'] = (): void => { clicks += 1; };
		fire(byTag(held.body.firstChild, 'div'), 'click');
		assert.equal(clicks, expected, `clickable ${String(clickable)} opens it ${String(expected)} time(s)`);
		held.stop();
	}
});

test('a click that came from the input or its label does not open the dialog twice', () => {
	const held = zone();
	let clicks = 0;
	(held.input as unknown as Record<string, unknown>)['click'] = (): void => { clicks += 1; };

	// The click the input itself fires bubbles back to the zone, and the label opens the dialog on
	// its own, so both have to be ignored where the zone handles a click.
	const dropZone = byTag(held.body.firstChild, 'div');
	fire(dropZone, 'click', { target: held.input });
	fire(dropZone, 'click', { target: byTag(held.body.firstChild, 'label') });
	assert.equal(clicks, 0);
	held.stop();
});

test('FileDrop.Button opens the input, and one outside a zone asserts with the fix', () => {
	const held = zone({}, h(FileDrop.Button as never, { label: 'Choose a file' }));
	let clicks = 0;
	(held.input as unknown as Record<string, unknown>)['click'] = (): void => { clicks += 1; };

	const button = elements(held.body.firstChild).find((element) => element.localName === 'button')!;
	assert.equal(button.textContent, 'Choose a file');
	fire(button, 'click');
	assert.equal(clicks, 1, 'the button reached the input through the zone');
	held.stop();

	const document = createDocument();
	assert.throws(
		() => { mount(document.body, h(FileDrop.Button as never, { label: 'Choose' })); },
		/FileDrop.Button needs a FileDrop above it/,
	);
});

test('the input is named by the label, whether or not the chrome was replaced', () => {
	for (const children of [[], [h('p', {}, 'my own chrome')]]) {
		const held = zone({}, ...children);
		const label = byTag(held.body.firstChild, 'label');
		assert.equal(label.getAttribute('for'), held.input.getAttribute('id'),
			'the file input has a name for a screen reader either way');
		assert.notEqual(label.textContent, '');
		held.stop();
	}
});

test('children replace the prompt and the listing, and nothing else', () => {
	const held = zone({}, h('p', { id: 'mine' }, 'my own chrome'));
	held.give(file('one.png', 'image/png'));
	assert.equal(elements(held.body.firstChild).find((e) => e.localName === 'ul'), undefined,
		'no default listing beside the caller\'s own chrome');
	assert.ok(elements(held.body.firstChild).some((e) => e.getAttribute('id') === 'mine'));
	assert.equal(held.files.length, 1, 'and the zone still takes files');
	held.stop();
});

test('the default listing shows each entry and its remove button drops it', () => {
	const held = zone();
	held.give(file('one.png', 'image/png'), file('two.png', 'image/png'));

	const rows = elements(held.body.firstChild).filter((element) => element.localName === 'li');
	assert.equal(rows.length, 2);
	assert.match(rows[0]!.textContent ?? '', /one\.png/);

	const remove = elements(rows[0] ?? null).find((element) =>
		element.getAttribute('aria-label') === 'Remove one.png')!;
	fire(remove, 'click');
	assert.deepEqual(held.files.map((entry) => entry.name), ['two.png']);
	held.stop();
});

// --- dragging ------------------------------------------------------------------------------------------

test('the dragging segment is counted, so crossing onto a child does not end it', () => {
	const held = zone();
	const dropZone = byTag(held.body.firstChild, 'div');
	const plain = dropZone.getAttribute('class');

	fire(dropZone, 'dragenter');
	const dragging = dropZone.getAttribute('class');
	assert.notEqual(dragging, plain, 'the dragging segment reached the class list');

	// A `dragleave` fires at the zone every time the pointer crosses onto one of its own children,
	// and the matching `dragenter` for the child has already arrived.
	fire(dropZone, 'dragenter');
	fire(dropZone, 'dragleave');
	assert.equal(dropZone.getAttribute('class'), dragging, 'one leave inside is not leaving');

	fire(dropZone, 'dragleave');
	assert.equal(dropZone.getAttribute('class'), plain, 'and the last one is');
	held.stop();
});

test('a drop takes the files off the transfer and clears the highlight', () => {
	const held = zone({ extensions: ['image/png'] });
	const dropZone = byTag(held.body.firstChild, 'div');
	const plain = dropZone.getAttribute('class');

	fire(dropZone, 'dragenter');
	fire(dropZone, 'dragenter');
	const dropped = file('shot.png', 'image/png');
	fire(dropZone, 'drop', { dataTransfer: { files: [dropped] } });

	assert.deepEqual(held.files.map((entry) => entry.name), ['shot.png']);
	assert.equal(dropZone.getAttribute('class'), plain,
		'a drop ends the drag whatever the counter said');
	held.stop();
});

// --- after a hydration -------------------------------------------------------------------------

/**
 * The server's markup on a page, with the component hydrated onto it. Nothing this package built
 * on the client is on that page: the adopted nodes are the server's, and a component that kept the
 * one it made is holding an orphan (design 133).
 */
const hydrated = async (...children: unknown[]): Promise<{
	body: ElementLike;
	input: LightElement;
	clicks(): number;
	stop(): void;
}> => {
	const build = (): unknown => answered(h(FileDrop as never, {}, ...children));
	const server = context();
	const markup = await render(h(build), { context: server });

	const document = createDocument();
	for (const node of parseHtml(markup, document)) document.body.appendChild(node);
	for (const node of parseHtml(`<style data-aweft>${server.theme.markup()}</style>`, document)) {
		document.head.appendChild(node);
	}
	const off = hydrate(document.body, build);

	const input = byTag(document.body.firstChild, 'input');
	let count = 0;
	(input as unknown as Record<string, unknown>)['click'] = (): void => { count += 1; };
	return { body: document.body, input, clicks: () => count, stop: () => { off(); } };
};

test('a click on a hydrated zone opens the input that is on the page', async () => {
	const held = await hydrated();
	fire(byTag(held.body.firstChild, 'div'), 'click');
	assert.equal(held.clicks(), 1, 'the zone found the adopted input, not the one it built');
	held.stop();
});

test('a hydrated FileDrop.Button opens the input that is on the page', async () => {
	const held = await hydrated(h(FileDrop.Button as never, { label: 'Choose a file' }));
	const button = elements(held.body.firstChild).find((element) => element.localName === 'button')!;
	fire(button, 'click');
	assert.equal(held.clicks(), 1, 'the button found the adopted input through the zone');
	held.stop();
});

test('a hydrated zone still ignores a click the label or the input already handled', async () => {
	const held = await hydrated();
	const dropZone = byTag(held.body.firstChild, 'div');
	fire(dropZone, 'click', { target: held.input });
	fire(dropZone, 'click', { target: byTag(held.body.firstChild, 'label') });
	assert.equal(held.clicks(), 0, 'neither opens the dialog a second time');
	held.stop();
});

// --- the rules a state prop and a disabled zone follow -------------------------------------------

test('files given a plain array is a loud assert naming the fix', () => {
	const document = createDocument();
	assert.throws(
		() => { mount(document.body, h(FileDrop as never, { files: [] })); },
		/FileDrop files takes a cell, not a value; pass files=\{mutableArray\(\)\}/,
	);
});

test('a disabled zone does not light up for a drop it is going to refuse', () => {
	const held = zone({ disabled: true });
	const dropZone = byTag(held.body.firstChild, 'div');
	const plain = dropZone.getAttribute('class');

	fire(dropZone, 'dragenter');
	assert.equal(dropZone.getAttribute('class'), plain,
		'no dragging segment, because `add` would refuse the file anyway');
	held.stop();
});

test('an onDrop that throws is reported and the list keeps the entry', () => {
	const real = globalThis.queueMicrotask;
	const thrown: string[] = [];
	globalThis.queueMicrotask = (fn: () => void): void => {
		try { fn(); } catch (error) { thrown.push(String(error)); }
	};

	try {
		const held = zone({ onDrop: () => { throw new Error('the app blew up'); } });
		held.give(file('shot.png', 'image/png'));
		assert.deepEqual(thrown, ['Error: the app blew up'],
			'reported where a handler that throws is reported, not thrown into the mount');
		assert.deepEqual(held.files.map((entry) => entry.status), ['ready'],
			'and the edit the list already made stands');
		held.stop();
	} finally {
		globalThis.queueMicrotask = real;
	}
});
