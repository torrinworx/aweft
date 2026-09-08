// What a thousand rows still hold in Chromium once they are up, by the function that allocated it.
//
// `dom-heap.ts` says whether the heap grows across cycles, which is the leak question.  This says
// what one page of rows costs while it is alive, and which function bound each byte: the profiler
// is asked to leave out everything a collection took, so what is left is what the mount is still
// holding. That is the number a binding built per row per field moves.
//
// The numbers are sampled, not exact. They are stable enough to compare two runs of the same
// shape on one machine, and not stable enough to compare one line against another to a byte.
//
// The browser cannot run TypeScript or resolve a workspace import, so the packages are emitted
// to plain JS in a temporary directory and served through an import map, as `dom-heap.ts` does.
//
// Run: node bench/dom-live.ts
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

const ROWS = 1000;
/** Bytes between samples. Smaller is finer and slower; this is the profiler's own default. */
const INTERVAL = 2048;
const SHOWN = 12;

const emit = (): string => {
	const out = mkdtempSync(join(tmpdir(), 'aweft-live-'));
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
declare const globalThis: { create?: (n: number) => void };

/** One node of the profiler's tree: a call frame, its own bytes, and the frames below it. */
interface SampleNode {
	readonly callFrame: { functionName: string; url: string; lineNumber: number };
	readonly selfSize: number;
	readonly children: SampleNode[];
}

/** Every frame's own bytes, added up across the tree, plus the total the tree accounts for. */
const byFunction = (head: SampleNode): { total: number; rows: [string, number][] } => {
	const self = new Map<string, number>();
	let total = 0;

	const walk = (node: SampleNode): void => {
		const frame = node.callFrame;
		const file = frame.url === '' ? '' : frame.url.slice(frame.url.lastIndexOf('/') + 1);
		const where = file === '' ? '(native)' : `${file}:${frame.lineNumber + 1}`;
		const key = `${frame.functionName === '' ? '(anonymous)' : frame.functionName} ${where}`;
		self.set(key, (self.get(key) ?? 0) + node.selfSize);
		total += node.selfSize;
		for (const child of node.children) walk(child);
	};
	walk(head);

	return { total, rows: [...self].sort((a, b) => b[1] - a[1]) };
};

const built = emit();
const browser = await chromium.launch();

const retained = async (idiom: 'document' | 'nodes'): Promise<{ total: number; rows: [string, number][] }> => {
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

	await page.evaluate(async (which) => {
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
			globalThis.create = (n) => {
				list.push(...Array.from({ length: n },
					() => createObject({ label: `${words[next++ % words.length]} ${next}` })));
			};
			return;
		}

		const list = mutableArray<unknown>();
		mount(tbody, list);
		globalThis.create = (n) => {
			const made = new Array(n);
			for (let i = 0; i < n; i++) {
				const label = mutable(`${words[next++ % words.length]} ${next}`);
				made[i] = h('tr', {},
					h('td', { class: 'col-md-1' }, String(next)),
					h('td', { class: 'col-md-4' }, h('a', { $textContent: label })),
					h('td', { class: 'col-md-1' }, h('a', {}, h('span', { class: 'glyphicon glyphicon-remove' }))),
					h('td', { class: 'col-md-6' }));
			}
			list.push(...made);
		};
	}, idiom);

	const client = await page.context().newCDPSession(page);
	await client.send('HeapProfiler.enable');
	await client.send('HeapProfiler.collectGarbage');
	// Nothing a collection takes is counted, so what the profile holds is what the page still
	// holds. The collection after the rows are up is what makes that true.
	await client.send('HeapProfiler.startSampling', {
		samplingInterval: INTERVAL,
		includeObjectsCollectedByMajorGC: false,
		includeObjectsCollectedByMinorGC: false,
	});

	await page.evaluate((n) => { globalThis.create!(n); }, ROWS);
	await client.send('HeapProfiler.collectGarbage');

	const { profile } = await client.send('HeapProfiler.stopSampling') as { profile: { head: SampleNode } };
	await page.close();
	return byFunction(profile.head);
};

try {
	console.log(`\nJS heap still held after ${ROWS.toLocaleString('en-US')} rows in Chromium, sampled every ${INTERVAL} bytes`);
	for (const idiom of ['document', 'nodes'] as const) {
		const { total, rows } = await retained(idiom);
		console.log(`\n  ${idiom === 'document' ? 'a document array, a component per row' : 'prebuilt row elements in a list cell'}`);
		console.log(`    total ${(total / 1048576).toFixed(2)} MB`);
		for (const [name, bytes] of rows.slice(0, SHOWN)) {
			console.log(`    ${(bytes / 1048576).toFixed(2).padStart(7)} MB ${(100 * bytes / total).toFixed(1).padStart(5)}%  ${name}`);
		}
	}
} finally {
	await browser.close();
	rmSync(built, { recursive: true, force: true });
}
