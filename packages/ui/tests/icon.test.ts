// `Icon` and `Icons`: what the element is built from, and where a name is looked up (design 131).

import test from 'node:test';
import assert from 'node:assert/strict';

import { mutable } from '@aweftjs/core';
import { createDocument, parseHtml, toHtml } from '@aweftjs/dom';
import type { LightElement, NodeLike } from '@aweftjs/dom';
import type { IconData } from '@aweftjs/ui';
import { Icon, Icons, context, h, hydrate, mount, render, standardIcons } from '@aweftjs/ui';

const elements = (node: NodeLike | null): LightElement[] => {
	const found: LightElement[] = [];
	for (let n = node; n !== null; n = n.nextSibling) {
		if (n.nodeType === 1) found.push(n as unknown as LightElement);
		found.push(...elements(n.firstChild));
	}
	return found;
};

const first = (node: NodeLike | null, tag: string): LightElement => {
	const found = elements(node).find((element) => element.localName === tag);
	assert.ok(found !== undefined, `no <${tag}>`);
	return found;
};

const page = (item: unknown): { root: NodeLike | null; stop: () => void } => {
	const document = createDocument();
	const stop = mount(document.body, item);
	return { root: document.body.firstChild, stop: () => { stop(); } };
};

const square: IconData = { body: '<rect width="10" height="10"/>', width: 10, height: 10 };

/** A pack in the shape a set publishes: its box at the root, and its icons carrying none. */
const set = {
	prefix: 'set',
	icons: { check: { body: '<path d="M4 12 10 18 20 6"/>' }, big: { body: '<rect/>', width: 48, height: 48 } },
	aliases: { done: { parent: 'check' }, expand: { parent: 'check', rotate: 1 } },
	width: 24,
	height: 24,
};

test('an icon is built from the data, and the body is inside it as real nodes', () => {
	const { root, stop } = page(h(Icon as never, { name: square }));
	const element = first(root, 'svg');
	assert.equal(element.getAttribute('viewBox'), '0 0 10 10', 'the box comes from the data');
	assert.equal(element.getAttribute('fill'), 'currentColor');
	assert.equal(first(root, 'rect').getAttribute('width'), '10',
		'the body is a node in the tree, not a string on the element');
	stop();
});

test('a nameless icon is hidden from assistive technology, and a labelled one is an image', () => {
	const quiet = page(h(Icon as never, { name: square }));
	const hidden = first(quiet.root, 'svg');
	assert.equal(hidden.getAttribute('aria-hidden'), 'true');
	assert.equal(hidden.getAttribute('focusable'), 'false');
	assert.equal(hidden.getAttribute('role'), null);
	quiet.stop();

	const named = page(h(Icon as never, { name: square, label: 'done' }));
	const shown = first(named.root, 'svg');
	assert.equal(shown.getAttribute('role'), 'img');
	assert.equal(shown.getAttribute('aria-label'), 'done');
	assert.equal(shown.getAttribute('aria-hidden'), null);
	named.stop();
});

test('size and rot are written as the element\'s own style', () => {
	const { root, stop } = page(h(Icon as never, { name: square, size: '2rem', rot: 90 }));
	const style = first(root, 'svg').getAttribute('style') ?? '';
	assert.match(style, /width: 2rem/);
	assert.match(style, /height: 2rem/);
	assert.match(style, /transform: rotate\(90deg\)/);
	stop();
});

test('nothing ships, so a page with no source of its own draws no icon', () => {
	const document = createDocument();
	assert.throws(
		() => mount(document.body, h(Icon as never, { name: 'check' })),
		/0 source\(s\) were asked/,
		'the stack starts empty (design 144)',
	);
});

test('a set\'s root size is the box of every icon in it that has none', () => {
	const { root, stop } = page(h(Icons as never, { value: set }, h(Icon as never, { name: 'check' })));
	assert.equal(first(root, 'svg').getAttribute('viewBox'), '0 0 24 24',
		'the icon states no size, so the set\'s is the one it is drawn in');
	stop();
});

test('an icon that states its own box keeps it', () => {
	const { root, stop } = page(h(Icons as never, { value: set }, h(Icon as never, { name: 'big' })));
	assert.equal(first(root, 'svg').getAttribute('viewBox'), '0 0 48 48');
	stop();
});

