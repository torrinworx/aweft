# 204: A mount takes out what it put in

## Decision

**Unmounting a bound element that leaves the document by itself takes the mounted children back
out of it, so the element is left holding exactly the static nodes `h` built.** The element can
then be mounted again and renders once.

Until now the children were only told to let go of what they held: their nodes stayed inside the
element, because the element was leaving and nobody would look at it again. That is true of every
element the binding builds fresh and false of the one case an application reaches for daily. A
slot's branches are ordinary values:

```ts
<Shown value={editing}>
  <p>editing</p>
  <mark.else><span>{name}</span></mark.else>
</Shown>
```

Both branches are built once, when the component's body runs. `Shown` is a function of its value
and holds no state (it returns the branch, and `mount` takes it from there), so the branch that
comes back is the same bound element as the first time. Its span still held the text node the
first mount put in it, and the second mount put another one in beside it. The text doubled, and
doubled again on every return.

**`remove(gone)` keeps its meaning and is passed on rather than replaced.** `gone` says an
ancestor is already out of the tree, so there is nothing to detach; a mount that is detaching its
own node passes false down and its children detach themselves. The fast paths that clear a whole
list still say true, and still do one write: a list that is its parent's whole content clears the
parent in one call, and a row taken out by an edit has already had its nodes removed by the list
before its mount is told.

**What this does not change:** a component under the same slot was already correct, because a
component builds its result again on every mount. That is why a component child reads its value
once where two inline spans read it twice, and why the workaround people found was to wrap each
branch in a component. Nothing about that workaround was wrong; it should not have been
necessary.

## Why

The symptom is a page that looks right until a section is hidden and shown, with no error and no
warning; three of five people building the same page from the docs alone hit it. A page outside this repo printed
`re-shown themed="n546n546" plain="n546n546" comp="n546"`, three spans in one branch of a `Shown`,
toggled twice.

The alternatives were to clone the element on a second mount, or to refuse a second mount loudly.
A clone has to carry the signals over to the copied nodes, which is the row template's machinery
(design 099) for a case with none of its payoff, and it would break the documented promise that
`h` with no reactive parts answers a node the page can hold and hand back. A refusal would take
away branches written inline, which is the shape the README shows and the one people write.

Symmetry is the simpler rule and it is the one already written down elsewhere: a mount is a handle
with a first node and a way to remove it, and removing it should leave what it was given as it
found it.

## Evidence

`packages/dom/tests/behavior.dom.test.ts`, "a branch mounted again renders once, not on top of
what its last mount left": one branch value holding a bound element with a reactive text child, a
static element, and a component, mounted through a cell, toggled away and back twice with the
cell written in between. Before the change the first return gave `<em>oneone</em>`; after it, the
first return renders once, with the static element and the component unchanged throughout.

Three ways to get this wrong, and what catches each. `gone` written back to `true` in the child
loop is caught by the case above and by `mount.test.ts`. The `if (!gone)` guard dropped from the
text mount, so a child detaches from a parent that is already out, is caught by two list cases.
The child handles left on their signals instead of nulled was caught by nothing, because a dead
handle answers null to everything a caller can ask it, so what it costs is retention and nothing
else. It has its test now, `packages/dom/tests/internal.mount.test.ts`, which is white-box
for that reason.

`bench/dom-rows.ts` in Chromium, three runs of the tree without either fix and three with both,
nothing else running: create 1,000 rows 8.10 then 8.60 ms, replace all 1,000 7.90 then 9.20,
create 10,000 78.50 then 84.20, append 1,000 to 1,000 5.20 then 5.10, clear 10,000 21.20 then
13.70, each the best figure of the three runs. Repeating the measurement on one unchanged tree
moves further than that (create 10,000 read 78.50, 87.60 and 107.00), so the reading is that
neither change shows on the row table, which is what their shapes predict. The row table never
takes this path: a list clearing itself, and a row an edit takes out, both say `gone` and both
still cost one write.

The path this does change, measured on its own in the light tree with `packages/build`'s loader,
best of seven, one element holding 20,000 reactive text children unmounted from the top: 4.38 ms
before, 5.14 ms after, so about 38 nanoseconds per child on top of a teardown that is mostly the
cost of letting the effects go.

## What this costs

Unmounting a subtree from the top now costs one `removeChild` per reactive child inside it,
instead of one for the whole subtree. That is the price of leaving the element usable, and it is
paid where a branch is hidden or a page is torn down, not where a list is edited.

One case is left: an element an application holds, put into a list, removed by a list edit and then
put back. A list takes a removed row's nodes out itself and then tells the row's mount `gone`, so
that mount keeps what it was given and a second mount doubles it as before. Measured: an
`h('em', {}, cell)` the page holds, spliced out of a `mutableArray` and pushed back, renders
`<em>oneone</em>`. Reaching it means keeping bound elements in a list rather than building them per
row, which is what a component under `each` is for, and `packages/dom/README.md` states the limit
where it states the rule.

## What would reverse this

A measurement showing a page whose teardown is dominated by the per-child detach. The answer then
is not to go back to leaving the children in place, but to record each signal's static neighbours
when `h` builds the element and clear the run between them on a second mount, which moves the cost
off teardown and onto reuse.
