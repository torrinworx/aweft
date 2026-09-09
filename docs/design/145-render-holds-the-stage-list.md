# 145: `render` holds the stage list, as it holds the head

## Decision

`ui`'s `render` holds the render object's stage registry for the length of the call, exactly as
design 127 holds its head list. So after `await render(item, { context: own })`, `own.stage.items`
still holds one entry per `StageContext` the page mounted, each answering `acts`, `prefix` and
`parent` as design 126 says.

The hold itself moved down into `registry.ts` as `hold(registry)`, because it is now wanted by two
of the render's lists and the head list had the only copy of it. `createRegistry` stops letting go
once it is held: `add` still returns a removal and the removal does nothing. `holdHead` is gone and
`render` calls `hold(own.head)` and `hold(own.stage)` instead.

Nothing else changes. A page that mounts still lets go: `mount` and `hydrate` hold neither list,
so a stage that unmounts on an act change leaves the registry, which is what keeps a live page's
registry equal to what is on the page.

**A second `render` on a render object that has already rendered one is refused.** `hold` answers
whether it was already holding, and `render` asserts on that, naming "one context() per page". The
hold is what keeps the lists after the page comes down, and it is therefore also what makes a second
render accumulate: measured before the assert, two renders on one `context()` left three stage
entries and three head tags, and a walk over that object reported prefixes `["", "", "docs"]`.
Designs 109, 127 and 145 all say a render object is for one page; this is where that is enforced
rather than described.

## Why

A static walk reads the stage list to learn which URLs a site has, and a walk runs after the render
rather than inside it. Measured on this tree, before the change: with
`const own = context(); await render([h(Site, { router }), h(Peek, {})], { context: own })`, a
sibling's `mounted` callback saw one entry on `/` and on `/docs/install`, and a sibling's `pending`
promise twenty milliseconds later saw two on `/docs/install`; after `render` returned,
`own.stage.items` was empty on every URL. `render` mounts the page, serializes it and takes it
down, and the stage's removal takes its entry out with it.

The alternative was for a walk to reach into the render mid-call, with a component of its own
mounted beside the page to snapshot the registry from a `mounted` callback. That reads the tree at
a moment nobody can name: a nested stage inside an act that is still pending is not there yet, so
the walk would miss exactly the pages it exists to find.

## What this costs

A render object that has been through `render` reports stages that are no longer mounted, which is
the same surprise design 127 already carries for head tags, and the same answer: a render object
is for one page. Reading `use(context).stage` from inside a live page is unaffected, because
nothing mounted holds the list.

## What would reverse this

A caller wanting to render several pages through one render object, which the hold makes
impossible for stages as it already does for tags. Design 109 says a render object is per page, so
that caller would be arguing with 109 rather than with this.
