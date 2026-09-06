// A context is a tree you can walk, and its value is read once (design 114).

import test from 'node:test';
import assert from 'node:assert/strict';

import { mutable } from '@aweftjs/core';
import { createDocument, toHtml } from '@aweftjs/dom';
import type { Mounter } from '@aweftjs/dom';
import { ThemeContext, context, createContext, h, mount } from '@aweftjs/ui';

/** Read the context out of a mount, which is what a component that returns a mounter can do. */
const peek = <T>(take: (context: unknown) => T): { read(): T; item: unknown } => {
	let held: T;
	const Peek = (): Mounter => (_elem, _item, _before, ctx) => {
		held = take(ctx);
		return () => undefined;
	};
	return { read: () => held, item: h(Peek as never, {}) };
};

test('a value with no provider is the default, and reading one from outside works', () => {
	const Tone = createContext('plain');
	const seen = peek((ctx) => Tone.read(ctx));
	const document = createDocument();
	const stop = mount(document.body, seen.item);
	assert.equal(seen.read(), 'plain');
	assert.equal(Tone.node(null), null, 'no provider means no node');
	stop();
});

test('a provider is the value below it, and a nested one wins', () => {
	const Tone = createContext('plain');
	const inner = peek((ctx) => Tone.read(ctx));
	const outer = peek((ctx) => Tone.read(ctx));
	const document = createDocument();
	const stop = mount(document.body, h(Tone, { value: 'accent' }, outer.item, h(Tone, { value: 'danger' }, inner.item)));
	assert.equal(outer.read(), 'accent');
	assert.equal(inner.read(), 'danger');
	stop();
});

test('a transform sees the value above it and the children below it', () => {
	const Names = createContext<string>('', (raw, parent, children) =>
		`${parent}${String(raw ?? '')}:${children.length}`);
	const seen = peek((ctx) => Names.node(ctx));
	const document = createDocument();
	const stop = mount(document.body, h(Names, { value: 'a' }, h(Names, { value: 'b' }, seen.item)));

	const node = seen.read()!;
	// The parent's own value resolves when it is first read, which is after its child registered,
	// so a parent that counts its children sees them.
	assert.equal(node.value(), 'a:1b:0');
	assert.equal(node.parent!.value(), 'a:1');
	assert.equal(node.parent!.children.length, 1);
	assert.equal(node.parent!.parent, null);
	stop();
});

test('a node id comes from the render counter, so a server and a client agree', () => {
	const Tone = createContext('plain');
	const ids: string[] = [];
	const seen = peek((ctx) => Tone.node(ctx)!.id);

	for (const _ of [0, 1]) {
		const document = createDocument();
		const stop = mount(document.body, h(Tone, { value: 'a' }, seen.item), undefined, context());
		ids.push(seen.read());
		stop();
	}
	assert.deepEqual(ids, ['ctx-0', 'ctx-0'], 'each render counts from zero');
});

test('a provider splices itself out of its parent by identity, and not the last child', () => {
	const Tone = createContext('plain');
	const shown = mutable(true);
	const nodes = peek((ctx) => Tone.node(ctx)!);
	const document = createDocument();

	const stop = mount(document.body, h(Tone, { value: 'root' },
		shown.bool(h(Tone, { value: 'first' }, 'a'), null),
		h(Tone, { value: 'second' }, nodes.item),
	));

	const second = nodes.read();
	assert.equal(second.parent!.children.length, 2);
	shown.set(false);
	assert.equal(second.parent!.children.length, 1);
	assert.equal(second.parent!.children[0], second, 'the one that went is the one that unmounted');
	stop();
});

test('a raw value that is a cell keeps the resolved value live', () => {
	const raw = mutable('a');
	// A transform is handed the value as it was written, cell and all, because a transform that
	// writes back into it needs the cell. It unwraps what it wants to read.
	const Tone = createContext('plain', (value) => `tone-${String((value as { get(): unknown }).get())}`);
	const seen = peek((ctx) => Tone.node(ctx)!);
	const document = createDocument();
	const stop = mount(document.body, h(Tone, { value: raw }, seen.item));

	const node = seen.read();
	assert.equal(node.value(), 'tone-a');
	raw.set('b');
	assert.equal(node.value(), 'tone-b', 'the transform ran again after the cell moved');
	stop();
});

test('use builds a component from the resolved value', () => {
	const Tone = createContext('plain');
	const Label = Tone.use((tone) => (props: { children: unknown[] }) => h('p', {}, `${tone}: `, ...props.children));
	const document = createDocument();
	const stop = mount(document.body, h(Tone, { value: 'accent' }, h(Label as never, {}, 'hi')));
	assert.equal(toHtml(document.body.childNodes), '<p>accent: hi</p>');
	stop();
});

test('ThemeContext gives a component an h that prepends the inherited theme', () => {
	const Panel = ThemeContext.use((themed) => () => [
		themed('div', { theme: 'panel' }, 'inside'),
		themed('div', {}, 'unthemed'),
	]);
	const own = context();
	const document = createDocument();
	const stop = mount(document.body, h(ThemeContext, { value: 'brand' }, h(Panel as never, {})), undefined, own);

	// The themed one asked for a theme and got the inherited segment in front of it; the one with
	// no theme prop stayed a plain div.
	assert.equal(toHtml(document.body.childNodes), '<div class="aw0">inside</div><div>unthemed</div>');
	stop();
});

test('an element written theme="" still takes the cascade', () => {
	const Panel = ThemeContext.use((themed) => () => themed('div', { theme: '' }, 'x'));
	const own = context();
	const document = createDocument();
	const stop = mount(document.body, h(ThemeContext, { value: 'brand' }, h(Panel as never, {})), undefined, own);
	assert.equal(toHtml(document.body.childNodes), '<div class="aw0">x</div>');
	stop();
});