test('an alias is its parent with the alias\'s own turns on it, and the set\'s box', () => {
	const plain = page(h(Icons as never, { value: set }, h(Icon as never, { name: 'check' })));
	const alias = page(h(Icons as never, { value: set }, h(Icon as never, { name: 'done' })));
	assert.equal(toHtml(first(alias.root, 'svg')), toHtml(first(plain.root, 'svg')), 'done is check');

	const turned = page(h(Icons as never, { value: set }, h(Icon as never, { name: 'expand' })));
	assert.equal(first(turned.root, 'svg').getAttribute('viewBox'), '0 0 24 24',
		'an alias is sized by the set too');
	assert.equal(first(turned.root, 'g').getAttribute('transform'), 'rotate(90 12 12)',
		'and it is turned around the box the set gave it');
	plain.stop();
	alias.stop();
	turned.stop();
});

test('the data\'s own rotate becomes a transform on the group, not on the element', () => {
	const { root, stop } = page(h(Icon as never, { name: { ...square, rotate: 1 } }));
	assert.equal(first(root, 'g').getAttribute('transform'), 'rotate(90 5 5)');
	assert.equal(first(root, 'svg').getAttribute('style'), null, 'the element\'s own transform is free');
	stop();
});

test('a flip is a transform too', () => {
	const flipped = page(h(Icon as never, { name: { ...square, hFlip: true } }));
	assert.equal(first(flipped.root, 'g').getAttribute('transform'), 'translate(10 0) scale(-1 1)');
	flipped.stop();

	const upside = page(h(Icon as never, { name: { ...square, vFlip: true } }));
	assert.equal(first(upside.root, 'g').getAttribute('transform'), 'translate(0 10) scale(1 -1)');
	upside.stop();
});

test('a provider stacks its own pack in front of what it inherited', () => {
	const own = { icons: { check: square } };
	const { root, stop } = page(h(Icons as never, { value: [own, set] }, h(Icon as never, { name: 'check' })));
	assert.equal(first(root, 'svg').getAttribute('viewBox'), '0 0 10 10', 'the nearer pack won');
	assert.equal(elements(root).filter((element) => element.localName === 'rect').length, 1);
	stop();
});

test('a resolver that answers null passes the question on', () => {
	const asked: string[] = [];
	const { root, stop } = page(h(Icons as never, {
		value: [(name: string) => { asked.push(name); return null; }, set],
	}, h(Icon as never, { name: 'check' })));

	assert.deepEqual(asked, ['check'], 'the resolver was asked first');
	assert.equal(first(root, 'svg').getAttribute('viewBox'), '0 0 24 24', 'and the pack answered');
	stop();
});

test('a resolver that answers a promise of null passes the question on too', async () => {
	// A resolver put in front of a pack answers a promise for every name it is asked, and a
	// promise is not null. Without the continuation in `lookupIcon` the pack behind it would
	// never be asked, so `[fromUrl(...), pack]` would answer nothing for a standard name.
	const asked: string[] = [];
	const { root, stop } = page(h(Icons as never, {
		value: [async (name: string) => { asked.push(name); return null; }, set],
	}, h(Icon as never, { name: 'check' })));

	await new Promise((resolve) => { setTimeout(resolve, 5); });
	assert.deepEqual(asked, ['check'], 'the resolver was asked first');
	assert.equal(first(root, 'svg').getAttribute('viewBox'), '0 0 24 24', 'and the pack answered after it');
	stop();
});

test('a resolver that answers a promise of data still wins over the pack behind it', async () => {
	const { root, stop } = page(h(Icons as never, {
		value: [async () => square, set],
	}, h(Icon as never, { name: 'check' })));

	await new Promise((resolve) => { setTimeout(resolve, 5); });
	assert.equal(first(root, 'svg').getAttribute('viewBox'), '0 0 10 10', 'the nearer source answered');
	stop();
});

test('a stack of resolvers that all answer nothing answers nothing', async () => {
	const real = globalThis.queueMicrotask;
	const thrown: string[] = [];
	globalThis.queueMicrotask = (fn: () => void): void => {
		try { fn(); } catch (error) { thrown.push(String(error)); }
	};

	try {
		const { root, stop } = page(h(Icons as never, {
			value: [async () => null, async () => null],
		}, h(Icon as never, { name: 'ghost' })));
		await new Promise((resolve) => { setTimeout(resolve, 5); });
		assert.equal(thrown.length, 1, 'the name nothing answered asserts once, not once per source');
		assert.match(thrown[0] ?? '', /no icon named ghost: 2 source\(s\) were asked/);
		assert.equal(elements(root).filter((element) => element.localName !== 'svg').length, 0,
			'and the element is empty');
		stop();
	} finally {
		globalThis.queueMicrotask = real;
	}
});

test('a render waits for a promise that walks past a resolver into a pack', async () => {
	// The static path, where `pending` is what makes the render wait (design 131). The drawing
	// has to be in the markup, not an empty `<svg>` the client fills in later.
	const markup = await render(
		h(Icons as never, { value: [async () => null, set] }, h(Icon as never, { name: 'check' })),
		{ context: context() },
	);
	assert.match(markup, /viewBox="0 0 24 24"/, 'the pack behind the resolver answered before the markup was taken');
	assert.match(markup, /<path /, 'and the drawing landed in it');
});

