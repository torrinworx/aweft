// Recipe: a todo list.
//
// The smallest application that is still a real one: a list you add to, toggle and filter,
// with the list following every edit rather than being rebuilt. It runs with no browser, so
// the gate can assert the markup after each edit and show that a push moved one node.

import assert from 'node:assert/strict';

import { atomic, createArray, createObject, mutable, observer } from '@aweftjs/core';
import { createDocument, h, mount, toHtml } from '@aweftjs/dom';

interface Todo { title: string; done: boolean }

const state = createObject({ todos: createArray<Todo>() });
const filter = mutable<'all' | 'active' | 'done'>('all');

// One shape per row, always. The class varies because it is a value; the tag never varies,
// because a row is cloned from the first row and a varying tag is dropped in silence.
const Row = ({ each: todo }: { each: Todo }) => h('li',
	{ class: observer(todo).path('done').bool('done', 'active') },
	observer(todo).path('title'));

// The filter is a value the row's class already carries, so filtering is a class on the list
// rather than a second list. Nothing is unmounted when the filter changes, which is the point:
// the rows are the state, the filter is a view of it.
const App = () => h('ul', { class: filter.map((f) => `todos showing-${f}`) }, h(Row, { each: state.todos }));

const page = createDocument();
const root = page.createElement('div');
const unmount = mount(root, h(App, {}));

const markup = () => toHtml(root);

// An empty list is an empty list, not a placeholder.
assert.match(markup(), /<ul class="todos showing-all"><\/ul>/, 'nothing renders for no todos');

// Add. One push is one insert, not a rebuild.
const add = (title: string) => state.todos.push(createObject({ title, done: false }));
add('write the recipe');
add('run the gate');
assert.equal(markup().match(/<li/g)?.length, 2, 'two rows');
assert.match(markup(), /<li class="active">write the recipe<\/li>/, 'a row carries its own title');

// Toggle. Writing the slot rewrites one attribute; it does not touch the other row.
(state.todos[0] as Todo).done = true;
assert.match(markup(), /<li class="done">write the recipe<\/li>/, 'the toggled row changed');
assert.match(markup(), /<li class="active">run the gate<\/li>/, 'and the other row did not');

// Filter. The class on the list changes and no row is unmounted.
filter.set('active');
assert.match(markup(), /class="todos showing-active"/, 'the view changed');
assert.equal(markup().match(/<li/g)?.length, 2, 'and every row is still mounted');
filter.set('all');

// Reorder inside one atomic block moves the row nodes themselves.
atomic(() => {
	const first = state.todos[0]!;
	state.todos[0] = state.todos[1]!;
	state.todos[1] = first;
});
assert.match(markup(), /run the gate.*write the recipe/s, 'the two rows swapped');

// Remove. A splice takes one node out.
state.todos.splice(0, 1);
assert.equal(markup().match(/<li/g)?.length, 1, 'one row left');
assert.match(markup(), /write the recipe/, 'and it is the one that was not removed');

// Mounting hands back the function that unmounts it, as every listener in this stack does.
unmount();
assert.equal(toHtml(root), '<div></div>', 'unmounting leaves the target empty');

// What this recipe does NOT do for you: nothing here persists. Reload and the list is gone.
// Persistence is `@aweftjs/store`, and it is a different recipe on purpose.
assert.equal(state.todos.length, 1, 'the document is still the document; only the view went');

console.log('recipes/todo-list: ok');
