// The row path in Chromium, at the grain a change to it has to be measured on. Designs 098 and
// 099 cite this script.
//
// It differs from `dom-rows.ts` in three ways, each because that script cannot see something a
// change to the row path needs seen:
//
//   - Small operations are repeated inside the timed block. A single row removal and a single
//     swap both read 0.00 ms there, because Chromium coarsens `performance.now()` to 0.1 ms.
//   - It mounts a second idiom, `each` over a cell holding a plain array, which is the only
//     path that reaches `list.setItems`. The document idiom never calls it.
//   - It reports the per-row DOM call count, so a change that claims to remove DOM calls is
//     checked on the count as well as the clock.
//   - It mounts a third idiom, the same row as a hoisted template, which is what `build` emits
//     for it. That is the compiled path, and the only place the cost of walking a clone to mark
//     it is visible.
//
// Run: node bench/perf-lab.ts [label]

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const repo = fileURLToPath(new URL('../', import.meta.url));
const packages = ['codec', 'core', 'dom'];

const emit = (): string => {
	const out = mkdtempSync(join(tmpdir(), 'aweft-lab-'));
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
const page_html = `<!doctype html><html><head><script type="importmap">${JSON.stringify(importMap)}</script></head><body><table><tbody id="rows"></tbody></table><table><tbody id="cellrows"></tbody></table><table><tbody id="hoistrows"></tbody></table></body></html>`;

declare const document: {
	getElementById(id: string): unknown;
	createElement(tag: string): unknown;
};
declare const performance: { now(): number };
declare const Node: { prototype: Record<string, unknown> };
declare const Element: { prototype: Record<string, unknown> };
declare const Document: { prototype: Record<string, unknown> };

const label = process.argv[2] ?? 'run';
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
		const { h, mount, template } = await import('@aweftjs/dom');

		// Count the DOM calls a creation makes, by wrapping the four the row path uses. Counting
		// is off except inside `counted`, so it never touches a timed run.
		let counting = false;
		const calls: Record<string, number> = {};
		const wrap = (proto: Record<string, unknown>, name: string): void => {
			const original = proto[name] as (...a: unknown[]) => unknown;
			proto[name] = function (this: unknown, ...a: unknown[]) {
				if (counting) calls[name] = (calls[name] ?? 0) + 1;
				return original.apply(this, a);
			};
		};
		wrap(Document.prototype, 'createElement');
		wrap(Document.prototype, 'createTextNode');
		wrap(Node.prototype, 'insertBefore');
		wrap(Node.prototype, 'appendChild');
		wrap(Node.prototype, 'cloneNode');
		wrap(Element.prototype, 'setAttribute');
		const counted = (fn: () => void): Record<string, number> => {
			for (const k of Object.keys(calls)) delete calls[k];
			counting = true;
			try { fn(); } finally { counting = false; }
			return { ...calls };
		};

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
		mount(document.getElementById('rows') as never, h(Row, { each: rows }));

		// The second idiom: `each` over a cell holding a plain array. This is the only path that
		// reaches `list.setItems`; the document array above never does.
		const plain = mutable<{ label: string }[]>([]);
		const PlainRow = ({ each: item }: { each: { label: string } }) => h('tr', {},
			h('td', { class: 'col-md-1' }, String(next)),
			h('td', { class: 'col-md-4' }, h('a', {}, item.label)),
			h('td', { class: 'col-md-1' }, h('a', {}, h('span', { class: 'glyphicon glyphicon-remove' }))),
			h('td', { class: 'col-md-6' }),
		);
		mount(document.getElementById('cellrows') as never, h(PlainRow, { each: plain }));

		// The third idiom: the same row as a hoisted template, which is what `build` emits for
		// `Row` above. Nothing in the body reaches `h`, so this is the compiled path.
		const rowShape = template(
			['tr', null,
				['td', { class: 'col-md-1' }],
				['td', { class: 'col-md-4' }, ['a', null]],
				['td', { class: 'col-md-1' }, ['a', null, ['span', { class: 'glyphicon glyphicon-remove' }]]],
				['td', { class: 'col-md-6' }]],
			[['child', [0], -1], ['child', [1, 0], -1], ['props', [1, 0]], ['props', []]],
		);
		const HoistRow = ({ each: item }: { each: { label: string } }) => rowShape([
			String(next),
			observer(item).path('label'),
			{ $onclick: () => selected.set(item) },
			{ class: select(item).bool('danger', null) },
		]);
		const hoisted = createArray<{ label: string }>();
		mount(document.getElementById('hoistrows') as never, h(HoistRow, { each: hoisted }));

		const time = (fn: () => void): number => {
			const started = performance.now();
			fn();
			return performance.now() - started;
		};
		const best = (runs: number, prepare: () => void, fn: () => void): number => {
			let min = Infinity;
			for (let i = 0; i < runs; i++) { prepare(); min = Math.min(min, time(fn)); }
			return min;
		};
		const make = (n: number) => Array.from({ length: n }, row);
		const clear = (): void => { rows.splice(0, rows.length); };
		const fill = (n: number): void => { clear(); rows.push(...make(n)); };

		const out: Record<string, number> = {};

		// The creation shapes, as dom-rows.ts has them.
		out['create 1,000'] = best(5, clear, () => { rows.push(...make(1000)); });
		out['create 10,000'] = best(3, clear, () => { rows.push(...make(10000)); });
		out['append 1,000 to 1,000'] = best(3, () => fill(1000), () => { rows.push(...make(1000)); });
		out['replace all 1,000'] = best(5, () => fill(1000), () => { clear(); rows.push(...make(1000)); });
		out['clear 10,000'] = best(3, () => fill(10000), clear);
		out['update every 10th of 1,000'] = best(5, () => fill(1000), () => { for (let i = 0; i < rows.length; i += 10) rows[i]!.label = `${rows[i]!.label} !!!`; });

		// Repeated, because one of each is below the clock's resolution. Reported per operation.
		out['remove one row, x500'] = best(3, () => fill(1000), () => { for (let i = 0; i < 500; i++) rows.splice(400, 1); }) / 500;
		out['swap two rows, x500'] = best(3, () => fill(1000), () => {
			for (let i = 0; i < 500; i++) atomic(() => { const t = rows[1]!; rows[1] = rows[998]!; rows[998] = t; });
		}) / 500;

		// The cell-of-plain-array idiom, which is where setItems runs.
		const setPlain = (n: number): void => { plain.set(Array.from({ length: n }, row)); };
		out['cell array: fill 1,000 from empty'] = best(5, () => { plain.set([]); }, () => { setPlain(1000); });
		out['cell array: replace 1,000'] = best(5, () => { setPlain(1000); }, () => { setPlain(1000); });

		// The compiled path. Its shape is asserted against the `h` row it replaces before anything
		// is timed, so a number here is a number for the same markup.
		const clearHoisted = (): void => { hoisted.splice(0, hoisted.length); };
		const fillHoisted = (n: number): void => { clearHoisted(); hoisted.push(...make(n)); };
		fillHoisted(1);
		fill(1);
		// Text is dropped: the two rows hold different items, so only the shape can be compared.
		const shapeOf = (id: string): string =>
			(document.getElementById(id) as unknown as { firstElementChild: { outerHTML: string } })
				.firstElementChild.outerHTML.replace(/>[^<]*</g, '><');
		if (shapeOf('hoistrows') !== shapeOf('rows')) {
			throw new Error(`the hoisted row is not the written row:\n  ${shapeOf('hoistrows')}\n  ${shapeOf('rows')}`);
		}
		clearHoisted();
		clear();

		out['compiled: create 1,000'] = best(5, clearHoisted, () => { hoisted.push(...make(1000)); });
		out['compiled: create 10,000'] = best(3, clearHoisted, () => { hoisted.push(...make(10000)); });
		out['compiled: replace all 1,000'] = best(5, () => fillHoisted(1000), () => { clearHoisted(); hoisted.push(...make(1000)); });

		const perRow = counted(() => { clear(); rows.push(...make(100)); });
		clear();
		const perCompiledRow = counted(() => { clearHoisted(); hoisted.push(...make(100)); });
		clearHoisted();
		return { times: out, perRow, perCompiledRow };
	});

	console.log(`\n=== ${label} ===`);
	console.log('milliseconds, best of the runs');
	for (const [name, ms] of Object.entries(results.times)) {
		const shown = ms < 1 ? ms.toFixed(4) : ms.toFixed(2);
		console.log(`  ${name.padEnd(34)} ${shown.padStart(10)} ms`);
	}
	const perRowReport = (title: string, counts: Record<string, number>): void => {
		console.log(title);
		const total = Object.values(counts).reduce((a, b) => a + b, 0);
		for (const [name, n] of Object.entries(counts)) console.log(`  ${name.padEnd(34)} ${(n / 100).toFixed(2).padStart(10)}`);
		console.log(`  ${'total'.padEnd(34)} ${(total / 100).toFixed(2).padStart(10)}`);
	};
	perRowReport('DOM calls per row, creating 100 rows', results.perRow);
	perRowReport('DOM calls per compiled row, creating 100 rows', results.perCompiledRow);
} finally {
	await browser.close();
	rmSync(built, { recursive: true, force: true });
}
