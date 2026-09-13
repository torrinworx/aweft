# 278: Named documents cross the link

Amends design 066. The three fixed documents still cross and nothing crosses unasked; what
changes is that the application may name documents of its own, and each one crosses under
its name.

## Decision

`createSandbox` gains `documents: Readonly<Record<string, object>>`. Each entry is shared on
the room's link under its key (`link.share(name, document)`), writable from both ends, with no
handler of the package's own on it. The room control document lists their names in
`documents`, so the far end can refuse a name the host did not share the moment it is asked
for rather than by waiting for an `open` that never comes.

**Reserved names.** `modules`, `room`, `calls` and `route` are the package's own topics. A
key in `documents` with one of those names is refused with `reserved` when the sandbox is
made. A value that is not an observable (from `createObject`, `createArray` or `createMap`) is
refused with `malformed`, the way `modules` is checked; any observable kind will do, because
a list is a document too and the link shares every kind.

**The far end's `share(name)`.** `enter` (design 277) answers with `share`: for a name in the
control document's `documents` it is `link.share(name)` on the room's link, one handle per
name for the room's life, so two modules asking for one name hold one document object. For
any other name it throws `not-shared` at once, synchronously, with the fix naming `documents`
on `Room`. A wrong name is a mistake at the call site, not a state the room is in, so it is
raised where it is written rather than as a promise that rejects later.

**Refusing a write is the application's.** A document the application names is writable from
the room by construction. Where a room must not write, the application puts `schema`'s
`guard` (or core's `intercept`) on its own copy on the host: a room commit the guard refuses
is refused on the link, the room's copy hears the refusal and diverges, exactly as a page's
copy does against a server. Nothing here asks who wrote a commit, because the link never does
(design 053).

**The route document is not one of these.** It crosses under the reserved name `route`, only
when `page` is given, and it is design 279's.

## Why

The two applications this is for mirror a live state document into the frame both ways: the
module reads it, edits it, and the edit reaches the server through the page. One document on
two links relays both ways through the middle with one delivery per write at the far end, so
sharing the same object on the page's link to the server and on the page's link to the room
is the whole mechanism. Design 066's fourth-document clause said this would be a note of its
own, and this is that note.

Listing the names in the control document rather than letting the room discover them, because
a `share` on a link for a name the other end never offers waits forever, and a module that
asks for a document by the wrong name should fail where the name is written.

Writable both ways with no package rule, because the rule an application wants (a participant
may edit their own layer and nothing else; a plugin may write a draft and never the published
copy) is a shape rule, and `schema` already runs shape rules on every commit whatever its
source.

## What it costs

A document the application shares is fully readable inside the room, whatever it holds. What
a room must not see is not shared, or is shared as a projection the application builds.

The room's copy of a refused write stays applied on the room's side, as with `modules` and
`room` (design 066). A module that needs to know its write was refused watches the handle's
`refused`, as on a page.

## What would reverse this

An application that needs a document readable in the room but never writable, where a guard
on the host is not enough because the room's own copy must refuse the write too. That would be
a `readOnly` mark on the entry, a widening of this note.
