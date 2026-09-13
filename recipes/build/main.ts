// A page that goes through the transforms, and then does its job.
//
// The job is an ordinary one: a small dashboard written the three ways a page is written, in
// JSX, in markup, and in `h` calls by hand. What makes it a proof rather than a demo is that the
// page is never run as it was written. It is compiled, written to disk, imported, and then
// mounted, rendered and hydrated, and every check is against what the compiled page did. The
// release build of the binding's own source is checked for asserts the same way: by reading what
// came out, not by trusting that a pass ran.
//
// Run: node recipes/build/main.ts

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createDocument, hydrate, mount, parseHtml, render, toHtml } from '@aweftjs/dom';
import type { LightElement } from '@aweftjs/dom';
import { transform } from '@aweftjs/build';

let checks = 0;
const check = (ok: boolean, why: string): void => {
	checks += 1;
	assert.ok(ok, why);
};

// --- the application, as someone would write it ------------------------------------------------

const app = `
import { h, html } from '@aweftjs/dom';
import { createArray, createObject, mutable, observer } from '@aweftjs/core';

// A row, in JSX. Everything but the label and the class is fixed, so the whole row is one
// template with two places that vary.
const Row = ({ each }) => {
	const done = observer(each).path('done');
	return (
		<li class={done.bool('done', null)}>
			<span class="handle">::</span>
			<span class="label">{observer(each).path('title')}</span>
		</li>
	);
};

// The summary, in markup.
const Summary = ({ open, total }) => html\`<p class="summary \${open.map((n) => (n === 0 ? 'clear' : 'busy'))}">\${open} open of \${total}</p>\`;

// The frame, in h calls by hand.
export const Dashboard = ({ state }) => {
	const todos = observer(state).path('todos');
	const open = todos.map((list) => list.filter((t) => !t.done).length);
	const total = todos.map((list) => list.length);
	return h('main', { class: 'board', id: 'board' },
		h('header', { class: 'bar' }, h('h1', { class: 'title' }, 'Today')),
		h('ul', { class: 'todos' }, h(Row, { each: state.todos })),
		h(Summary, { open, total }));
};

const todo = (title, done = false) => createObject({ title, done });

export const create = () => {
	const state = createObject({ todos: createArray([todo('write the transform'), todo('measure it', true)]) });
	return { state, todo, item: h(Dashboard, { state }) };
};

export const unused = mutable(0);
`;

// --- compile it, then run only what came out ---------------------------------------------------

