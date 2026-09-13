// A todo page, built on dom, that checks what it did to the tree.
//
// The job is an ordinary one: a list of todos in a document, a filter, a count, a form. What
// makes it a proof rather than a demo is that every edit asserts the exact DOM operations it
// caused against the recording host, the page renders to markup with no browser, and that
// markup is hydrated in place with the server nodes kept. If the binding ever did more work
// than an edit calls for, or rebuilt what it should adopt, this program would exit nonzero.
//
// Run: node examples/dom/main.ts

import assert from 'node:assert/strict';

import { atomic, createArray, createObject, mutable, observer } from '@aweftjs/core';
import { recordingDocument } from '@aweftjs/testing';
import type { Cleanup, LightElement, Mounted, Pending } from '@aweftjs/dom';
import { createDocument, getFirst, h, html, hydrate, mount, render, toHtml } from '@aweftjs/dom';

// --- the application -------------------------------------------------------------------

interface Todo extends Record<string, unknown> {
	title: string;
	done: boolean;
}

interface State extends Record<string, unknown> {
	todos: Todo[];
	filter: 'all' | 'open';
}

const todo = (title: string, done = false): Todo => createObject<Todo>({ title, done });

const Item = ({ each: item }: { each: Todo }) => {
	const done = observer(item).path('done');
	const title = observer(item).path('title');
	// The box is named by the title beside it (the access rules, design 265).
	return h('li', { class: done.bool('done', null) },
		h('input', { type: 'checkbox', 'aria-label': title, $checked: done, $onchange: () => { item.done = !item.done; } }),
		' ', title,
	);
};

const Footer = ({ state }: { state: State }) => {
	const open = observer(state).path('todos').map((todos) => (todos as Todo[]).filter((t) => !t.done).length);
	return html`<footer>${open} open of ${observer(state).path('todos').map((t) => (t as Todo[]).length)}</footer>`;
};

const App = ({ state }: { state: State }) => {
	const draft = mutable('');
	const add = () => {
		if (draft.get() === '') return;
		state.todos.push(todo(draft.get()));
		draft.set('');
	};
	return html`
		<main>
			<form $onsubmit=${add}>
				<input $value=${draft} $oninput=${(e: { target: { value: string } }) => draft.set(e.target.value)} />
			</form>
			<ul><${Item} each=${state.todos} /></ul>
			<${Footer} state=${state} />
		</main>
	`;
};

// --- the checks -----------------------------------------------------------------------------

const state = createObject<State>({ todos: createArray<Todo>([todo('write the proof'), todo('run it', true)]), filter: 'all' });
const { document, ops } = recordingDocument();
const stop = mount(document.body, h(App, { state }));
const main = (document.body as LightElement).children[0]!;
const ul = main.children[1]!;
assert.equal(ul.children.length, 2);
assert.equal(main.children[2]!.textContent, '1 open of 2');

// Adding a todo is one insert into the list, after the row is built off-document.
ops.length = 0;
state.todos.push(todo('ship'));
assert.deepEqual(ops.filter((op) => op.includes('<ul>')), ['insert <li> into <ul> before end']);
assert.equal(main.children[2]!.textContent, '2 open of 3');

// Toggling a todo touches the row's class and checkbox, and no node moves.
ops.length = 0;
ul.children[0]!.children[0]!.dispatchEvent({ type: 'change' });
assert.ok(ops.every((op) => op.startsWith('attr') || op.startsWith('unattr') || op.startsWith('text')), ops.join(' | '));
assert.equal(ul.children[0]!.getAttribute('class'), 'done');
assert.equal(main.children[2]!.textContent, '1 open of 3');

// A swap in one block moves the two rows and keeps them: the checkbox is the same node.
const firstBox = ul.children[0]!.children[0]!;
ops.length = 0;
atomic(() => {
	const t = state.todos[0]!;
	state.todos[0] = state.todos[2]!;
	state.todos[2] = t;
});
assert.ok(ops.every((op) => op.startsWith('insert <li> into <ul>') || op.startsWith('remove <li> from <ul>')), ops.join(' | '));
assert.equal(ul.children[2]!.children[0], firstBox);
assert.equal(ul.children[0]!.textContent, ' ship');

// Removing one is one remove; emptying the whole list is one write.
ops.length = 0;
state.todos.splice(1, 1);
assert.deepEqual(ops.filter((op) => op.includes('<ul>')), ['remove <li> from <ul>']);
ops.length = 0;
state.todos.splice(0, state.todos.length);
assert.deepEqual(ops.filter((op) => op.includes('<ul>')), ['clear <ul>']);
assert.equal(main.children[2]!.textContent, '0 open of 0');
state.todos.push(todo('after the clear'));
assert.equal(ul.children.length, 1);

stop();
assert.equal(toHtml(document.body), '<body></body>');

// --- static render, then hydration in place ---------------------------------------------------

// Content that arrives later: the server declares it pending and waits; the client is handed
// the value the server got, so both render the same thing and hydration has nothing to heal.
const Status = ({ known }: { known: string | null }, _c: Cleanup, _m: Mounted, pending: Pending) => {
	const text = mutable(known ?? 'loading');
	if (known === null) pending(new Promise<void>((resolve) => setTimeout(() => { text.set('loaded'); resolve(); }, 5)));
	return h('p', { id: 'status' }, text);
};

const page = createObject<State>({ todos: createArray<Todo>([todo('render me'), todo('and me', true)]), filter: 'all' });
const Page = ({ known }: { known: string | null }) => [h(App, { state: page }), h(Status, { known })];
const markup = await render(h(Page, { known: null }));
assert.ok(markup.includes('<p id="status"><!--[-->loaded<!--]--></p>'), 'render waited for the pending content');
assert.ok(markup.includes('<li class="done">'), 'the done row rendered its class');

const client = createDocument();
client.body.innerHTML = markup;
const serverMain = client.body.children[0]!;
const serverRow = serverMain.children[1]!.children[0]!;
const serverStatus = client.body.children[1]!;

const stopHydrated = hydrate(client.body, h(Page, { known: 'loaded' }));
assert.equal(client.body.children[0], serverMain, 'the main element was adopted');
assert.equal(serverMain.children[1]!.children[0], serverRow, 'the first row was adopted');
assert.equal(client.body.children[1], serverStatus, 'the status element was adopted');
assert.equal(serverStatus.textContent, 'loaded');
assert.equal(stopHydrated(getFirst)!.nodeName, '#comment');

// The adopted page is live: an edit reaches the adopted nodes.
page.todos.push(todo('added after hydration'));
assert.equal(serverMain.children[1]!.children.length, 3);
serverRow.children[0]!.dispatchEvent({ type: 'change' });
assert.equal(serverRow.getAttribute('class'), 'done');
assert.equal(serverMain.children[2]!.textContent, '1 open of 3');

stopHydrated();
assert.equal(toHtml(client.body), '<body></body>');

console.log('dom proof: mounted with exact operations, rendered with pending content, hydrated in place; 26 checks passed');