test('a nested provider stacks again, newest first', () => {
	const outer = { icons: { check: { body: '<rect/>', width: 4, height: 4 } } };
	const inner: { icons: Record<string, IconData> } = { icons: { check: square } };
	const { root, stop } = page(h(Icons as never, { value: outer },
		h(Icons as never, { value: inner }, h(Icon as never, { name: 'check' }))));
	assert.equal(first(root, 'svg').getAttribute('viewBox'), '0 0 10 10');
	stop();
});

test('a prefix picks which pack a prefixed name is for', () => {
	const own = { prefix: 'mine', icons: { star: square } };
	const { root, stop } = page(h(Icons as never, { value: own }, h(Icon as never, { name: 'mine:star' })));
	assert.equal(first(root, 'svg').getAttribute('viewBox'), '0 0 10 10');
	stop();
});

test('a name nothing answers asserts, and the message says how to answer it', () => {
	const document = createDocument();
	assert.throws(
		() => mount(document.body, h(Icons as never, { value: set }, h(Icon as never, { name: 'no-such-icon' }))),
		/no icon named no-such-icon: 1 source\(s\) were asked\. Wrap the page in <Icons value=\{pack\}> with a pack or resolver that has it; @aweftjs\/icons gives you one from an installed set\./,
	);

	assert.throws(
		() => mount(document.body, h(Icon as never, { name: 'anything:at-all' })),
		/no icon named anything:at-all: 0 source\(s\) were asked\. Wrap the page in <Icons value=\{pack\}>/,
		'a name with a prefix on it gets the same sentence: a prefix is not the name of a package',
	);
});

test('a name cell swaps the drawing and keeps the element', () => {
	const name = mutable<unknown>('check');
	const { root, stop } = page(h(Icons as never, { value: set }, h(Icon as never, { name })));
	const element = first(root, 'svg');
	const before = toHtml(first(root, 'path'));

	name.set(square);
	assert.equal(first(root, 'svg'), element, 'the element is the element it was');
	assert.equal(element.getAttribute('viewBox'), '0 0 10 10', 'and the box followed');
	assert.notEqual(toHtml(first(root, 'g')), before, 'and so did the drawing');
	stop();
});

test('a resolver may answer later, and the render waits for it', async () => {
	const own = () => Promise.resolve(square);
	const server = context();
	const markup = await render(
		h(Icons as never, { value: own }, h(Icon as never, { name: 'slow' })),
		{ context: server },
	);
	assert.match(markup, /viewBox="0 0 10 10"/, 'the promise landed before the markup was taken');
	assert.match(markup, /<rect/);
});

test('an icon renders to markup, and the element is adopted while the drawing is the client\'s', async () => {
	const item = (): unknown =>
		h(Icons as never, { value: set }, h('div', {}, h(Icon as never, { name: 'check', label: 'done' })));
	const server = context();
	const markup = await render(h(item), { context: server });

	const document = createDocument();
	for (const node of parseHtml(markup, document)) document.body.appendChild(node);
	for (const node of parseHtml(`<style data-aweft>${server.theme.markup()}</style>`, document)) {
		document.head.appendChild(node);
	}

	const before = elements(document.body.firstChild);
	const svg = before.find((element) => element.localName === 'svg')!;
	const stop = hydrate(document.body, item);
	const after = elements(document.body.firstChild);

	assert.equal(after.find((element) => element.localName === 'svg'), svg,
		'the element itself is the server\'s, adopted');
	// The drawing is not. Its nodes came out of `innerHTML` rather than through the node factory,
	// so `dom` reads them as the caller\'s own nodes and puts them in where the server\'s were.
	// Design 131 names that cost.
	assert.notEqual(after.find((element) => element.localName === 'path'),
		before.find((element) => element.localName === 'path'));
	assert.equal(toHtml(document.body.childNodes), markup, 'and the page is the page the server sent');
	stop();
});

test('a class appends to the theme, and a theme cell is followed', () => {
	const tone = mutable<unknown>('big');
	const { root, stop } = page(h(Icon as never, { name: square, class: 'mine', theme: tone }));
	const element = first(root, 'svg');
	const before = element.getAttribute('class') ?? '';

	assert.match(before, /^mine /, 'the caller\'s own class comes first, as it does on every other element');
	assert.ok(before.split(' ').length > 1, 'and the theme\'s class is beside it, not instead of it');

	tone.set('small');
	assert.notEqual(element.getAttribute('class'), before, 'a theme that is a cell is followed');
	assert.match(element.getAttribute('class') ?? '', /^mine /, 'and the caller\'s class survives the change');
	stop();
});

