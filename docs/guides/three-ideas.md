# The three ideas

Everything in the stack sits on three ideas. A reader who holds them can predict what a package
does before reading its README, and a reader who does not will find every package surprising in
the same way.

## The document is the API

State is an observable document. Assign to it, and the change is a commit that the page renders,
the peer receives and the store keeps. There is no request for reading state and no event for
its change: `observer(doc).path('x').watch()` is the one way to follow anything.

```ts
import { atomic, createObject, observer } from '@aweftjs/core';

const doc = createObject({ title: 'plan', done: 0 });
const stop = observer(doc).path('title').watch(() => console.log(doc.title));

doc.title = 'plan b';                                   // one commit; the watcher runs once
atomic(() => { doc.title = 'plan c'; doc.done = 1; });  // one commit, however much it writes
stop();
```

A server module shares a document by name; a page shares the same name and holds the same
object. `@aweftjs/sync` carries the commits between the two ends over any channel, both ends
equal, and `@aweftjs/store` keeps them. The wire format is written down in `spec/`, so a second
implementation in another language is held to the same bytes. `packages/core/README.md` is the
observables and the commits; `packages/sync/README.md` is the two ends.

## Cells against documents

A cell, `mutable(0)`, is one value a component follows: a count, a flag, a draft. A document is
the state another end cares about. A page has both, and a cell is what a `ui` prop takes.

```tsx
const draft = mutable('');
<TextField label="Title" value={draft} />
```

A control given a cell writes it and follows it; given none, it keeps its own. Nothing in the
page is imperative: there is no handle to call, only cells to write. When a cell's value is
what the server should see, it goes into the shared document, and the document's commit is what
crosses the wire. `packages/ui/README.md`, What every component takes, is the rule for every
component.

## A refusal carries its fix

Every error the stack raises has a `reason` to switch on and a `fix` that says what to do. Read
the fix before anything else; it is usually the whole answer.

```
Error: ui: no icon named sun-moon: 1 source(s) were asked. Wrap the page in <Icons value={pack}>
with a pack or resolver that has it; @aweftjs/icons gives you one from an installed set.
```

Every package page on this site has a Refusals section, which is that package's `errors.txt`:
every reason it can refuse with, and the fix beside it. A refusal that crosses the wire keeps
its reason, so a page reads what a module refused and why.

## Where the three meet

A page renders a document through cells; a module holds the document; the store keeps it; a
refusal from any of them says what to do. `recipes/todo-list/` is the first idea on its own,
`recipes/two-clients/` two people on one document, and `recipes/optimistic-write/` a write the
server refuses and the page rolls back. `packages/` is one package per job, and a package that
does not need another does not know it exists.
