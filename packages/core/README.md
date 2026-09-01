# @aweftjs/core

Observables, the deltas they produce, commits, scopes and identity.

State lives in observables of three kinds: `createObject` (string slots), `createArray`
(ordered, addressed by positions that survive edits elsewhere) and `createMap` (keyed by
id). Assignment is the mutation. Every property of an observable belongs to you; everything
the library does is a free function that takes the observable, so no field name is
reserved.

One assignment is one commit. An `atomic` block is one commit no matter how much it writes,
and a block that throws rolls back and emits nothing. A commit applies whole or not at all,
and a watcher never sees a document between deltas.

## Quickstart

```ts
import {
	apply, atomic, createObject, idOf, observer, snapshot, type Commit,
} from '@aweftjs/core';

const doc = createObject({ title: 'plan', width: 1, height: 1 });

// Watch a scope. The watcher gets the commit; the tree is already updated when it runs.
const stop = observer(doc).path('title').watch((change) => {
	console.log(change.deltas.length, doc.title);
});

doc.title = 'plan b';   // one commit
atomic(() => {          // also one commit, and the title watcher never fires for it
	doc.width = 3;
	doc.height = 4;
});

// Undo: every change carries the commit that undoes it.
const undos: Commit[] = [];
const stopRecording = observer(doc).watch((change) => undos.push(change.inverse()));
doc.title = 'oops';
stopRecording();          // stop before undoing, or the undo records itself
apply(doc, undos.pop()!); // title is 'plan b' again

stop();
```

Registering a watcher returns the function that stops it, always.

A watcher cannot tell a commit landed with `apply` from a local mutation. An undo stack
that stays subscribed while it undoes will record its own undo; hold a flag for the
duration of the call, the way `examples/core` does.

## A replica

Two documents stay in step when they share a root id and every commit crosses:

```ts
const source = createObject();
const mirror = createObject(undefined, idOf(source));

observer(source).watch((change) => apply(mirror, change));

source.title = 'shared';
// snapshot(mirror) now deep-equals snapshot(source), after every commit
```

A plain `createObject()` on the receiving side does not work: it has a different root id,
so the source's commits are refused as unreachable. Mint the copy with the source root's
id, as above.

Compare the two by deep equality, not by `JSON.stringify`. A snapshot's slots are a plain
object, so the order they were inserted in is part of the string and is not part of the
document: applying the same commits in two orders gives two strings for one document.
`canonicalJson` in the sibling testing package is the comparison that holds.

## Scope where you read, not at the root

A scope registers its listener on the observable it was built from, and delivery walks each
delta up its attach path checking every listener it passes. So the cost of a write is the
number of listeners standing between it and the top.

```ts
observer(doc).path('tasks', 3, 'done').watch(fn);  // checked on every write anywhere
observer(task).path('done').watch(fn);             // checked only on writes under task
```

Both see the same changes. The first is checked on every write in the document, the second
only on writes under `task`. Measured with `bench/write.ts`, on one write nobody matches:
1,000 listeners on the root cost 4.56 us and 10,000 cost 51.59 us, while the same listeners
registered on the observable they are about stay flat at 0.42 to 0.45 us. Start the scope at
the thing you are reading and the question does not arise.

A number in a path names a position, not an element. `path('tasks', 0)` follows whatever sits
at index 0 now, so removing the first task makes it the second task's scope. To follow one
element wherever it moves, start the scope at the element.

## Removing something does not delete it

Taking an observable out of the document leaves it readable and no longer writable. A write
to it throws `unreachable`, which is what a receiver does with the same delta.

```ts
const task = tasks[0];
tasks.splice(0, 1);
isReachable(task);  // false
task.done = true;   // throws unreachable
```

Ask `isReachable` rather than catching the throw. `parentOf` cannot answer it: it returns
undefined for a document root, which is reachable, and for something detached, which is not.

## Boundaries

The `Change` a watcher receives is a `Commit`: its `deltas` are exactly what crosses a
boundary, and `apply` on the far side takes them unchanged. The sibling codec package
turns a commit into bytes and back.

Deliberately not here: derived values (nothing in this package recomputes anything), any
transport, any persistence. `sort`, `reverse`, `fill` and `copyWithin` on an array throw,
because they cannot be expressed as changes to the slots they appear to touch.

The wire format lives in `spec/`, the reasoning in `docs/design/`, and a complete
program using all of the above in `examples/core/`.
