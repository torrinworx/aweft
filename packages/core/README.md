# @aweftjs/core

Observables, the deltas they produce, commits, scopes and identity.

State lives in observables of three kinds: `createObject({ ... })` (string slots),
`createArray([ ... ])` (ordered, addressed by positions that survive edits elsewhere) and
`createMap([[key, value], ...])` (keyed by id), each taking its initial contents. Assignment
is the mutation, and an array's `push`, `splice` and index assignment are edits like any
other. Every property of an observable belongs to you; everything the library does is a
free function that takes the observable, so no field name is reserved.

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

// Undo: a watcher that asks for it gets the commit that undoes each change.
const undos: Commit[] = [];
const stopRecording = observer(doc).watch(
	(change) => undos.push(change.inverse()), { inverse: true });
doc.title = 'oops';
stopRecording();          // stop before undoing, or the undo records itself
apply(doc, undos.pop()!); // title is 'plan b' again

stop();
```

Registering a watcher returns the function that stops it, always.

A watcher cannot tell a commit landed with `apply` from a local mutation. An undo stack that stays
subscribed while it undoes will record its own undo; hold a flag for the duration of the call, the
way [`recipes/core`](https://github.com/torrinworx/aweft/tree/main/recipes/core) does.

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

A replica built from commits holds only what commits described, and one thing is never
described: the slots the **watched** observable was constructed with. Nothing can watch an
observable before it exists, so a watcher wired afterwards never hears about them. Start the
source empty and assign its slots after the watcher is wired, as above, or hand the receiving
side a starting point with `fromSnapshot(snapshot(source))` and replicate from there.

Everything below that is fine. Attaching an observable into a watched document emits the
slots it was constructed with, in the same commit as the attach, so a subtree built and
attached in one breath replicates whole:

```ts
atomic(() => { doc.settings = createObject({ theme: 'dark', limit: 5 }); });
// three deltas: the attach, and one for each slot the child was constructed with
```

Compare the two by deep equality, not by `JSON.stringify`. A snapshot's slots are a plain
object, so the order they were inserted in is part of the string and is not part of the
document: applying the same commits in two orders gives two strings for one document.
`canonicalJson` in the sibling testing package is the comparison that holds.

## Refusing a change before it lands

`intercept(doc, fn)` puts a rule on a document. It is called with the commit about to close,
after every delta has been applied and before any watcher is told, and it answers with the
reasons to refuse. Empty means the commit closes.

```ts
const stop = intercept(doc, (commit) =>
	doc.title === '' ? [{ code: 'invalid', message: 'a title needs a name', path: ['title'] }] : []);

