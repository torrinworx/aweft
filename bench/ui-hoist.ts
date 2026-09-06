// What hoisting is worth through `ui`'s `h`, beside what it is worth through `dom`'s.
//
// `bench/hoist.ts` measures the `dom` half on the benchmark row shape. This measures the same row
// written five ways, so a `ui` file's numbers sit beside a `dom` file's:
//
//   - `dom`'s `h`, eight calls per row
//   - `dom`'s template, one instance per row, literal attributes cloned with the prototype
//   - `ui`'s `h` with nothing `ui` claims on the row, eight calls per row
//   - `ui`'s `h` with a `theme` on the outer element, eight calls per row
//   - `ui`'s template, which is what `build` emits for that file: no attribute is in the
//     prototype, because only `ui` knows which names it claims (design 108)
//
// Two pairs to read: calls against calls (rows 1, 3 and 4), and template against template
// (rows 2 and 5).
//
// The specs and edits below are what `transform` emits for the rows above them; run it on that
// source to check. Design 108 cites this script.
//
// The page is built with no `aweft()` plugin, deliberately. The plugin hoists calls to the file's
// primary `h`, which here is `dom`'s, so with it on the two `dom` rows compiled to a template and
// the two `ui` rows stayed as calls: the number that read as the wrapper's cost was the cost of
// hoisting. Both compiled forms are handed in by hand instead, so every row is measured against a
// row of the same kind.
//
// Run: node bench/ui-hoist.ts

import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';
import { build } from 'vite';

// Declared loosely: these run inside Chromium, and this file typechecks in Node.
declare const window: { run(): Record<string, number> };

const repo = fileURLToPath(new URL('../', import.meta.url));
const space = mkdtempSync(join(tmpdir(), 'aweft-ui-hoist-'));

const ENTRY = `
import { mutable } from '@aweftjs/core';
import { h as domH, template as domTemplate } from '@aweftjs/dom';
import { Theme, context, h as uiH, mount, template as uiTemplate } from '@aweftjs/ui';

Theme.define({ row: { padding: '4px' } });

// The row, as a page writes it against dom.
const domRow = (label, tone) => domH('tr', { class: 'row' },
	domH('td', { class: 'col-id' }, '1'),
	domH('td', { class: 'col-name' }, domH('a', { class: 'link' }, label)),
	domH('td', { class: 'col-tone' }, domH('span', { class: 'tone' }, tone)),
	domH('td', { class: 'col-x' }, domH('a', { class: 'remove' }, domH('span', { class: 'glyph' }))),
);

// The same row, as build emits it for that file: the literal attributes are in the prototype.
const domSpec = ['tr', { class: 'row' },
	['td', { class: 'col-id' }, '1'],
	['td', { class: 'col-name' }, ['a', { class: 'link' }]],
	['td', { class: 'col-tone' }, ['span', { class: 'tone' }]],
	['td', { class: 'col-x' }, ['a', { class: 'remove' }, ['span', { class: 'glyph' }]]],
];
const domEdits = [['child', [1, 0], -1], ['child', [2, 0], -1]];
const domMade = domTemplate(domSpec, domEdits);

// The row again, against ui, with a theme on the outer element.
const uiRow = (label, tone) => uiH('tr', { theme: 'row' },
	uiH('td', { class: 'col-id' }, '1'),
	uiH('td', { class: 'col-name' }, uiH('a', { class: 'link' }, label)),
	uiH('td', { class: 'col-tone' }, uiH('span', { class: 'tone' }, tone)),
	uiH('td', { class: 'col-x' }, uiH('a', { class: 'remove' }, uiH('span', { class: 'glyph' }))),
);

// The same row through ui's h with nothing ui claims on it, which is dom's h exactly. The gap
// between this and the line above it is what the wrapper costs, rather than what ui costs.
const uiPlainRow = (label, tone) => uiH('tr', { class: 'row' },
	uiH('td', { class: 'col-id' }, '1'),
	uiH('td', { class: 'col-name' }, uiH('a', { class: 'link' }, label)),
	uiH('td', { class: 'col-tone' }, uiH('span', { class: 'tone' }, tone)),
	uiH('td', { class: 'col-x' }, uiH('a', { class: 'remove' }, uiH('span', { class: 'glyph' }))),
);

// And as build emits it for a ui file: nothing literal in the prototype, every property an edit.
const uiSpec = ['tr', null, ['td', null, '1'], ['td', null, ['a', null]], ['td', null, ['span', null]], ['td', null, ['a', null, ['span', null]]]];
const uiEdits = [
	['props', []], ['props', [0]], ['props', [1]], ['props', [1, 0]], ['child', [1, 0], -1],
	['props', [2]], ['props', [2, 0]], ['child', [2, 0], -1], ['props', [3]], ['props', [3, 0]], ['props', [3, 0, 0]],
];
const uiMade = uiTemplate(uiSpec, uiEdits);

const ROWS = 10000;
const best = (fn) => {
	let low = Infinity;
	for (let round = 0; round < 7; round += 1) {
		const body = document.createElement('tbody');
		const start = performance.now();
		fn(body);
		low = Math.min(low, performance.now() - start);
	}
	return Math.round(low * 10) / 10;
};

window.run = () => {
	const label = mutable('a name');
	const tone = mutable('warm');

	// Inside a mount, which is where a list's rows are built.
	const inMount = (make) => (body) => {
		document.body.appendChild(body);
		const stop = mount(body, { [Symbol.iterator]: function* () { for (let i = 0; i < ROWS; i += 1) yield make(); } }, undefined, context());
		stop();
		body.remove();
	};

	return {
		'dom h calls': best(inMount(() => domRow(label, tone))),
		'dom template': best(inMount(() => domMade([label, tone]))),
		'ui h, nothing claimed': best(inMount(() => uiPlainRow(label, tone))),
		'ui h, themed': best(inMount(() => uiRow(label, tone))),
		'ui template, themed': best(inMount(() => uiMade([
			{ theme: 'row' }, { class: 'col-id' }, { class: 'col-name' }, { class: 'link' }, label,
			{ class: 'col-tone' }, { class: 'tone' }, tone, { class: 'col-x' }, { class: 'remove' }, { class: 'glyph' },
		]))),
	};
};
`;

