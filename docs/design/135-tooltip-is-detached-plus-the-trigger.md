# 135: `Tooltip` is `Detached` plus the trigger behaviour

Amended: the panel is inside the box the solver placed and wears no `popover` of its own. Amended
again: a `Tooltip` needs no `PopupContext` above it, because a popup has a sink wherever it is
written (design 113). A tip inside a `<dialog>` goes in that dialog, so it draws above the modal
instead of being made `inert` with the page behind it.

## Decision

`Tooltip` is two things this package already has, put together: `Detached` places the panel, and
`tooltipTrigger` (design 129) decides when it shows. It adds no placement code and no timer of its
own.

**Props.** `label` is the text, a value or a cell. The children are the anchor. An optional
`<mark.popup>` replaces the label with markup, for a tip that is more than a line of words.
`enabled` is the open state: given a cell, hover and focus write it and an application can drive it;
given none, the component keeps its own. `locations` is the placements to try, and it defaults to the
four side modes, `below`, `above`, `right` and `left`, because a tip belongs beside the thing it
describes rather than hanging off its corner. `type` is the theme variant and `theme` appends
segments.

**No delay prop.** The pause before a hover shows it is the behaviour's, and it is the same pause
everywhere. A page with two tooltips that wait different amounts of time is a page that feels broken,
and the one number is already in `tooltip-trigger.ts`.

**The panel is `role="tooltip"` and the anchor names it.** The panel's id comes off the render's
counter, so a server and its hydration mint the same one, and every element node in the anchor
carries `aria-describedby` naming it. That is what makes the tip readable by a screen reader rather
than a thing only a pointer can find.

**The panel is inside the box `Detached` placed, and wears no `popover` of its own.** The box is
already a popover, and a popover inside a popover is promoted to the top layer and laid out by the
browser's own popover positioning, so the panel leaves the box the solver placed and lands where the
host puts a popover with no anchor. Measured in Chromium on a plain mounted page at 1280 by 720,
with the anchor at 88,88: the box at 122,109 and 14 by 14, the panel at 587,345, the middle of the
screen. Every `Tooltip` on a real page showed its tip there. So `Tooltip` hands no `panel` to
`tooltipTrigger`: the box asks for the top layer with `popover="manual"`, as design 113 says a popup
does, and the panel stays inside it. `tooltipTrigger` keeps its `panel` option and its
`popover="hint"` behaviour for a caller whose panel is a bare element with no box around it.

**The anchor's nodes are tracked, not wrapped.** `trackedMount` (the export `Detached` already uses)
hands back the real nodes the anchor rendered to, and those are what `tooltipTrigger` listens on and
what `aria-describedby` is written on. The alternative was wrapping the children in an element of this
component's own, which would put a `<span>` in the middle of a caller's layout for no reason the
caller asked for.

**`aria-describedby` is written when the page comes alive, not in the markup.** The anchor's nodes
belong to the caller, so this component decorates them after they exist rather than building them
with the attribute on. A static render therefore writes the anchor and the panel with no link between
them, and the link appears on the first mount. That is the one thing here that a server page does not
carry, and it costs nothing, because a tooltip needs a pointer or a keyboard and both mean the page is
alive. The attribute is taken off again when the component unmounts, so an `element` a caller reuses
goes back the way it came.

## Why

A tooltip is in the catalogue, which holds what an application needs and nothing beside it.
Measured across the five applications: no page uses one today, so nothing constrains the shape and
the cheapest honest one wins.

Hover and focus both, and Escape, are the behaviour's, tested once in `internal.tooltip.test.ts`.
The top layer comes from the box's `popover="manual"`, which is what design 113 already says a
popup does. The hint type is what `tooltipTrigger` asks for on a bare panel, and a hint does not
close a menu that is already open; a tip in a box gives that up, because a panel that carries a
`popover` inside a popover is not placed at all.

## What this costs

**A `Tooltip` does not hydrate**, because `Detached` does not. Measured on the base commit
`e1c2fdd`: a `Detached` whose anchor holds anything but one fully static node fails a hydration,
because the anchor is mounted into the recorder `trackedMount` hands it and that array is still
empty while the pairing walk is at the region. A static render writes the anchor and the panel
correctly; taking that markup over is what fails. It is `dom`'s to answer. Nothing reaches it in
practice: a tip needs a pointer or a keyboard.

**A `Tooltip` also cannot sit inside an act a stage swaps away**, for a third reason: an act holding
a `Detached` leaves the stage unable to render the act after it. Measured on the base commit too.
Put the tip beside the stage rather than inside it, which is what the catalogue does:
`recipes/ui/examples/tooltip.example.tsx` holds no stage at all, and the stage is in the modal's
example beside it.

A tooltip that should also open on a click is not this component. `Detached` with a `Button`
anchor is, and it is one call.

A tip on a page that never comes alive is a panel nothing points at. See above: it is the price of
not wrapping the caller's anchor in an element of ours.

## What would reverse this

An application needing a tip that stays open while the pointer is on the tip itself, so a link
inside it can be clicked. That is a change to the trigger behaviour, in `tooltip-trigger.ts`, and
every component that uses it gets it.

## Evidence

`packages/ui/tests/composites.test.ts` finds the panel by its `tooltip` role, asserts the anchor's
`aria-describedby` names it, drives the `enabled` cell and reads the panel's state, and asserts the
attribute is gone after an unmount. `packages/ui/tests/browser.test.ts` hovers for real and waits out
the delay, focuses for real and sees it at once, and in Chromium asserts the panel's rectangle is
inside the box's, the box's is against one side of the anchor's, `document.elementFromPoint` at the
panel's centre is the panel, and the panel carries no `popover`. `recipes/ui/main.ts` reads
`popover="manual"` off the box and nothing off the panel. Handing the panel back to
`tooltipTrigger` puts the box back at 14 by 14 and the panel back at 587,345, and both browser cases
fail.