doc.title = '';        // throws RefusedError; doc.title is what it was
apply(doc, arriving);  // refused the same way, and nothing was delivered
stop();
```

A refusal rolls the whole commit back and tells nobody, exactly as a throwing `atomic` block
does, then throws a `RefusedError` carrying the refusals at whoever made the commit: the
assignment, the block, or the `apply`. Catching it is a complete recovery, because there is
no half-applied state to repair.

One seam covers every way a commit is made, so an assignment, a block and an arriving commit
are all read by the same rule, and a block is read once with everything it wrote. A rule is
about a whole document, not the subtree under the observable it was registered on.

Inside a rule the document reads as the commit would leave it, which is what a rule across
two slots needs. Writing to it from in there throws `sealed`: a change made from inside the
answer would be a change to the commit being answered for. Several rules on one document all
run, refusals and all, so one commit reports every problem it has rather than one per retry.

`@aweftjs/schema` is this with the rule written for you from a description of the document.

## Scope where you read, not at the root

A scope registers its listener on the observable it was built from, and delivery walks each
delta up its attach path checking every listener it passes. So the cost of a write is the
number of listeners standing between it and the top.

```ts
observer(doc).path('tasks', 3, 'done').watch(fn);  // checked on every write anywhere
observer(task).path('done').watch(fn);             // checked only on writes under task
```

Both see the same changes. The first is checked on every write in the document, the second only on
writes under `task`. Measured with
[`bench/write.ts`](https://github.com/torrinworx/aweft/blob/main/bench/write.ts), on one write
nobody matches: 1,000 listeners on the root cost 4.56 us and 10,000 cost 51.59 us, while the same
listeners registered on the observable they are about stay flat at 0.42 to 0.45 us. Start the
scope at the thing you are reading and the question does not arise.

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

`mutableArray(items)` is a list cell: an array edited in place (`push`, `splice`, index
assignment) whose `watch` delivers each edit as a list of changes, with no delta and no place
in a document. A list on the page that is not part of the document, such as open toasts.

`derive(fn)` is a value of the whole list, recomputed on every edit, for the questions a page
asks about a list rather than about one row:

```ts
const rows = mutableArray<Session>();
const empty = rows.derive((items) => items.length === 0);
const total = rows.derive((items) => items.reduce((sum, r) => sum + r.bytes, 0));
```

It is an ordinary derived value: watchers hear only the answers that changed, so a `fn` that
builds a fresh array or object is delivered on every edit, and reading it while nothing watches
computes it there and then. Unlike `watch`, it settles inside an `atomic` block where each edit
is made, the same as a plain cell does.

Inside `atomic`, the calls in the block deliver once at its close, as one list in the order
they were made, so a swap written as two index assignments arrives as one change list and a
binding over the list moves both rows:

```ts
atomic(() => { const t = rows[1]; rows[1] = rows[998]; rows[998] = t; });
```

A block that throws still delivers them, because nothing rolls the list back. A watcher hears
exactly the changes made after it subscribed and before it unsubscribed, so one that subscribes
part way through a block is told the rest of it and one that unsubscribes inside a block is
told nothing. A plain cell is different: `mutable(x).set(v)` notifies inside the block, since
holding it would make a derived value that is being watched read the value the block just
overwrote.

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

`skip()` matches exactly one step unless you say otherwise, and a scope at a depth nothing
sits at is silent: it never matches, and a derived value on it sits at its initial value
forever, which reads as a counter that works and is always zero. Count the steps from the
observable the scope starts at, or use `tree`, which does not care how deep the thing is.

## A snapshot rebuilds

`fromSnapshot(snapshot(doc))` is a live copy: same ids, kinds, slots, positions and
aliases, and it accepts commits addressed to the original's ids from then on. It holds
what the document says, not the detached observables the original still indexes, so
replaying a history that resurrects one is the commit log's job, not a snapshot's.

## Removing something takes it out of the document

Taking an observable out of the document leaves it readable and no longer writable. A write
to it throws `unreachable`, which is what a receiver does with the same delta.

```ts
const task = tasks[0];
tasks.splice(0, 1);
isReachable(task);  // false
task.done = true;   // throws unreachable
byId(board, id);    // undefined: the document no longer holds it
```

The commit that detached it takes it and everything under it out of the document as it
closes, so nothing that has been removed keeps the document alive. Hold the observable
yourself if you still want it; attaching it somewhere again is a commit that carries
everything it holds, so a replica gets it back in full (design 084).

Ask `isReachable` rather than catching the throw. `parentOf` cannot answer it: it returns
undefined for a document root, which is reachable, and for something detached, which is not.

## Finding a thing by its id

A delta names the observable it changes by id. `byId(doc, id)` answers with the observable,
and `pathOf(observable)` answers with the slot names from the root down, spelled the way the
format spells a slot. Both cost the depth, never the document, so a check that runs on every
commit can afford them.

```ts
const task = byId(board, delta.id);
pathOf(task);        // ['tasks', '80a1c2e3']
pathOf(board);       // []
pathOf(orphan);      // undefined: nothing attaches it, and byId no longer finds it
```

## Boundaries

The `Change` a watcher receives is a `Commit`: its `deltas` are exactly what crosses a
boundary, and `apply` on the far side takes them unchanged. The sibling codec package
turns a commit into bytes and back.

Deliberately not here: any transport, any persistence, any DOM. `sort`, `reverse`, `fill`
and `copyWithin` on an array throw, because they cannot be expressed as changes to the
slots they appear to touch.

The wire format lives in [`spec/`](https://github.com/torrinworx/aweft/tree/main/spec), the
reasoning in [`docs/design/`](https://github.com/torrinworx/aweft/tree/main/docs/design), and a
complete program using all of the above in
[`recipes/core/`](https://github.com/torrinworx/aweft/tree/main/recipes/core).

## Known limits

**Nothing records what a function read while it ran.** A transform is pure per input and what
it reads besides its input is not tracked, and no scope here records reads and re-runs on a
change to one of them. So anything reactive has to name what it follows, with `all([...])` or
with the scope you mean, and a callback that reaches for a cell nobody handed it goes quiet
when that cell changes. Settling it means a read-recording scope in this package, priced
against what recording adds to every read.

**`snapshot` can produce a document `fromSnapshot` refuses.** An `alias` may name an
observable that a later edit takes out of the document: `snapshot` leaves the observable out,
because nothing attaches it, and still writes the alias, so rebuilding that snapshot throws
`unreachable: <id> is named but not in the snapshot`. You meet it when you alias an
observable, detach it, and then save the document and build it again. `@aweftjs/store` drops
the dangling slot as it opens a document (design 050); which answer holds in general, dropping
the alias, carrying what is named as well as what is held, or refusing the detach, is open.

## The design notes

A `design NNN` above is the note of that number in
[`docs/design/`](https://github.com/torrinworx/aweft/tree/main/docs/design), which says what was
decided, why, what it costs, and what would reverse it.