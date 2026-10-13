# 303: `Detached` can dismiss itself

Amends design 129 (the shared behaviours are internal).

## Decision

`Detached` takes `dismiss`, a boolean. With it, a press outside the anchor and the popup and the
Escape key both close the popup by setting `enabled` false, and Escape gives focus back to the
element that had it when the popup opened, the way `dialog.ts` does for a modal. A `canClose` on
`<mark.popup>` vetoes either. Without it, only the open cell and a scroll close the popup, as
before.

Either way, the `Popup` inside a `Detached` no longer dismisses itself. Placement is the
`Detached`'s to write.

## Why

The ui README tells an application to build a floating menu as `Detached` with a `Button` anchor.
That menu did not close on Escape or on a press elsewhere, and two applications wrote both halves
by hand, with their own focus handling. Design 129 kept `dismiss` internal and said the day
something asked for it, it was one export away. Putting it on the component is closer to that
design than exporting it: an application gets the behaviour by using the component, not by
assembling it.

The `Popup` inside closed itself on a press outside by writing `placement` to null, and the
`Detached` frame loop wrote the placement straight back on the next frame. The popup hid for one
frame and came back, and a press on the anchor to close the menu counted as outside the popup, so
the menu hid, came back, and then the anchor's own click closed it. One application's menu flashed
on every close.

Opt-in, because `Menu`, `Select` and `Tooltip` are built on `Detached` and close themselves: the
listbox behaviour closes on Escape and gives focus back to its trigger, after resetting the active
row. A second listener on the same keydown would close the popup first and leave the listbox
nothing to do.

## What it costs

One prop on `Detached`. An application that wants the old flash cannot have it.

## What would reverse it

A component built on `Detached` that wants Escape to reach the page while it is open, as the
default. Then `dismiss` would take the two halves separately, the way `dismiss.ts` already does.
