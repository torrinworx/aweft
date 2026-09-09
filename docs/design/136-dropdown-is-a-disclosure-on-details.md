# 136: `DropDown` is a disclosure on a native `<details>`

## Decision

`DropDown` is a `<details>` whose `<summary>` wears the `button` theme and whose content is the
children, in the page's flow. It does not float.

The platform gives the summary everything a disclosure control needs: Space and Enter toggle it, it
has the `button` role, and it announces whether it is expanded. Nothing here writes `aria-expanded`,
`role` or a key handler, because writing any of them would be writing over what the element already
says.

**`open` is a cell, two ways.** The cell writes the element's `open` attribute, and the element's own
`toggle` event writes the cell. So an application can open it from elsewhere and can watch a person
open it, with one cell and no second state.

**Props.** `label` is the text on the summary. `icon` is an icon beside the label. `iconOpen` and
`iconClose` are the chevrons: `iconOpen` shows while it is open and `iconClose` while it is closed,
defaulting to `Icon` `chevron-up` and `chevron-down`. `arrow` is `left` or `right`, the side the
chevron sits on, `right` by default. `type` is the summary's button variant. `disabled` takes the
pointer and the keyboard away from the summary. `theme` appends segments and `element` hands in a
`<details>` to decorate.

## Why

An earlier sketch had this component down as a `Button` plus a popup, in one line. The measurement
is what decided the shape. Counted across the five applications: three uses, all of them
identical, and none of them floats. Each is a header button carrying a `label`, an `open` cell and
two chevrons, with the content rendered under the button in the page's flow. That is a disclosure,
which the platform has an element for.

A floating menu under a button is `Detached` with a `Button` anchor, which this package already
ships and which needs no new component. Building `DropDown` as the floating one would have been a
second way to do what `Detached` does, and no measured use for it.

`<details>` rather than a `<div>` with `aria-expanded`: the same reasoning as design 128. The
keyboard, the role and the expanded state come with the element, and the summary is a real button to
a screen reader without anybody writing that down.

## What this costs

The open and close animation is the host's, which today means there is none. A page that wants one
writes it against `[open]` in its own theme.

A disclosure whose content should sit over the page rather than push it down is not this
component. That is `Detached`, and the day an application needs a themed floating menu it composes
the two.

## What would reverse this

An application at migration needing a floating menu under a button. That is `Detached` with a
`Button` anchor and a `<mark.popup>`, so even then this component does not change.

## Evidence

`packages/ui/tests/composites.test.ts` finds the summary by its `button` role and its accessible name,
asserts the cell writes the `open` attribute, and fires a `toggle` on the element and asserts the cell
followed. `packages/ui/tests/browser.test.ts` presses a real Space on the summary in Chromium and
reads the cell.
