// The row table in a real browser: create, append, update, swap, remove and clear over a
// document array mounted through `each`, timed in Chromium through the Playwright the gate
// already installs. The shapes are the ones every framework benchmark uses, so the numbers
// compare with anything measured the same way on the same machine.
//
// The browser cannot run TypeScript or resolve a workspace import, so the packages are
// emitted to plain JS in a temporary directory and served through an import map, the way the
// frame runner's escape suite does it.
//
// Run: node bench/dom-rows.ts
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

const emit = (): string => {
	const out = mkdtempSync(join(tmpdir(), 'aweft-rows-'));
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
declare const performance: { now(): number };

const built = emit();
const browser = await chromium.launch();
try {
	const page = await browser.newPage();
	page.on('pageerror', (e) => { throw e; });
	await page.route(`${host}/**`, (route) => {
		const url = new URL(route.request().url());
		if (url.pathname === '/') return route.fulfill({ body: page_html, contentType: 'text/html' });
		const file = join(built, url.pathname);
		if (!existsSync(file)) return route.fulfill({ status: 404, body: `no ${url.pathname}` });
		return route.fulfill({ body: readFileSync(file, 'utf8'), contentType: 'text/javascript' });
	});
	await page.goto(`${host}/`);

	const results = await page.evaluate(async () => {
		const { atomic, createArray, createObject, mutable, observer } = await import('@aweftjs/core');
		const { h, mount } = await import('@aweftjs/dom');

		const words = ['pretty', 'large', 'big', 'small', 'tall', 'short', 'long', 'handsome', 'plain', 'quaint'];
		let next = 0;
		const row = () => createObject({ label: `${words[next++ % words.length]} ${next}` });
		const selected = mutable<unknown>(null);
		const select = selected.selector();

		const Row = ({ each: item }: { each: { label: string } }) => h('tr', { class: select(item).bool('danger', null) },
			h('td', { class: 'col-md-1' }, String(next)),
			h('td', { class: 'col-md-4' }, h('a', { $onclick: () => selected.set(item) }, observer(item).path('label'))),
			h('td', { class: 'col-md-1' }, h('a', {}, h('span', { class: 'glyphicon glyphicon-remove' }))),
			h('td', { class: 'col-md-6' }),
		);

		const rows = createArray<{ label: string }>();
		const tbody = document.getElementById('rows') as never;
		mount(tbody, h(Row, { each: rows }));

		const time = (fn: () => void): number => {
			const started = performance.now();
			fn();
			return performance.now() - started;
		};
		// `prepare` puts the table back before each run and is not timed; building the row data
		// is inside the timed part, as the framework benchmarks do it.
		const best = (runs: number, prepare: () => void, fn: () => void): number => {
			let min = Infinity;
			for (let i = 0; i < runs; i++) { prepare(); min = Math.min(min, time(fn)); }
			return min;
		};
		const make = (n: number) => Array.from({ length: n }, row);
		const clear = (): void => { rows.splice(0, rows.length); };
		const fill = (n: number): void => { clear(); rows.push(...make(n)); };

		const out: Record<string, number> = {};
		out['create 1,000 rows'] = best(5, clear, () => { rows.push(...make(1000)); });
		out['replace all 1,000 rows'] = best(5, () => fill(1000), () => { clear(); rows.push(...make(1000)); });
		out['partial update, every 10th of 1,000'] = best(5, () => fill(1000), () => { for (let i = 0; i < rows.length; i += 10) rows[i]!.label = `${rows[i]!.label} !!!`; });
		out['select a row'] = best(5, () => {}, () => { selected.set(rows[Math.floor(Math.random() * 1000)]); });
		out['swap rows 1 and 998'] = best(5, () => {}, () => { atomic(() => { const t = rows[1]!; rows[1] = rows[998]!; rows[998] = t; }); });
		out['remove a row'] = best(5, () => { if (rows.length < 1000) rows.push(row()); }, () => { rows.splice(500, 1); });
		out['create 10,000 rows'] = best(3, clear, () => { rows.push(...make(10000)); });
		out['append 1,000 rows to 1,000'] = best(3, () => fill(1000), () => { rows.push(...make(1000)); });
		out['clear 10,000 rows'] = best(3, () => fill(10000), clear);
		return out;
	});

	console.log('\nthe row table in Chromium, milliseconds, best of the runs');
	for (const [name, ms] of Object.entries(results)) console.log(`  ${name.padEnd(40)} ${ms.toFixed(2).padStart(9)} ms`);
} finally {
	await browser.close();
	rmSync(built, { recursive: true, force: true });
}
