// Loading, and the three answers to a loader that rejects (design 112).

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { createDocument, toHtml } from '@aweftjs/dom';
import { InputContext, LoaderContext, context, h, mount, render, suspend, useAbort } from '@aweftjs/ui';

const settled = async (): Promise<void> => { await new Promise((resolve) => setTimeout(resolve, 0)); };

const Waiting = (): unknown => h('p', {}, 'loading');
const Broken = (props: { error?: unknown }): unknown => h('p', {}, `failed: ${String(props.error)}`);

test('a loader replaces the fallback with what it resolved to', async () => {
	const Page = suspend(Waiting, async () => h('main', {}, 'the page'));
	const document = createDocument();
	const stop = mount(document.body, h(Page as never, {}));
	assert.equal(toHtml(document.body.childNodes), '<p>loading</p>');
	await settled();
	assert.equal(toHtml(document.body.childNodes), '<main>the page</main>');
	stop();
});

test('a static render waits for the loader before it serializes', async () => {
	const Page = suspend(Waiting, async () => h('main', {}, 'the page'));
	const markup = await render(h(Page as never, {}), { context: context() });
	assert.match(markup, /<main>the page<\/main>/);
	assert.doesNotMatch(markup, /loading/);
});

test('the call\'s own failed component wins', async () => {
	const Page = suspend(Waiting, async () => { throw new Error('nope'); }, Broken);
	const document = createDocument();
	const stop = mount(document.body, h(Page as never, {}));
	await settled();
	assert.equal(toHtml(document.body.childNodes), '<p>failed: Error: nope</p>');
	stop();
});

test('the LoaderContext supplies both components, and inherits them one at a time', async () => {
	const Page = suspend(null, async () => { throw new Error('nope'); });
	const document = createDocument();
	const stop = mount(document.body, h(LoaderContext, { value: { loading: Waiting } },
		h(LoaderContext, { value: { failed: Broken } }, h(Page as never, {}))));

	// `loading` came from the outer provider and `failed` from the inner, which is what merging
	// field by field is for.
	assert.equal(toHtml(document.body.childNodes), '<p>loading</p>');
	await settled();
	assert.equal(toHtml(document.body.childNodes), '<p>failed: Error: nope</p>');
	stop();
});

test('with nothing to show a failure, the slot empties and the rejection reaches the host', () => {
	// In its own process: the guarantee is that the host reports it, and a test runner catches an
	// uncaught error before the host can, so asserting it in process would assert nothing.
	const run = spawnSync(process.execPath, [
		'--import', '@aweftjs/build/loader',
		'packages/ui/tests/fixtures/unhandled-loader.ts',
	], { cwd: fileURLToPath(new URL('../../../', import.meta.url)), encoding: 'utf8' });

	assert.equal(run.status, 3, 'the rejection reached the host rather than nowhere');
	assert.match(run.stderr, /REPORTED:the loader said no/);
	assert.match(run.stdout, /^SLOT:$/m, 'the fallback did not stay on screen');
});

test('a suspend removed before its loader settles mounts nothing', async () => {
	let resolve: (value: unknown) => void = () => undefined;
	const Page = suspend(Waiting, () => new Promise((r) => { resolve = r; }));
	const document = createDocument();
	const stop = mount(document.body, h(Page as never, {}));
	stop();
	resolve(h('main', {}, 'too late'));
	await settled();
	assert.equal(toHtml(document.body.childNodes), '');
});

test('an input event reaches the generic handler and then the one for its type', () => {
	const seen: string[] = [];
	const document = createDocument();
	const Fire = (): unknown => (_elem: never, _item: never, _before: never, ctx: unknown) => {
		InputContext.fire(ctx, 'click', { component: 'Button', page: 'mine' });
		return () => undefined;
	};

	const stop = mount(document.body, h(InputContext, {
		value: {
			meta: { page: 'home' },
			on: (event: Record<string, unknown>) => seen.push(`on:${String(event['type'])}:${String(event['page'])}`),
			onClick: (event: Record<string, unknown>) => seen.push(`onClick:${String(event['component'])}`),
		},
	}, h(Fire as never, {})));

	// The application's meta wins over a field a component happened to give the same name.
	assert.deepEqual(seen, ['on:click:home', 'onClick:Button']);
	stop();
});

test('meta merges one level deeper than the rest of the context', () => {
	const seen: Record<string, unknown>[] = [];
	const document = createDocument();
	const Fire = (): unknown => (_elem: never, _item: never, _before: never, ctx: unknown) => {
		InputContext.fire(ctx, 'click');
		return () => undefined;
	};
	const stop = mount(document.body, h(InputContext, { value: { meta: { site: 'a' }, on: (e: Record<string, unknown>) => seen.push(e) } },
		h(InputContext, { value: { meta: { page: 'b' } } }, h(Fire as never, {}))));
	assert.deepEqual(seen, [{ type: 'click', site: 'a', page: 'b' }]);
	stop();
});

test('useAbort hands back the abort, and one call takes every listener off', () => {
	const seen: string[] = [];
	const target = new EventTarget();
	const listen = useAbort((signal: AbortSignal) => {
		target.addEventListener('one', () => seen.push('one'), { signal });
		target.addEventListener('two', () => seen.push('two'), { signal });
	});

	const stop = listen();
	target.dispatchEvent(new Event('one'));
	target.dispatchEvent(new Event('two'));
	assert.deepEqual(seen, ['one', 'two']);

	stop();
	target.dispatchEvent(new Event('one'));
	assert.deepEqual(seen, ['one', 'two'], 'one abort took both off');
});
