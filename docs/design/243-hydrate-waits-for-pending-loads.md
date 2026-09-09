# 243: `hydrate` waits for pending loads before it finishes

## Decision

A hydration is not over when `hydrate` returns. It is over when every promise a component handed
to `pending` during it has settled. Until then the pairing walk is still open: a mount that runs
later still claims the server's nodes, the mismatch check has not run, and nothing the server
sent has been taken away.

```ts
const page = hydrate(document.body, h(Site, { router }));
await page.ready;   // every pending load settled, the pairing check has run
page();             // still the remove function it always was
```

### What changes in `dom`

**One thing: when `endHydration` runs.** `hydrate` mounts and drains as it always did, then:

- **Nothing is pending**: the hydration is finished inside the call, exactly as before. Every
  page in the repo that hydrates today takes this path and nothing about it moves.
- **Something is pending**: `hydrate` still returns synchronously, having adopted everything the
  first walk reached, and the finish is deferred. It waits on the root's pending set the same way
  `render` does (`while (pending.size > 0) await Promise.allSettled([...pending])`), then runs the
  mismatch check and drops the hydration.

**`hydrate` returns `Hydrated`: the remove function, with `ready` on it.** `ready` resolves when
the hydration has finished, whether that was inside the call or later. It never rejects. A
mismatch found in the deferred finish is thrown on a fresh task, the way `suspend` reports a
rejection nobody named a failure component for, so the host reports it rather than a caller who
happened to await. A caller who wants to know when the page is fully live awaits `ready`; a
caller who does not is unchanged, because `Hydrated` is the same callable it always was.

**A hydration removed while a load is in flight finishes nothing.** `remove()` drops the pairing
state, so the deferred finish returns without asserting: the page is gone, and every node the
server sent went with it.

### What does not change

- The pairing walk itself. `claim`, the region bookkeeping, the text splitting, the attribute
  comparison and the production teardown are untouched.
- The synchronous adoption. Everything the first walk reaches is claimed before `hydrate`
  returns, so a page with no lazy act behaves to the byte as it did.
- `mount` and `render`. Neither knows about this.
- The one-live-hydration-per-target rule, and every assert `hydrate` already makes.

### What a page sees while the load is in flight

**The server's markup, untouched.** The region a `suspend` claimed still holds exactly what the
server wrote, and the client has put nothing over it. That is the whole point: a page whose act
arrives through a loader must not flash a spinner over content the server already sent.

For that to hold, `ui`'s `suspend` shows no waiting component while a hydration is open. Outside
one it is unchanged: the call's own `fallback`, else the `LoaderContext`'s `loading`, else
nothing. Inside one, showing the loading component would build elements the server's markup has
no pair for, which is a mismatch and a replaced subtree, which is the failure this note exists to
remove. `dom` exports `hydrating()` for that question, which the hoisted template already
asked internally.

## Why

Measured on `recipes/routed-site`, elements counted by identity before and after:

| URL | act | before | after | result |
| --- | --- | --- | --- | --- |
| `/docs/install` | a plain component | 12 | 12 | all 12 adopted |
| `/about` | arrives through a loader | 11 | none | `hydration mismatch: the server sent 5 node(s), 1 region(s) among them, that the client did not render` |

The reason is the order. The server render awaits `pending`, so the act's content is in the
markup. The client mounts the `suspend`, which claims the region and puts nothing in it yet,
and then `hydrate` finishes: the walk is over, the region nothing entered is surplus, and the
five nodes inside it are what the server sent that the client did not render. The act arrives one
microtask later, into a hydration that has already been closed and a page whose markup has been
thrown away.

With an act name as the lazy form (design 242), that is not an edge case any more. It is what
every page with a `deps` on it does.

## What it costs

**A page with a pending load has a window where it is hydrated but not finished.** During it the
surplus check has not run, so markup the server sent and the client will never render is still on
screen. That window is exactly as long as the load, and closing it earlier would mean deciding
before the answer is in, which is the bug.

**A mismatch on that path is reported asynchronously.** It is still loud, and it still names the
same nodes, but it arrives at the host rather than out of `hydrate`. That is the price of
`hydrate` staying synchronous.

**`hydrate` grew a field.** `Hydrated` is `Remove` with `ready`, so nothing a caller wrote
before needs a change, and `ssg`'s `attach`, which answers `Remove` for both a hydration and a
mount, is unchanged.

## What was considered and not done

**Making `hydrate` async.** It would put the whole pairing walk behind an await, so a page could
render between the server's markup and the client taking it over, and every caller including
`ssg`'s `attach` would have to become async to get the remove function. The waiting is a property
of the load, not of the adoption, and the two do not have to move together.

## What would reverse this

A page that has to know synchronously that a hydration is complete, or a load whose promise never
settles at all and therefore leaves the surplus check pending forever. The second is a real
shape: a module that waits on a connection that never opens does exactly that on a static render,
but a static render is `render`, not `hydrate`. If a page shows one, the answer is a deadline on
the wait rather than a different finish, and that would be a note of its own.

## Evidence

`packages/dom/tests/render.test.ts`: a hydration with a pending promise mounted inside it adopts
the server's elements by identity, and the same page without the deferral replaces them; the
mismatch check does not run before the promise settles, checked by reading the target's children
synchronously after `hydrate` returned; `ready` resolves for a page with nothing pending and for
one with a load; a pending promise that rejects still lets the hydration finish and leaves the
page consistent; a hydration removed while a load is in flight asserts nothing when the load
lands.

`packages/ui/tests/stage.test.ts`: a named act hydrated with the server's elements kept.

`recipes/routed-site/main.ts` measures both URLs the way the table above does, and asserts zero
elements replaced at each.
