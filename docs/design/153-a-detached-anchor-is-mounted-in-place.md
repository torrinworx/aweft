# 153: A `Detached` anchor is mounted in place and measured by walking its siblings

Amended: the sink a popup mounts into is the nearest `<dialog>` above it, then a `PopupContext`,
then the page itself (design 113). Every mechanism here is unchanged and now covers three sinks
rather than one: the popup still renders nothing where it was written, so the empty text node is
still what ends the anchor's run, and it is needed in more places rather than fewer, because a
`Detached` written directly in the element the page was mounted into has its own popup as a sibling
there too.

## The defect

`Detached`, and so `Tooltip`, could not take over server markup, and an act holding one left its
stage unable to render the act after it. Both were known and diagnosed; both are settled here, and
the diagnosis was only half right.

`Detached` mounted its anchor into the recorder `trackedMount` hands it. That recorder is a target
of its own and `dom` knows no hydration scope for it, so the anchor's nodes were made fresh whatever
mode the page was in, and the array holding them was mounted where the anchor belonged. Under a
static render the queue drains before the page is serialized, so the array is full by then and the
markup is right. Under a hydration the array is still empty when the pairing walk reaches its
region, and the nodes arrive a delivery later against markup that describes a different shape.
Measured on this tree before the change, with a `<button onClick>` anchor:

```
threw: dom: hydration mismatch: the server markup ran out where a <button> was expected
```

The stage failure is not the recorder at all, and not `Detached`'s. A plain `Popup` in an act does
it too. `PopupContext` mounts the page and the popups against one anchor, so an act mounted after
a swap landed behind the popups, and the sink's list then took it for one of its own as the popup
left. Traced on this tree: the act's `<p>` was inserted, then removed again by the list taking its
record out.

```
before: <div aria-live="polite" ...></div><button id="anchor">?</button><div style="display: none;">...
after : <div aria-live="polite" ...></div>
```

A third thing: a hydrated popup never reached the top layer.
`Popup` and `Tooltip` each keep the element they built, and a hydration keeps the server's element
and drops that one, so `togglePopover`, the outside-click test and the size measurement were all
being done on a node nobody could see.

## Decision

**`Detached` mounts its anchor where the anchor belongs, and reads the anchor's nodes by walking
siblings.** It is a mounter now, as `Popup` and `PopupContext` already are, so it has the element,
the anchor and the mount context in hand. It makes three mounts under that element: the anchor's
items, the `Popup` (which renders nothing where it is written), and one empty text node anchored on
the `Popup`'s mount. The anchor's nodes are whatever sits between the first mount's `getFirst` and
that text node. `measure` walks them on the frame it already takes and skips anything with no
`getBoundingClientRect`, so the markers and the text between them cost nothing, and an anchor that
changes is measured as it is now rather than as it was when the component mounted.

**An empty text node is what makes a run finite.** Ending a walk at the anchor a component was given
is wrong: the popup sink mounts into the same element as the page, so a `Detached` written last
under a `PopupContext` has the popup itself as its next sibling, and the walk would measure the
union of the anchor and the popup it is placing. `''` renders to no characters, so it is in no
markup, and a hydration inserts it rather than pairing it (design 146), so it is in the document in
all three modes. Anchoring it on the `Popup`'s mount is what puts it directly after the anchor in
all three: under a render and a mount the `Popup` contributes no node and the text lands where the
anchor ends, and under a hydration the `Popup`'s mount answers with its region's opening marker,
which is the server's own node directly after the anchor.

**The anchor's items are anchored on that text node, not on the component's own anchor.** An anchor
that renders nothing then answers `getFirst` with the text node, and its run is empty rather than
running off the end of the element.

**`PopupContext` gives the page an end of its own, the same way.** The page's mount is anchored on
an empty text node that sits between the page and the popups, so anything the page renders long
after the first mount still lands in front of them. That is what makes a stage able to swap an act
that held a popup.