test('an element handed in is the one decorated, and the wrong tag is refused', () => {
	const document = createDocument();
	const own = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	const stop = mount(document.body, h(Icon as never, { name: square, element: own }));

	assert.equal(first(document.body.firstChild, 'svg'), own as unknown as LightElement,
		'the caller keeps the node it handed in');
	assert.equal((own as unknown as LightElement).getAttribute('viewBox'), '0 0 10 10');
	assert.doesNotMatch(toHtml(document.body.childNodes), /element=/,
		'and element is not written out as an attribute');
	stop();

	assert.throws(
		() => mount(document.body, h(Icon as never, { name: square, element: document.createElement('div') })),
		/element must be <svg> and this one is <div>/,
	);
});

test('a name that changes while a lookup is out drops the older answer', async () => {
	let land: (data: IconData | null) => void = () => undefined;
	const slow = new Promise<IconData | null>((resolve) => { land = resolve; });
	const fast: IconData = { body: '<rect/>', width: 4, height: 4 };
	const stale: IconData = { body: '<circle/>', width: 99, height: 99 };
	const resolver = (name: string): Promise<IconData | null> =>
		(name === 'slow' ? slow : Promise.resolve(fast));

	const name = mutable<unknown>('slow');
	const { root, stop } = page(h(Icons as never, { value: resolver }, h(Icon as never, { name })));
	name.set('fast');
	await new Promise((resolve) => { setTimeout(resolve, 5); });
	assert.equal(first(root, 'svg').getAttribute('viewBox'), '0 0 4 4', 'the newer name landed');

	land(stale);
	await new Promise((resolve) => { setTimeout(resolve, 5); });
	assert.equal(first(root, 'svg').getAttribute('viewBox'), '0 0 4 4',
		'and the older lookup, answering last, is not news');
	stop();
});

test('a lookup that answers nothing, or fails, says so and leaves the element empty', async () => {
	// The answer arrives after every caller has gone, so the assert is thrown where the host
	// reports it rather than into a promise nobody holds. That is the seam this test reads.
	const real = globalThis.queueMicrotask;
	const thrown: string[] = [];
	globalThis.queueMicrotask = (fn: () => void): void => {
		try { fn(); } catch (error) { thrown.push(String(error)); }
	};

	try {
		const empty = page(h(Icons as never, { value: () => Promise.resolve(null) },
			h(Icon as never, { name: 'ghost' })));
		await new Promise((resolve) => { setTimeout(resolve, 5); });
		assert.deepEqual(thrown, ['Error: ui: no icon named ghost: 1 source(s) were asked. '
			+ 'Wrap the page in <Icons value={pack}> with a pack or resolver that has it; '
			+ '@aweftjs/icons gives you one from an installed set.'],
			'a promise of nothing asserts the way a plain nothing does');
		assert.equal(elements(empty.root).filter((element) => element.localName !== 'svg').length, 0,
			'and the element is empty');
		empty.stop();

		thrown.length = 0;
		const broken = page(h(Icons as never, { value: () => Promise.reject(new Error('offline')) },
			h(Icon as never, { name: 'anything' })));
		await new Promise((resolve) => { setTimeout(resolve, 5); });
		assert.deepEqual(thrown,
			['Error: ui: no icon named anything: 1 source(s) were asked. Wrap the page in '
				+ '<Icons value={pack}> with a pack or resolver that has it; @aweftjs/icons gives you one '
				+ 'from an installed set.; the lookup failed with Error: offline'],
			'a refusal is not swallowed, and it names the icon and the reason');
		assert.equal(elements(broken.root).filter((element) => element.localName !== 'svg').length, 0);
		broken.stop();
	} finally {
		globalThis.queueMicrotask = real;
	}
});

test('the standard names are the names this package asks for, and a pack in front answers them', () => {
	assert.ok(standardIcons.includes('chevron-down') && standardIcons.includes('triangle-alert'),
		'the list is the sets\' own spelling (design 142)');
	assert.equal(new Set(standardIcons).size, standardIcons.length, 'and it names nothing twice');

	// The point of a standard name: the application decides what it draws.
	const own = { icons: Object.fromEntries(standardIcons.map((name) => [name, square])) };
	for (const name of standardIcons) {
		const { root, stop } = page(h(Icons as never, { value: own }, h(Icon as never, { name })));
		assert.equal(first(root, 'svg').getAttribute('viewBox'), '0 0 10 10', `${name} came from the page's pack`);
		stop();
	}
});
