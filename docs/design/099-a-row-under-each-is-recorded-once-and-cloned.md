# 099: A row under `each` is recorded once and cloned

## Decision

A component mounted under `each` builds its first row the ordinary way and, while it does,
records the row: the nodes `h` made, and one hole for every value the body handed `h` (each
text child, each reactive child, each attribute, each property). The recorded row is cloned
before anything is bound, so the clone holds the static shape and none of the reactive writes.

Every later row of the same list runs its body again, because the body is where that row's own
sources come from, but `h` builds nothing: it files the call's props and children away and
returns a marker. Closing the row clones the recorded shape and writes this row's values into
its holes. A value equal to the one the first row wrote costs no DOM call at all, which is
where most of the saving is: an attribute that is the same on every row is written once, ever.

**The template is cached per call site, not per component.** `h` makes one props object per
call site, so that object's identity is the call site. The same component under two `each`
lists is two shapes whenever a prop of the list decides the markup, and a cache keyed on the
component function hands the second list the first list's row. The package's own
`component.test.ts` catches that.

**Templating is off for a hydrating root.** There the document already exists and the fresh
nodes exist only to be paired against the server's, one at a time. A clone is not a node the
binding made, so `claim` would refuse to pair it.

**Templating is off for a compiled row, once, for the whole list.** A row body that `build`
compiled calls `template` and never `h` (design 089), so this recorder sees no calls and no
nodes it made, and the first row hands back nothing it can build a template from. The call
site is then marked off in the cache, and every row after it, including rows appended later,
goes straight through with no recording started. That is what makes the two paths cost nothing
to have both of: the compiled path pays one abandoned recording per list, not one per row.
`packages/dom/tests/internal.compiled-row.test.ts` pins the count at one and goes red at the
row count if the decline is not remembered.

**The contract this puts on a component:** a component used
under `each` renders the same node shape on every call. Same tags in the same order, the same
prop keys, the same children present or absent. It is documented, and only the two breaks
below are checked.

**A template is kept only when the first row's `h` calls and the first row's nodes are the same
set.** Three things throw it away, and each of them makes the call site build every row the
ordinary way from then on:

- The row holds a node the application made. There is only one of that node, and a clone would
  hand every later row a copy of it.
- The row holds a node `h` did not make, which in practice means the body called `mount` into
  its own element. A clone would freeze whatever that mount had written when the first row was
  recorded.
- `h` made an element the row does not hold. The body did something else with it, and under a
  replay `h` builds nothing and answers a marker, so a later row would be handed the marker
  where the first row got an element.

**Two breaks are caught, because catching them is free.** The first is a row that did not
return the element the recorded row returned. That row's body runs a second time, untemplated,
and the call site stops templating for good. The callbacks the abandoned attempt registered
through `mounted` and `cleanup` are dropped, so they do not fire twice; anything else the body
did happened twice, once.

The second is a row that called `h` a different number of times from the first. The values no
longer line up with the holes, so there is nothing sane to write, and it is a loud assert
naming both counts. It is an assert rather than a recovery because there is no way back: some
of the row's values belong to elements the clone does not have. Left alone this wrote onto the
wrong elements, and in one arrangement put the replay's own marker symbol into the page as
text.

## Why

25 DOM calls per row, down to 4: one `cloneNode`, one `insertBefore` for the row, and one
`createTextNode` plus one `insertBefore` for the reactive text child. Measured with
`bench/perf-lab.ts`, five invocations, medians, on this machine, on top of design 098:
creating 10,000 rows went from 111.8 ms to 105.7, appending 1,000 to 1,000 from 7.1 to 6.3,
replacing 1,000 from 11.5 to 8.4, clearing 10,000 from 20.1 to 17.3, filling a 1,000-row list
cell from 3.5 to 2.6. The two changes overlap rather than add up, because a cloned node never
passes through `h` and so skips the bookkeeping 098 removes anyway.

Turning the call site off after one break, rather than re-running every offending row, is what
bounds the cost of a body that breaks the contract. The package's own `fuzz.test.ts` has one:
its row component returns text, a pair, null or an `<li>` depending on the item. Left on, that
call site would run some bodies twice for the life of the list; turned off, it pays one double
run and then behaves exactly as it did with no templating at all.

Dropping the abandoned attempt's callbacks is the honest half of that trade. A body that runs
twice cannot be made to have run once, but `mounted` and `cleanup` are the binding's own
promises about when user code runs, and firing them twice for one live row would break them.

## What this costs

Four failure modes come with the contract. Three of them are silent:

- A tag that varies per row keeps the first row's tag.
- A prop key absent on the first row and present later is dropped.
- A child that is null on the first row makes no hole, so a value there on a later row is
  dropped.
- A different count of `h` calls is the one caught, above. In a release build, where asserts are
  stripped, a row with more `h` calls than the first writes values onto the wrong elements and a
  row with fewer throws a `TypeError` out of the template.

Two more, both inside the "same prop keys" half of the contract:

- A `$style` object, or any nested property object, whose keys differ per row. `cloneNode`
  copies the style attribute, so the first row's declarations are on every clone and a later
  row that names fewer keys keeps them. A browser behaves the same way, so this is the contract
  and not the light tree. Resetting the missing keys would cost a write per row on every list
  to rescue one that already broke the rule.
- What `h` returns under a replay is a marker, not an element, so a body may hand it to another
  `h` or return it and nothing else. Storing it, reading a property off it or mounting into it
  gets the marker. The three refusals above catch every case where that reaches the page; a body
  that keeps the marker in its own data is on its own.

A row of a list therefore no longer has the same relationship to `h` that every other mount
has: `h` under a replay is bookkeeping, not construction. That is a second path through the
one mounter (design 077), and it is the only one.

Per call site the binding holds one cloned row and one description of its holes, for as long
as the props object lives.

## What would reverse this

A way to verify the shape rather than document it, cheap enough to leave on. That is what a
build-time transform would give, and it is why the runtime does not verify:
the check belongs where the shape is known before it runs, not where it can only be compared
after the fact.

Also: a measurement showing the clone path costs more than it saves on the shapes applications
actually write. The numbers above are the row table. A component whose every attribute differs
per row writes every hole on every row and gains only the `createElement` calls.

## Amended

**The clone path runs `h`'s own refusals rather than a copy of its writing.** The cost
list above names what a cloned row cannot check. It did not name two things a cloned row stopped
checking that every other path still did, and both were the same mistake: the replay returns out
of `h` above its per-child guard, and the stamping wrote its own property and attribute branches
beside `h`'s.

- A child that is `undefined` is refused on a cloned row, in the same words as everywhere else.
  It used to render an empty gap and say nothing: `<ul><li>first</li><li></li><li></li></ul>`
  where the first row had text and the rest had `undefined`. `replayCall` now makes the same
  assert `h`'s child loop makes.
- An attribute given a plain object is refused on a cloned row. It used to write
  `title="[object Object]"` on every row after the first, while the first row asserted.

The second came out of removing the copy. `packages/dom/src/bind.ts` now holds the one
implementation of writing a `$name` property and writing a bare-name attribute; `h`'s own loop,
the hoisted template and the row stamping all call it. What the row path keeps of its own is the
saving this path is for: a value equal to the one the recorded row wrote is skipped before the
write is reached, so an attribute that is the same on every row is still written once, ever.

Neither is a new cost and neither narrows what a component may do. They put the row path back
where footguns belong: loud, and in one place.