**`Tooltip` reads its anchor the same way**, one level out. It hands the anchor's items straight to
`Detached`, mounts its own end marker first so everything else stays in front of it, and takes the
element nodes of the run between the two. Those are what design 135 says `aria-describedby` is
written on and what the trigger listens on.

**`aria-describedby` is not written by a static render.** Design 135 already says the link appears
on the first live mount; the code wrote it in both, and markup carrying it cannot be taken over,
because nothing on the client can put it on the fresh element before the pairing walk compares the
two. `render.ts` marks a render object as static behind a symbol and `Tooltip` asks.

**A component reads the element it drives out of its own mount.** `Popup` puts a mounter in the sink
rather than the node, and takes the first element of what that mount put in the document; `Tooltip`
does the same for its panel. Under a mount and a static render that is the element the component
built; under a hydration it is the server's. `props.ref` reports that element, so `Detached`
measures the popup that is on the page.

**`Popup` hands the `popover` attribute to `dom` rather than writing it.** A host with no Popover API
writes no attribute, so markup from one and a browser that has it disagree, and a reactive attribute
is the one kind a pairing walk tolerates that from (design 133).

**`trackedMount` is unchanged and still exported**, because the popup design (design 113) keeps the
scored placement solver and `trackedMount` as they are. Nothing in the package uses it now.

## Why

The recorder was the only thing in this package that mounted into a target `dom` had no hydration
scope for, and the hydration failure came from that one fact. Mounting in place removes the
special case rather than teaching `dom` about it: the anchor is an ordinary mount, so its nodes
are adopted, its listeners live (design 133), and it asks for no region the server did not write.
Walking siblings is what replaces the recorder's array, and it costs a walk of a handful of nodes
on a frame that was already being taken to measure a rectangle.

Two mounts sharing one anchor is the shape behind both of the other failures. Where two runs end
at the same place, a node added to the first later lands in the second, and neither `dom` nor this
package can tell them apart. A node of one's own is the cheapest boundary that exists in all three
modes.

## What this costs

**One empty text node per `Detached`, per `Tooltip` and per `PopupContext`.** They are in no markup,
they have no layout, and CSS cannot see them: adjacent sibling selectors and `:last-child` count
elements. They are in `childNodes`, so a caller counting the children of the element one of these is
written in sees them.

**A tip on a page that never comes alive has no `aria-describedby`.** That is what design 135 already
said, and the static render now matches it.

**The anchor's nodes are read from the document rather than recorded as they mount.** A node the
anchor puts somewhere other than where it was written is not in the run and is not measured. Nothing
in the package does that, and the recorder could not have seen it either.

**`Tooltip` writes `aria-describedby` on the element nodes of the run.** An anchor that is only text
gets no link and no listeners. The recorder's array had the same nodes in it and the same was true
of it: text has no rectangle to place against.

## What would reverse this

`dom` giving a mount a way to ask for the nodes it put in the document. Then the walks, the empty
text nodes and the mounter wrappers all go, and each of these reads its mount directly.

## Evidence

`packages/ui/tests/popup.test.ts`: the reproduction as a test, with the adopted anchor compared
against the parsed node by identity and a click dispatched on it; a two-element anchor with text
between measured as the union; an anchor a cell swaps re-measured on the next frame; a `Detached`
last under a `PopupContext` measuring the anchor alone; and an act opened over one that held a popup.
`packages/ui/tests/composites.test.ts`: `Tooltip` is in `everything()` and the hydration count is
re-derived by hand, and a stage whose act holds a `Tooltip` renders the act opened after it.
`packages/ui/tests/browser.test.ts`: a server-rendered page with a `Tooltip` is hydrated in
Chromium, hovered for real, and the box is placed against the rectangle of the node the server sent,
with the panel inside the box (design 135). The catalogue shows the two apart
(`recipes/ui/examples/modal.example.tsx` and `recipes/ui/examples/tooltip.example.tsx`); the stage
holding a `Detached` is checked in the two suites above rather than on a page.