const root = join(space, 'page');
mkdirSync(root, { recursive: true });
writeFileSync(join(root, 'index.html'),
	'<!doctype html><html><head></head><body><script type="module" src="./entry.js"></script></body></html>');
writeFileSync(join(root, 'entry.js'), ENTRY);

const out = join(root, 'dist');
await build({
	root,
	logLevel: 'error',
	resolve: {
		alias: {
			'@aweftjs/ui': join(repo, 'packages/ui/src/index.ts'),
			'@aweftjs/dom': join(repo, 'packages/dom/src/index.ts'),
			'@aweftjs/core': join(repo, 'packages/core/src/index.ts'),
			'@aweftjs/codec': join(repo, 'packages/codec/src/index.ts'),
		},
	},
	build: { outDir: out, emptyOutDir: true },
});

const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript' };
const server = createServer((request, response) => {
	const path = (request.url ?? '/').split('?')[0]!;
	const file = join(out, normalize(path === '/' ? '/index.html' : path));
	if (!file.startsWith(out)) {
		response.writeHead(403).end();
		return;
	}
	try {
		response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
		response.end(readFileSync(file));
	} catch {
		response.writeHead(404).end();
	}
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = (server.address() as { port: number }).port;

const browser = await chromium.launch();
try {
	const view = await browser.newPage();
	await view.goto(`http://127.0.0.1:${port}/`);
	await view.waitForFunction(() => (window as { run?: unknown }).run !== undefined);

	// Best of five invocations of best of seven, as `bench/hoist.ts` reports.
	const rounds: Record<string, number>[] = [];
	for (let i = 0; i < 5; i += 1) {
		rounds.push(await view.evaluate(() => window.run()));
	}

	console.log(`10,000 rows, Chromium, best of five invocations of best of seven, milliseconds`);
	for (const name of Object.keys(rounds[0]!)) {
		const low = Math.min(...rounds.map((round) => round[name]!));
		console.log(`  ${name.padEnd(22)} ${low.toFixed(1)}`);
	}
} finally {
	await browser.close();
	await new Promise<void>((resolve) => { server.close(() => resolve()); });
	rmSync(space, { recursive: true, force: true });
}
