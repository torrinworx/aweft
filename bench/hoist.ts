// What static hoisting is worth, in Chromium, on the benchmark row shape.
//
// Two ways to build the same row 10,000 times: the eight `h` calls a page writes, and the one
// `template` instance `build` emits for them. Both build the same tree, so the difference is
// construction, which is the whole of what the hoisting pass moves.
//
// It measures each of them in the two places a page builds nodes, because the binding does
// different work in them:
//
//   - inside a mount that is not hydrating, which is where a list's rows are built. Nothing
//     reads which nodes the binding made there, so no node is marked.
//   - outside any mount, which is where a page builds the item it then hands to `mount` or
//     `hydrate`. Every node is marked there, because an instance cannot know which of the two is
//     coming, and `hydrate` only adopts a server node where the fresh node is one the binding
//     made. For a clone that means walking it, and the gap between the two lines is that walk.
//
// The spec and the edits below are what `transform` emits for the row above them; run it on that
// source to check. Designs 089 and 093 cite this script, and so does `packages/build/README.md`.
//
// Run: node bench/hoist.ts

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const repo = fileURLToPath(new URL('../', import.meta.url));
const packages = ['codec', 'core', 'dom'];

const emit = (): string => {
	const out = mkdtempSync(join(tmpdir(), 'aweft-hoist-'));
	const sources: string[] = [];
	for (const p of packages) {
		const dir = join(repo, 'packages', p, 'src');
		for (const name of readdirSync(dir)) if (name.endsWith('.ts')) sources.push(join(dir, name));
	}
	const run = spawnSync('npx', ['tsc', ...sources,
		'--rootDir', repo, '--outDir', out, '--target', 'es2023', '--module', 'nodenext',
		'--moduleResolution', 'nodenext', '--allowImportingTsExtensions', '--rewriteRelativeImportExtensions',
		'--strict', '--skipLibCheck', '--erasableSyntaxOnly', '--verbatimModuleSyntax', '--isolatedModules',
		'--noUncheckedIndexedAccess', '--exactOptionalPropertyTypes'],
		{ cwd: repo, encoding: 'utf8' });
	if (run.status !== 0) throw new Error(`emit failed: ${run.stdout}\n${run.stderr}`);
	return out;
};

const host = 'http://aweft.test';
const importMap = {
	imports: {
		'@aweftjs/codec': `${host}/packages/codec/src/index.js`,
		'@aweftjs/core': `${host}/packages/core/src/index.js`,
		'@aweftjs/dom': `${host}/packages/dom/src/index.js`,
	},
};
const pageHtml = `<!doctype html><html><head><script type="importmap">${JSON.stringify(importMap)}</script></head><body><table><tbody id="rows"></tbody></table></body></html>`;

const built = emit();
const browser = await chromium.launch();
try {
	const page = await browser.newPage();
	page.on('pageerror', (e) => { throw e; });
	await page.route(`${host}/**`, (route) => {
		const url = new URL(route.request().url());
		if (url.pathname === '/') return route.fulfill({ body: pageHtml, contentType: 'text/html' });
		const file = join(built, url.pathname);
		if (!existsSync(file)) return route.fulfill({ status: 404, body: `no ${url.pathname}` });
		return route.fulfill({ body: readFileSync(file, 'utf8'), contentType: 'text/javascript' });
	});
	await page.goto(`${host}/`);

	const results = await page.evaluate(async () => {
		const { h, mount, template } = await import('@aweftjs/dom');
		const doc = (globalThis as unknown as { document: Record<string, (id: string) => unknown> }).document;
		const perf = (globalThis as unknown as { performance: { now(): number } }).performance;
		const rows = 10000;
		const click = (): void => undefined;

		const written = (id: number, label: string): unknown => h('tr', { class: null },
			h('td', { class: 'col-md-1', $textContent: id }),
			h('td', { class: 'col-md-4' }, h('a', { $clickHandler: click, $textContent: label })),
			h('td', { class: 'col-md-1' }, h('a', { $clickHandler: click },
				h('span', { class: 'glyphicon glyphicon-remove', 'aria-hidden': 'true' }))),
			h('td', { class: 'col-md-6' }));

		const row = template(
			['tr', null,
				['td', { class: 'col-md-1' }],
				['td', { class: 'col-md-4' }, ['a', null]],
				['td', { class: 'col-md-1' }, ['a', null, ['span', { class: 'glyphicon glyphicon-remove', 'aria-hidden': 'true' }]]],
				['td', { class: 'col-md-6' }]],
			[['props', []], ['props', [0]], ['props', [1, 0]], ['props', [2, 0]]],
		);
		const compiled = (id: number, label: string): unknown =>
			row([{ class: null }, { $textContent: id }, { $clickHandler: click, $textContent: label }, { $clickHandler: click }]);

		const buildAll = (make: (id: number, label: string) => unknown): void => {
			for (let i = 0; i < rows; i++) make(i, `row ${i}`);
		};

		// Timed inside a component body, so the build runs under a mount that is not hydrating.
		// The component renders nothing: what is being measured is making the nodes, not placing
		// them, and placing 10,000 rows costs the same either way.
		const inAMount = (make: (id: number, label: string) => unknown): number => {
			let took = 0;
			const App = (): unknown => {
				const start = perf.now();
				buildAll(make);
				took = perf.now() - start;
				return null;
			};
			const stop = mount(doc['getElementById']!('rows') as never, h(App)) as () => void;
			stop();
			return took;
		};

		const outsideAMount = (make: (id: number, label: string) => unknown): number => {
			const start = perf.now();
			buildAll(make);
			return perf.now() - start;
		};

		const best = (run: () => number): number => {
			let low = Infinity;
			for (let i = 0; i < 7; i++) low = Math.min(low, run());
			return low;
		};

		// The two have to build the same row, or the comparison is between two different jobs.
		const markupOf = (make: (id: number, label: string) => unknown): string =>
			(make(1, 'row 1') as { outerHTML: string }).outerHTML;
		if (markupOf(compiled) !== markupOf(written)) {
			throw new Error(`the template is not the written row:\n  ${markupOf(compiled)}\n  ${markupOf(written)}`);
		}

		// Warm both paths so neither pays for the prototype or the first optimisation pass.
		inAMount(written);
		inAMount(compiled);

		return {
			writtenMounted: best(() => inAMount(written)),
			compiledMounted: best(() => inAMount(compiled)),
			writtenLoose: best(() => outsideAMount(written)),
			compiledLoose: best(() => outsideAMount(compiled)),
		};
	});

	const show = (name: string, ms: number): void => console.log(`  ${name.padEnd(38)} ${ms.toFixed(1).padStart(7)} ms`);
	console.log('10,000 rows of the benchmark row shape, best of seven, Chromium');
	console.log('inside a mount that is not hydrating, which is where a list builds its rows:');
	show('eight h calls per row', results.writtenMounted);
	show('one template instance per row', results.compiledMounted);
	console.log('outside any mount, where a page builds the item it hands to mount or hydrate:');
	show('eight h calls per row', results.writtenLoose);
	show('one template instance per row', results.compiledLoose);
	show('the marking walk on a clone', results.compiledLoose - results.compiledMounted);
} finally {
	await browser.close();
	rmSync(built, { recursive: true, force: true });
}
