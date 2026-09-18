# 295: A room's frame says what it holds

Amends design 280 (the room on the page). Asked for by an application whose accessibility
audit reported every page with a `Room` on it.

## Decision

`Room` takes `label`, a few words saying what the frame holds, and writes it as the frame's
`title`. A room given no label, a blank one, or one that is not text is refused as its mounter
runs, before the tail is claimed or anything is made, with the reason `malformed` and the fix
naming the prop. The `iframe` runner gains an optional `title` and writes the attribute when
given one; a runner made without it writes none, as before. Two surfaces change: `RoomProps`
gains a required `label`, `FrameOptions` an optional `title`.

## Why

The build refuses an `<iframe>` an application writes without a `title` (`frame-needs-title`),
because a frame with no name is an element no one can read. The frame `Room` makes had none,
so every page with a room in it failed the same audit the build enforces for hand-written
markup, and the application could not add one: the props of `Room` go to the element the
frame fills, not to the frame. One rule for both frames, and the name a screen reader reads
is the application's to give, since only it knows what the room shows.

## What it costs

Every `Room` gains a required prop; the recipe and the tests here carry one. An application
picks the words once per room, which is what it does for a `Modal` or a `Button`.

## What would reverse it

A frame whose title the room could set from inside, from the act it shows, once the act is
up. That would name the frame after the fact and leave it nameless until then, which is the
gap the audit reports; it would also hand naming to the untrusted side.