const scratch = mkdtempSync(join(tmpdir(), 'aweft-build-proof-'));
try {
	const compiled = transform(app, { filename: 'dashboard.tsx' });

	check(!compiled.code.includes('<li class='), 'the JSX is gone from the output');
	check(!compiled.code.includes('html`'), 'the markup tag is gone from the output');
	check(compiled.code.includes('template as _template'), 'the output imports the template');
	check((compiled.code.match(/_template\(/g) ?? []).length === 3, 'three subtrees were hoisted');
	check(compiled.code.includes('joined as _joined'), 'the mixed attribute joins the way the parser does');
	check(compiled.map.version === 3 && compiled.map.sources[0] === 'dashboard.tsx', 'the map names the file');

	// The stack resolves from this file, not from a scratch directory, so the specifiers point at
	// the packages themselves. Nothing else about the compiled page is touched.
	const packages = new URL('../../packages/', import.meta.url);
	const runnable = compiled.code
		.split("'@aweftjs/dom'").join(JSON.stringify(new URL('dom/src/index.ts', packages).href))
		.split("'@aweftjs/core'").join(JSON.stringify(new URL('core/src/index.ts', packages).href));
	const file = join(scratch, 'dashboard.ts');
	writeFileSync(file, runnable);

	const page = await import(pathToFileURL(file).href) as {
		create(): {
			state: { todos: { title: string; done: boolean }[] };
			todo(title: string, done?: boolean): { title: string; done: boolean };
			item: unknown;
		};
	};

	// Mounted: the compiled page builds the tree the source describes, and it is live.
	const mountedPage = page.create();
	const client = createDocument();
	mount(client.body, mountedPage.item);
	const board = client.body.children[0]!;
	check(board.getAttribute('id') === 'board', 'the hand-written frame mounted');
	check(board.children[0]!.children[0]!.textContent === 'Today', 'the fixed heading is in the template');
	check(board.children[1]!.children.length === 2, 'both rows mounted from one template');
	check(board.children[1]!.children[1]!.getAttribute('class') === 'done', 'the JSX row bound its class');
	check(board.children[2]!.textContent === '1 open of 2', 'the markup summary bound both counts');
	check(board.children[2]!.getAttribute('class') === 'summary busy', 'the mixed attribute joined');

	const firstRow = board.children[1]!.children[0]!;
	mountedPage.state.todos[0]!.done = true;
	check(firstRow.getAttribute('class') === 'done', 'the same node took the change: it was not rebuilt');
	check(board.children[2]!.textContent === '0 open of 2', 'the summary followed');
	check(board.children[2]!.getAttribute('class') === 'summary clear', 'the joined attribute followed');
	mountedPage.state.todos.push(mountedPage.todo('and one more'));
	check(board.children[1]!.children.length === 3, 'a row added after mounting used the template again');

	// Rendered with no browser, then hydrated in place over that markup.
	const server = page.create();
	const markup = await render(server.item);
	check(markup.includes('<h1 class="title">Today</h1>'), 'the template rendered in the light tree');
	check(markup.includes('<p class="summary busy">'), 'the joined attribute rendered on the server');
	check(markup.includes(' open of '), 'the summary rendered its fixed text');
	check(markup.includes('class="done"'), 'the done row rendered its class');

	const hydrating = page.create();
	const target = createDocument();
	for (const node of parseHtml(markup, target)) target.body.appendChild(node as LightElement);
	const serverBoard = target.body.children[0]!;
	const serverRow = serverBoard.children[1]!.children[0]!;

	const stop = hydrate(target.body, hydrating.item);
	check(target.body.children[0] === serverBoard, 'the frame was adopted, not rebuilt');
	check(serverBoard.children[1]!.children[0] === serverRow, 'a row from a hoisted template was adopted in place');
	hydrating.state.todos[0]!.done = true;
	check(serverRow.getAttribute('class') === 'done', 'the adopted row is live');
	stop();
	check(toHtml(target.body) === '<body></body>', 'the whole page came back out');

	// --- the release build ---------------------------------------------------------------------

	const sources = ['mount.ts', 'h.ts', 'hydration.ts', 'htm.ts', 'render.ts', 'ambient.ts', 'template.ts'];
	let before = 0;
	let after = 0;
	let calls = 0;
	for (const name of sources) {
		const source = readFileSync(new URL(`dom/src/${name}`, packages), 'utf8');
		const release = transform(source, { filename: name, release: true }).code;
		calls += (source.match(/(^|[^.\w])assert\(/g) ?? []).length;
		check(!/(^|[^.\w])assert\(/.test(release), `${name}: no assert call survived the release build`);
		check(!/from '\.\/assert\.ts'/.test(release) || /isRelease/.test(release),
			`${name}: the assert import went with its last call`);
		before += Buffer.byteLength(source);
		after += Buffer.byteLength(release);
	}
	check(calls > 30, 'the binding really does assert, so the strip had something to do');
	check(after < before, 'a release build of the binding is smaller than the source it came from');

	const kept = transform("import { assert } from './assert.ts';\nexport const f = (x) => assert(x, 'm');\n",
		{ filename: 'kept.ts', release: true }).code;
	check(kept.includes('assert(x'), 'an assert whose value is read keeps its call');

	console.log(
		`build proof: ${checks} checks passed; ${calls} assert calls removed, `
		+ `${before} bytes of binding source down to ${after}`,
	);
} finally {
	rmSync(scratch, { recursive: true, force: true });
}
