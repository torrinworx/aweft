# @aweftjs/schema

The shape a document keeps, and the answer to whether a commit keeps it.

You describe a document with three words. `check` says whether a commit would take it outside
that description, and `guard` runs that check on every commit, wherever the commit came from.
Nothing here knows who wrote anything.

## Quickstart

```ts
import { createArray, createObject, RefusedError } from '@aweftjs/core';
import { guard, list, shape } from '@aweftjs/schema';

// `text` and `flag` are validators you already have, or hand-written ones like the two
// under "Three words, and a leaf" below.
const Board = shape({
	title: text({ min: 1, max: 60 }),
	tasks: list(shape({ title: text({ min: 1 }), done: flag() })),
});

const board = createObject({ title: 'release 1', tasks: createArray() });
const stop = guard(board, Board);

board.title = 'release 2';        // fine
board.tasks.push(createObject({ title: 'ship it', done: false }));  // fine

try {
	board.title = '';
} catch (error) {
	if (error instanceof RefusedError) console.log(error.refusals[0]!.message);
}
// board.title is still 'release 2'. Nothing was delivered to any watcher.

stop();
```

Registering the guard returns the function that stops it, always.

## Three words, and a leaf

`shape(fields)`, `list(item)` and `table(value)` describe the three observable kinds: an
object, an array, a map. That is the whole vocabulary. A field, an item or a value is either
one of those three again or a **leaf**.

```ts
const Person = shape({ name: text({ min: 1 }), tags: list(text()) });
const People = table(Person);                 // a map of people, keyed by id
const Everything = shape({ people: People, motto: text() });
```

A leaf is any validator implementing the Standard Schema interface: an object with a
`'~standard'` property carrying `{ version: 1, vendor, validate }`. Every validator library
that implements it works here, and this package takes no dependency on any of them, because
the interface is a contract rather than a library. Writing one by hand is a few lines:

```ts
const text = ({ min = 0 } = {}) => ({
	'~standard': {
		version: 1,
		vendor: 'my-app',
		validate: (value) => typeof value === 'string' && value.length >= min
			? { value }
			: { issues: [{ message: `expected at least ${min} characters` }] },
	},
});

const flag = () => ({
	'~standard': {
		version: 1,
		vendor: 'my-app',
		validate: (value) => typeof value === 'boolean'
			? { value }
			: { issues: [{ message: 'expected true or false' }] },
	},
});
```

**An alias is judged where it is filed, once.** Filing an observable that already lives
elsewhere into a described slot holds the whole of it to that slot's description at filing
time. Afterwards a write into it is judged at the one path it lives at, which is what an
alias is: a second name, not a second home.

**A named object field is expected to be there.** Removing it is judged by validating
`undefined` against its leaf, so a field that may be absent is one whose validator accepts
`undefined`, which is the same question asked once instead of twice. An array and a map say
what an element is and never how many there are, so removing an element or an entry is always
fine, and an empty one is fine.

## What a refusal looks like

Every answer is a list of refusals, empty when there is nothing wrong.

```ts
[{ code: 'invalid', message: 'expected at least 1 characters', path: ['tasks', '80', 'title'] }]
```

- `code` is `invalid` when a leaf refused the value, `kind` when an observable lands where a
  value belongs or an observable of the wrong kind lands, and `unexpected` for a slot the
  description does not name.
- `message` is the validator's own.
- `path` is the way down from the document root, spelled the way the document spells its own
  keys: an object key as itself, an array position in hex, a map id in text form.

`Refusal` is core's type, so a rule, a link and an application all say refusal the same way.

## `check` at a door, `guard` on the document

`check(Board, board, commit)` answers about one commit and changes nothing. Reach for it where
a node decides whether to take a commit at all:

```ts
import { apply } from '@aweftjs/core';
import { check } from '@aweftjs/schema';

const receive = (commit) => {
	const problems = check(Board, board, commit);
	if (problems.length > 0) return problems;   // turned away, nothing applied
	apply(board, commit);
	return [];
};
```

`guard(board, Board)` is that same check on every commit, through core's `intercept`. A local
assignment that breaks the description throws a `RefusedError` carrying the refusals and the
document is exactly as it was; a commit arriving through `apply` is refused before any watcher
hears about it. A block is one commit, so a block with one bad write in it goes back whole.

The answer does not depend on when you ask. `check` gives the same refusals before the commit
has been applied and after, which is what lets one description serve a door, where nothing has
landed, and a guard, where everything has.

**What a commit attaches is judged whole, at the path it lands on.** A subtree built and
attached in one breath has no path of its own until the commit closes, and it is judged at the
one it lands at, not at the place it was built. That includes what is missing: an object that
arrives without a field the description names is refused, though no delta in the commit is
wrong on its own.

**Judging a commit is not judging a document.** `check` answers for what the commit changes
and takes the rest of the document as it finds it. A document that was already outside its
description stays that way until something writes to the slot that is wrong. Put the guard on
before the first write, or read the whole document yourself once.

## Two ends with the same guard never refuse each other

A guard refuses a commit before it closes, so a guarded end never makes a commit that breaks
the shape, and nothing invalid ever reaches the wire from it. Put the same guard at both ends
of a link and every refusal is local: the write that broke the shape threw where it was made.
An arriving commit is refused only when the end that sent it was running weaker rules, or
none, which is exactly the case a `guard` on the receiving end exists for. To see that path
in a test, run the guard at one end only.

## A draft is not document state

A guarded field refuses a half-written value. That is what it is for, and it is why a draft
under edit does not belong in the document: an email address is invalid for every character
but the last one.

```ts
import { mutable } from '@aweftjs/core';

const draft = mutable('');
input.oninput = () => draft.set(input.value);   // no commit, no rule, no replication
form.onsubmit = () => { person.email = draft.get(); };  // one commit, checked once
```

That is already the rule for interface state (design 024): what is being typed lives in a
cell, and the document holds what was submitted.

## A validator has to answer now

A commit closes synchronously, so a validator that returns a promise cannot decide one.
`check` throws `async-validator` at the first leaf that does, naming the path, rather than
letting the commit close and refusing it once watchers have already seen it. Asynchronous
answers, such as asking a server whether a name is taken, belong before the write: hold the
draft in a cell, ask, then commit.

## Boundaries

Deliberately not here:

- **Anything about who.** There is no actor, user, role, permission or policy in this package,
  and no argument threaded through to carry one. A description says what a document may hold.
  Which node may write where is the application's rule, and the place to put it is the same
  seam: `intercept` in core takes any function that can refuse.
- **Transport and storage.** `sync` moves commits between documents and `store` keeps them.
  This one answers a question about a commit and returns a list.
- **Rules across two slots.** This package holds each slot against its own leaf. A rule
  like "ends after it starts" is a refinement on a description, which is the natural extension
  and changes nothing on the wire. It is not built until an application asks for it. Until
  then, write it as your own `intercept` beside the guard: inside one, the document reads as
  the commit would leave it.
- **Repairing anything.** A commit is refused whole or taken whole. Nothing here rewrites a
  commit to make it fit.

The reasoning lives in `docs/design/057` and `058`, and a complete program using all of the
above in `recipes/schema/`.
