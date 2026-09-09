# 210: `TextField` takes `leading` and `trailing`

Amends design 200: `InputGroup` is withdrawn and its entries become parts of `input`.

## Decision

**`TextField` takes `leading` and `trailing`, and renders the box only when it was given one.**
With neither, the markup is what it was: an `<input>` on the `input` entry, inside a `<div>` on
`field` when the field was given a `label`, a `description` or an `error`. With either, the input
goes on `input_group_control` inside a `<div>` on `input_group` carrying the border, the radius,
the fill and the height, and the addons go beside it.

**`InputGroup` goes**, with `packages/ui/src/input-group.tsx`.

**Its entries become parts of `input`**: `inputgroup` is `input_group`, `inputgroup_control` is
`input_group_control`, `inputgroup_addon` is `input_group_addon`, and the size and invalid
modifiers follow (`input_group_sm`, `input_group_lg`, `input_group_invalid`), each still reaching
the plain input's own rules through `extends` the way `inputgroup_sm` did.

**The ring is on the box**, through the `:has(:focus-visible)` rule the `inputgroup` entry already
carried, so tabbing into the input rings the whole control. That rule moves with the entry and does
not change.

**Text is wrapped and everything else is mounted as it is.** A `leading` or `trailing` that is a
string or a number goes inside a `<span>` on `input_group_addon`; anything else is already
something to mount, which is what lets an `Icon` or a `Button` of `size="icon"` go there.

## Why

`InputGroup` was `TextField` with two extra props and a copy of its body: the same cell handling,
the same `wireField` call, the same Enter handling, the same `starting` value, written twice
(design 200 says as much in its own comment). Nobody used it: outside the catalogue nothing in this
repo reached for it, and no page written with the package did either, while every one of them used
`TextField`.

Two components with one job is the thing "one way per job" refuses. Folding the addons into
`TextField` costs one branch and deletes a file, and a caller who wants a currency field no longer
has to know that the component for it is called something else.

**Why the branch and not the box always.** A `<div>` around every text field would change the markup
of every page that has one, take the border off the input and put it on a box, and make the
selector an application already wrote against the input wrong. The branch is the compatibility: with
neither addon, nothing about the element or its entry moves.

**Why the entries are renamed.** Design 193 says a part is one class token, and `input_group` reads
as a part of `input` where `inputgroup` read as an entry of its own. The rename is what says the box
belongs to the text field now.

## Evidence

`packages/ui/tests/controls.test.ts`: a `TextField` with neither addon renders the same element,
with the same entry chain, that it rendered before; one with `leading` renders the box, the addon
span and the control entry; one with `trailing` the same the other way round; one with both renders
two addons in order; text becomes a span and an element is mounted as it is; the size and the
invalid segments land on the box rather than on the input; and the label, description and error
wiring is the same in both shapes.

`packages/ui/tests/look.test.ts`: the six renamed entries compile from names only, `input_group_sm`
and `input_group_lg` still reach `input_sm` and `input_lg` through `extends`, and the box's
`:has(:focus-visible)` rule is in the sheet.

`packages/ui/tests/browser.test.ts`, measured in Chromium: focusing the input inside a `TextField`
with an addon puts a non-`none` `box-shadow` on the box and none on the input.

`recipes/ui/main.ts`: the catalogue's `TextField` example gains the addon cases the `InputGroup`
example had, and the ring-on-the-box assertion is kept against the new markup.

The suite pins both branches: the box is not rendered where neither addon was given, and the input
inside the box is on `input_group_control` rather than on `input`.

## What this costs

A page that imported `InputGroup` no longer compiles, and one that wrote `theme="inputgroup"` or
matched the class it generated no longer matches. There are none in this repo outside the
catalogue and the tests.

`TextField` has two shapes of markup rather than one, which is a branch a reader has to know about.
It is written where the node is built and the README says it in one sentence.

## What would reverse this

An addon set rich enough to need props of its own, a segmented control inside the box, say. Then
the box is a component again and it is a different component from this one.
