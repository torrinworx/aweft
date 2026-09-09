# 113: A popup reaches the top layer without a z-index

Amended: a popup has three places it can go and only one of them is a `PopupContext`,
so a page needs no wrapper to open one.

## Decision

`ui` writes no `z-index`, anywhere, ever.

A popup is placed in two steps. **Where it goes in the tree**: `Popup` renders nothing where it
is written and pushes its element into the render's popup registry (design 109), which
`PopupContext` renders after everything else. **How it stacks**: the popup element carries the
`popover` attribute where the host has the Popover API, and `showPopover()` puts it in the top
layer, above every stacking context on the page. Where the host does not, the fallback is DOM
order alone: last in the sink is on top.

`Detached` decides *where on the screen* with a scored solver, which is a pure function of four
rectangles and takes no DOM:

- twelve modes, eight corner and four side
- a side mode with too little room in its direction is rejected before scoring
- a corner mode scores by the area of the space it leaves, larger is better
- a side mode scores by the distance from the popup's centre to the midpoint of the anchor edge
  it faces, shorter is better
- the winner is re-measured every animation frame: a size change re-places, and a change of
  position closes the popup, on the reading that the page scrolled

`trackedMount` is how `Detached` measures children it does not own: it mounts them into a target
that only records the real nodes into an array, and the caller renders the array.

### Amended: `PopupContext` mounts the page before the sink

Both mounts use the same anchor, so the popups still land after the page. The order they run in
matters because it is the order a hydration hands out the server's marker regions: with the sink
mounted first, it took the region belonging to the first popup written beside the page, and that
popup then found none left. A page holding a `Popup` written directly under `PopupContext`
rendered and would not hydrate. `every shape of popup under a PopupContext renders, parses and
hydrates` in `packages/ui/tests/popup.test.ts` covers the six shapes, three of which used to
throw.

The sink is still taken down before the page, which is what the two mounts were for.

### Amended: a popup has a sink wherever it is written

**A popup's sink is the nearest `<dialog>` above where it was written, then the sink a
`PopupContext` gave it, then the element the page was mounted into.** The assert `a Popup needs a
PopupContext above it` goes with this, and `PopupContext` stays as the way to choose a sink on
purpose: two of them on a page still keep their popups apart, and one inside a subtree still
gathers that subtree's popups.

**The dialog comes first because a dialog's top layer swallows the pointer.** Measured in Chromium:
a `Menu` inside a `Modal`, opened and drawn at the page's own sink, has
`document.elementFromPoint` at the middle of a row answer with the `<dialog>` and not the row, so
the rows cannot be clicked at all. Put the list inside the dialog and the same point answers with
the row. The popup asks for the top layer with `popover` as it always did, so it draws above the
dialog rather than under it, and `dialogControl`'s `inert` pass no longer takes it out of the
reading order along with the rest of the page.

**The `<dialog>` is found by structure, not by whether it is showing.** Measured: a `Modal` calls `showModal()` one step after its children have mounted, so at the moment a popup
inside it picks its sink the element carries no `open` at all. A closed dialog hides its own anchor
along with the popup, so nothing is lost by not asking.

**Third, the element the page was mounted into**, which is the body of the document the popup is in
or the top of its own tree when it is in none. That is what makes `h(Select, ...)` mounted into a
bare page render and open, which is what the assert used to refuse. A page with no `PopupContext`
gets DOM order for its stacking on a host with no Popover API, which is what it already got.

The cost: a `PopupContext` written inside a `<dialog>` is now redundant rather than required, and a
page that wants its popups somewhere other than the three above still has to say so with a
`PopupContext`. What would reverse it: a host where a popover inside a modal dialog is not drawn
above it, which would make the dialog the wrong sink.

## Why

`z-index` is a number every part of an application has to agree on, and nothing enforces the
agreement. The Popover API's top layer removes the question. Falling back to DOM order rather
than to a large number keeps the property that `ui` never has an opinion about a page's stacking:
below the top layer, a page with its own stacking context can put something over a popup, and
that is the page's decision to make.

Closing on scroll rather than repositioning, because a per-frame reposition of a floating element
tracks late and reads as a lag, and a popup whose anchor has moved is usually a popup whose moment
has passed.

The solver is a pure function so the geometry is tested with no browser, exhaustively, and the
browser test is left with what only a browser has: real measurement, focus and the `popover`
attribute.

## What this costs

Two placement paths to keep working, and a page without the Popover API can have a popup covered
by a later sibling's stacking context. That is the named cost of refusing z-index.

## What would reverse this

CSS anchor positioning reaching the browsers the applications on this stack support, which would
move the solver into CSS and leave `ui` with the fallback only.
