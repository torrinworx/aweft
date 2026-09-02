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

That flag works while `apply` is called from ordinary code. It does not work when `apply`
is called from **inside** a watcher, which is the shape a replication seam reaches for
first. Delivery is deferred, so the nested commit reaches the second document's watchers
after the outer watcher has already returned and cleared the flag. Queue the commit and
apply it once the delivery has finished:

```ts
const queued: Commit[] = [];
observer(source).watch((change) => queued.push({ deltas: [...change.deltas] }));

// later, outside any delivery
while (queued.length > 0) apply(mirror, queued.shift()!);
```

A real transport queues here anyway, because writing to a socket is not synchronous.

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

A replica built from commits holds only what commits described, and construction is not a
commit: slots passed to a constructor exist before anything can watch, so a watcher wired
afterwards never hears about them. Start the source empty and assign its slots after the
watcher is wired, as above, or hand the receiving side a starting point with
`fromSnapshot(snapshot(source))` and replicate from there.

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

## Derive values from what you read

`map` turns a scope into a derived value, and derived values compose:

```ts
const caps = observer(doc).path('title').map((v) => String(v).toUpperCase());
const area = all([observer(doc).path('width'), observer(doc).path('height')])
	.map(([w, h]) => Number(w) * Number(h));

caps.get();                       // the current value
const stop = area.watch(render);  // the new value, after each change
area.effect(render);              // the value now, and after each change
```

`watch` means two things, and the types keep them apart: on a scope it delivers commits,
because a scope is about a place in a document; on a derived value it delivers the value,
because there is no commit. Derived delivery runs after the whole commit has been
delivered, so a value combining two branches never computes against half a commit, and an
`atomic` block is one recompute however much it writes.

A derived value is memoized while something watches it and recomputed on read while
nothing does, so an abandoned chain holds no subscription. A change that settles to an
equal value (`Object.is`) is not delivered: a container mutated in place reads as
unchanged, so derive the field you mean, not the container holding it. The transform must
be pure per input; anything else it reads is not tracked.

`bool(a, b)`, `def(fallback)`, `defined()` and `unwrap()` are shorthand over `map`.
Writing goes through a declared path only: `map` is read-only, `setter(fn)` declares the
write half, and `isImmutable()` answers before an input renders. `selector` is per-key
selection that scales: a change reaches the two keys it moved between and no others.

```ts
const select = observer(app).path('selectedId').selector();
select(id).effect((on) => row.classList.toggle('active', on)); // per row
select(id).set(true);                                          // select this row
select(id).set(false);                                         // clear, only if selected
```

`set(true)` writes the key to the source. `set(false)` clears the source only when this key
is the selected one, so deselecting a row that already lost the selection changes nothing.

## Interface state lives in cells

A cell is a reactive value outside the document: no delta, no replication, no place in the
undo history. Which tab is open is a cell; the document is the document.

```ts
const open = mutable(false);
open.set(true);
const label = open.bool('hide', 'show');

timer(1000).map(() => new Date().toLocaleTimeString()).effect(show);
fromEvent(window, 'resize').wait(100).effect(relayout);
```

Writing a cell into a document slot is refused (`cell-in-document`), so whether state
replicates stays answerable from the type being written. `immutable(x)` wraps anything as
a read-only view or a constant.

`throttle(ms)` and `wait(ms)` exist only on this value surface. A commit stream cannot be
rate limited through this API, because a receiver that misses one commit of a burst holds
a different document forever after. Reads are never delayed, only delivery.

## Watch a shape, not only a place

A scope step can be a wildcard: `skip(count)` matches any run of keys, `tree(key)` matches
the named key at any depth. They are ordinary steps, so `path`, `ignore` and `shallow`
compose with them unchanged.

```ts
observer(board).skip().path('done').watch(fn);  // every column's done flag
observer(doc).tree('draft').watch(fn);          // any draft, anywhere
```

A wildcard scope names many places, so it has no single value: `get()` is undefined,
`set()` throws, and `isImmutable()` is true. Only scopes that use wildcards pay for the
backtracking matcher.

## A snapshot rebuilds

`fromSnapshot(snapshot(doc))` is a live copy: same ids, kinds, slots, positions and
aliases, and it accepts commits addressed to the original's ids from then on. It holds
what the document says, not the detached observables the original still indexes, so
replaying a history that resurrects one is the commit log's job, not a snapshot's.

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

Deliberately not here: any transport, any persistence, any DOM. `sort`, `reverse`, `fill`
and `copyWithin` on an array throw, because they cannot be expressed as changes to the
slots they appear to touch.

The wire format lives in `spec/`, the reasoning in `docs/design/`, and a complete
program using all of the above in `examples/core/`.
