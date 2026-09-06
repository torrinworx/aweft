// Recipe: find a bug in a document you did not write.
//
// The job is the one a reader actually has. A list is not showing what it should, the code that
// writes it looks right, and printing the row gives you `{}`. This walks the three questions
// that answer it: what is in here, what happened to it, and what did the stack refuse.

import assert from 'node:assert/strict';

import { apply, atomic, createArray, createObject, observer } from '@aweftjs/core';
import { commitOf, documentOf, explain, render, trace } from '@aweftjs/debug';

// A small task list, the shape any application has.
interface Board { title: string; tasks: object[] }

const board = createObject<Board>({ title: 'this week' });
const tasks = createArray<object>();
board.tasks = tasks;

tasks.push(createObject({ label: 'write the recipe', done: false }));
tasks.push(createObject({ label: 'run the gate', done: false }));

// 1. What is in here?
//
// `console.log(board)` prints an empty object: an observable is a proxy and its contents are
// not own enumerable properties. This is the question `documentOf` answers.
const tree = render(documentOf(board));
assert.match(tree, /title: 'this week'/, 'the document reader shows a primitive slot');
assert.match(tree, /write the recipe/, 'and reaches through the array into each task');
assert.equal(tree.split('\n').length, 4, 'the root, the array, and one line per task');
assert.match(tree, /\[0\]: object/, 'an array slot reads as an index, not as a position key');

// 2. What happened to it?
//
// The bug: a caller marks a task done by replacing the whole object rather than writing the
// slot. A trace shows the difference immediately, because the two produce different commits.
const watching = trace(board);

const first = tasks[0] as { done: boolean };
first.done = true;                                    // the write that was meant
tasks[1] = createObject({ label: 'run the gate', done: true });  // the write that was not

assert.equal(watching.count(), 2, 'two commits landed');
const log = watching.text();
assert.match(log, /replace tasks\[0\]\.done {2}\(value: true\)/, 'the good write names one slot and the value it took');
assert.match(log, /add tasks\[1\]\.label/, 'the whole-object write is three deltas, not one');
assert.match(log, /value: -> object /, 'and the slot that took the new row holds a reference to it');
watching.stop();

// A stopped trace hears nothing more. This is the rule every listener in the stack follows.
const before = watching.count();
(tasks[0] as { done: boolean }).done = false;
assert.equal(watching.count(), before, 'stop() means stop');

// 3. What did the stack refuse, and what do I do about it?
//
// Every refusal carries a reason to branch on and a fix to act on. `explain` lays out all three
// parts, so the answer is in the same place as the question.
let refusal = '';
try {
	apply(board, { deltas: [] });
} catch (e) {
	refusal = explain(e);
}
assert.match(refusal, /^refusal empty-commit/, 'the reason leads');
assert.match(refusal, /fix: /, 'and the remedy is right there with it');

// 4. A commit read against its document names paths; read alone it names ids.
let captured: { deltas: readonly unknown[] } | undefined;
const stop = observer(board).watch((change) => { captured = { deltas: [...change.deltas] }; });
atomic(() => {
	(board as { title: string }).title = 'next week';
	(tasks[0] as { label: string }).label = 'ship it';
});
stop();
assert.ok(captured !== undefined, 'the watcher heard the atomic block');

const withDocument = render(commitOf(captured as never, board));
const withoutDocument = render(commitOf(captured as never));
// The discriminating shape is the `in:` fact, not the slot name: a delta names its own slot
// either way. Only the document turns an id into the path that reaches it.
assert.match(withDocument, /replace title/, 'with the document, a delta names the path that reaches it');
assert.doesNotMatch(withDocument, /in: /, 'and needs no id, because the path resolved');
assert.match(withoutDocument, /in: /, 'without it, a delta falls back to naming the observable by id');
assert.notEqual(withDocument, withoutDocument, 'the two renderings really do differ');
assert.equal(captured!.deltas.length, 2, 'one atomic block is one commit carrying both writes');

// 5. What this package will not do for you.
//
// It does not place an object no part of this stack made, and it says so rather than guessing.
const foreign = explain(new Map([['a', 1]]));
assert.match(foreign, /not described/, 'an unknown value comes back saying it is unknown');
assert.doesNotThrow(() => explain(undefined), 'and a debug call never throws on the way');

console.log('recipes/debug: ok');
