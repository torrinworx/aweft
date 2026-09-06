# @aweftjs/debug

Reads a running document or commit back as text.

Nothing in the stack imports this package, and nothing may: it is registered as an integrator,
so the boundary check fails on any package that reaches for it. You import it yourself, in a
test, in a script, or in a running server while working out what happened. It is not stripped
from a release build, because the moment you most want it is the one you did not plan for.

Every function here returns a string. That is deliberate. The reader is usually looking at test
output or a terminal, and a rich object printed into either is worse than a plain line.

## Quickstart

```ts
import { createObject, observer } from '@aweftjs/core';
import { explain, trace } from '@aweftjs/debug';

const doc = createObject({ title: 'plan', size: 1 });

// What is in here?
console.log(explain(doc));
// object Hh8kQ2...  (title: 'plan', size: 1)

// What is happening to it?
const t = trace(doc);
doc.title = 'plan b';
console.log(t.text());
// commit  (deltas: 1)
//   replace title  (value: 'plan b')
t.stop();
```

## The four readers

`explain(subject, document?)` takes whatever you are holding and works out what it is: an
observable, a commit, or either kind of refusal. It never throws. A value it cannot place comes
back saying so, because a debug call that fails leaves you worse off than before you made it.

`documentOf(document)` reads a whole document as a tree, with each observable under the slot
that holds it rather than in the flat id-keyed map a snapshot gives you. An observable reached
twice prints once and then as a back-reference, so an alias cycle terminates. One the document
no longer holds reads as `detached` rather than as the tree it used to sit in.

`commitOf(commit, document?)` reads a commit as the list of what it changed. Pass the document
and every id becomes the path that reaches it; leave it out and each delta names its observable
by id text.

You will see two spellings for an array slot, and the difference is real rather than sloppy.
`documentOf` prints `[0]`, because it is looking at the whole array and can count. A delta prints
`[at 018143c4ab]`, because a delta carries one position key and the index that key sits at
depends on every other position in that array, which the delta does not carry. When a commit is
read against its document the path resolves and you get the index.

`trace(document, limit?)` watches a document and keeps what it did. It is an ordinary watcher,
so it hears commits after they land and it stops when you call `stop()`. It keeps the last 200
commits by default; a trace left running on a busy document is a memory leak with a friendly
name, so the limit is not optional behaviour you have to remember to add. Each commit is
rendered as it lands, so a trace does not change its mind about a commit when the tree above it
moves later.

## Why `console.log` is not enough

An observable is a proxy over an internal node. `console.log(row)` prints that node: raw id
bytes, a `slots` Map whose values print as `[Object]`, `listeners`, `watchers`, `reach`, and
circular `parent` and `root` back-references. It is many lines, and none of them is your data.
`JSON.stringify(row)` is worse: it walks the whole document from wherever you happened to be
standing. `explain` asks the document what it holds and prints that.

## Reading a refusal

Two different errors reach you, and they read differently because they come from different
places. `explain` handles both.

**A refusal from the library** carries a stable `reason`, a `detail` saying what was seen, and
a `fix` saying what to do:

```ts
try {
	apply(doc, { deltas: [] });
} catch (e) {
	console.log(explain(e));
	// refusal empty-commit  (message: ..., fix: Drop the commit instead of applying it, ...)
}
```

Branch on `reason`, never on the message. The message is written for a person and is allowed to
change; the reason is part of the format's contract.

**A `RefusedError` from a guarded document** is different, and it is the one you meet most. It
comes from a rule your own application wrote, through `intercept` or through `@aweftjs/schema`,
so it carries a list of refusals rather than one reason, and none of them carries a `fix`: the
library did not write them and has nothing to suggest.

```ts
try {
	doc.total = -1;                     // a rule the application registered refuses this
} catch (e) {
	console.log(explain(e));
	// refused  (refusals: 1)
	//   refusal negative-total  (at: 'total', message: 'a total is never negative')
}
```

The remedy for one of these is whatever your rule meant, so put it in the rule's own `message`.
Whether a `Refusal` should carry a `fix` field of its own is an open question.

## What this package will not do for you

It does not tell you *why* a watcher did not fire. It shows you what the document holds and what
commits landed, and the answer is usually in those two, but working it out is still yours.

It does not attach to anything on its own. There is no global, no auto-install, and no side
effect from importing it.

**It covers `@aweftjs/core`, and only that.** Documents, commits and refusals. It does not read
a live scope, a mounted node, a link or a store row: those live inside packages that hand out no
way to see them, and reaching in would have meant a new permanent export in each. Design 103
records that seam being designed and then withdrawn unbuilt. `explain` on one of those objects
tells you it cannot place it rather than guessing at it.
