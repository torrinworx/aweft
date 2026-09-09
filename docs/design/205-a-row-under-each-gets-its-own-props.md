# 205: A row under `each` gets its own props object

## Decision

**A component mounted under `each` is called with a props object of its own, holding this row's
item under `each`.** A function the body writes down closes over that object, so it reads its own
row's item whenever it is called, which is what a per-row handler needs.

Until now every row was called with the one props object `h` made at the call site, and the item
was written into it just before the body ran. The body read the right item while it ran, so every
row's text was right, and every closure the body left behind read the object again later, when it
held the last row's item. Six buttons on six rows all acted on row six. Nothing said so.

```ts
const Row = (props: { each: Session }) => h('li', {},
  h(Button, { label: 'Revoke', onClick: () => revoke(props.each) }),   // was the last row
  h('em', { $onclick: () => revoke(props.each) }, props.each.device)); // was the last row too
```

Both spellings were wrong for one reason, and it is not the clone path: a nested component's props
are built fresh per row, and a cloned row writes each row's own values into its own holes. The
handler was right in both places and the item it read was shared.

**The call site keeps its identity.** The row template is cached per call site and the shared props
object is what stands for it (design 099), so that object is still what `beginRow` and `endRow` are
handed. The copy is the body's argument only.

**`each` is no longer written into the shared object.** It holds the list it was given, which is
also what `h(Component, { each: list })` mounted a second time now reads: before this, a re-mount
read whatever the last row left there and mounted that item as the list.

## Why

The symptom costs a page the row component: it has to be rewritten as a delegated click on the
table body with the row's id in an attribute. A page outside this repo printed six clicks over
three rows, every one of them `r3`, with the rows' own text correct.

The choice is between binding the function per row and refusing a per-row function prop loudly.
Refusing means a component under `each` may not carry a callback at all, which is most of what a
row is for, and the README's clone rule says the opposite: values vary per row. So the rule was
right and the mounter was not keeping it.

The list stays cheap because the copy is one object per row with the props the call site already
has, and `ui` already pays exactly that for a row written as `each:name` (`packages/ui/src/h.ts`
spreads the props into a new object to rename the item). Measured on the row table, below.

## Evidence

`packages/dom/tests/behavior.dom.test.ts`, "a per-row function prop is called with its own row, on
a nested component and on an element": three rows, a handler on a nested component and a handler
on a plain element in each, every one dispatched. Before the change it read
`['comp:r3','elem:r3','comp:r3','elem:r3','comp:r3','elem:r3']`; after it, each row's own
item, the rows' text asserted the same way throughout.

Three ways to get this wrong, each caught. The copy dropped so the body takes the shared object
again is caught by the case above, alone. The item left out of the copy is caught by 37 cases,
which is what says how much of the suite depends on a row knowing its item. The copy handed to
`beginRow` as the cache key as well, which is the mistake this change is one step away from, is
caught by four, among them the compiled row's count of one recording per list.

`bench/dom-rows.ts` in Chromium, three runs of the tree without either fix and three with both,
nothing else running: create 1,000 rows 8.10 then 8.60 ms, replace all 1,000 7.90 then 9.20,
create 10,000 78.50 then 84.20, append 1,000 to 1,000 5.20 then 5.10, clear 10,000 21.20 then
13.70, each the best figure of the three runs. Repeating the measurement on one unchanged tree
moves further than that (create 10,000 read 78.50, 87.60 and 107.00), so the reading is that
neither change shows on the row table, which is what their shapes predict.

## What this costs

One object per row, with the call site's props copied into it. It is allocated whether or not the
body keeps a closure, because the mounter cannot know.

A body that writes into its own props object no longer writes into a value anything else can read.
Nothing documented ever said it could.

## What would reverse this

A measurement showing the per-row copy costs more than a page can afford on a list of the size
applications actually build. The answer then would be a copy made only when the body asks for one,
which means a second way to write a row and a rule about which one to use.
