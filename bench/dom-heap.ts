// Ten create-and-clear cycles in Chromium, with the heap read after each, for both row idioms.
//
// A leak is invisible to a timing bench: nothing runs slower, the document simply never lets
// go of what it held. This is the committed measurement for the rule that a detached
// observable leaves the document (design 084), and the number to watch is the slope across
// the ten cycles rather than any one of them.
//
// The browser cannot run TypeScript or resolve a workspace import, so the packages are emitted
// to plain JS in a temporary directory and served through an import map, as `dom-rows.ts` does.
//
// Run: node bench/dom-heap.ts
//
// CI does not gate on this. A performance claim cites this script and its recorded output.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const repo = fileURLToPath(new URL('../', import.meta.url));
const packages = ['codec', 'core', 'dom'];

const CYCLES = 10;
const ROWS = 1000;

const emit = (): string => {
	const out = mkdtempSync(join(tmpdir(), 'aweft-heap-'));
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
const page_html = `<!doctype html><html><head><script type="importmap">${JSON.stringify(importMap)}</script></head><body><table><tbody id="rows"></tbody></table></body></html>`;

// Runs inside the page. Declared loosely: tsc here has no DOM lib.
declare const document: { getElementById(id: string): unknown };
declare const globalThis: { cycle?: () => void };

const built = emit();
const browser = await chromium.launch();

/** A cycle, then a forced collection, then the heap. The collection is what makes it a
 * measurement rather than a reading of whenever the collector last happened to run. */
const series = async (idiom: 'document' | 'nodes'): Promise<number[]> => {
	const page = await browser.newPage();
	page.on('pageerror', (error) => { throw error; });
	await page.route(`${host}/**`, (route) => {
		const url = new URL(route.request().url());
		if (url.pathname === '/') return route.fulfill({ body: page_html, contentType: 'text/html' });
		const file = join(built, url.pathname);
		if (!existsSync(file)) return route.fulfill({ status: 404, body: `no ${url.pathname}` });
		return route.fulfill({ body: readFileSync(file, 'utf8'), contentType: 'text/javascript' });
	});
	await page.goto(`${host}/`);

	await page.evaluate(async ({ which, rows }) => {
		const { createArray, createObject, mutable, mutableArray, observer } = await import('@aweftjs/core');
		const { h, mount } = await import('@aweftjs/dom');

		const words = ['pretty', 'large', 'big', 'small', 'tall', 'short', 'long', 'handsome', 'plain', 'quaint'];
		let next = 0;
		const tbody = document.getElementById('rows') as never;

		if (which === 'document') {
			const selected = mutable<unknown>(null);
			const select = selected.selector();
			const Row = ({ each: item }: { each: { label: string } }) =>
				h('tr', { class: select(item).bool('danger', null) },
					h('td', { class: 'col-md-1' }, String(next)),
					h('td', { class: 'col-md-4' }, h('a', {}, observer(item).path('label'))),
					h('td', { class: 'col-md-1' }, h('a', {}, h('span', { class: 'glyphicon glyphicon-remove' }))),
					h('td', { class: 'col-md-6' }));

			const list = createArray<{ label: string }>();
			mount(tbody, h(Row, { each: list }));
			globalThis.cycle = () => {
				const made = Array.from({ length: rows },
					() => createObject({ label: `${words[next++ % words.length]} ${next}` }));
				list.push(...made);
				list.splice(0, list.length);
			};
			return;
		}

		const list = mutableArray<unknown>();
		mount(tbody, list);
		globalThis.cycle = () => {
			const made = new Array(rows);
			for (let i = 0; i < rows; i++) {
				const label = mutable(`${words[next++ % words.length]} ${next}`);
				made[i] = h('tr', {},
					h('td', { class: 'col-md-1' }, String(next)),
					h('td', { class: 'col-md-4' }, h('a', { $textContent: label })),
					h('td', { class: 'col-md-1' }, h('a', {}, h('span', { class: 'glyphicon glyphicon-remove' }))),
					h('td', { class: 'col-md-6' }));
			}
			list.push(...made);
			list.splice(0, list.length);
		};
	}, { which: idiom, rows: ROWS });

	const client = await page.context().newCDPSession(page);
	await client.send('HeapProfiler.enable');

	const heap: number[] = [];
	for (let i = 0; i < CYCLES; i++) {
		await page.evaluate(() => { globalThis.cycle!(); });
		await client.send('HeapProfiler.collectGarbage');
		const used = await client.send('Runtime.getHeapUsage') as { usedSize: number };
		heap.push(used.usedSize);
	}

	await page.close();
	return heap;
};

try {
	console.log(`\n${CYCLES} create-${ROWS.toLocaleString('en-US')}-and-clear cycles in Chromium, heap after each, MB`);
	for (const idiom of ['document', 'nodes'] as const) {
		const heap = await series(idiom);
		const mb = heap.map((bytes) => bytes / 1e6);
		const first = mb[0]!;
		const last = mb[mb.length - 1]!;
		console.log(`\n  ${idiom === 'document' ? 'a document array, a component per row' : 'prebuilt row elements in a list cell'}`);
		console.log(`    ${mb.map((v) => v.toFixed(2)).join('  ')}`);
		console.log(`    first ${first.toFixed(2)}  last ${last.toFixed(2)}  growth ${(last - first).toFixed(2)} MB`
			+ `  per cycle ${((last - first) / (CYCLES - 1)).toFixed(3)} MB`);
	}
} finally {
	await browser.close();
	rmSync(built, { recursive: true, force: true });
}
