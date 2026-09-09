# 137: `FileDrop` is a native file input inside a drop zone

Amended by design 214: an entry carries a `reason` code, the limit is written in KB, MB or GB, the
prompt names what is accepted, and `FileDrop.Button` is a picker of its own outside a zone.

## Decision

`FileDrop` is a `<div>` that takes a drop, with a real `<input type="file">` inside it. The input is
what opens the file dialog, what the keyboard reaches, and what a form sees.

**The input is visually hidden, not `display: none`.** A hidden input is not focusable, and an input
nobody can focus is a picker only a mouse can use. So it is taken off the page with the size and clip
trick and left in the focus order, and its label is the zone's prompt.

**Props.** `files` is a `mutableArray`, a state prop: given one it is written, given none the
component keeps its own. `extensions` is a list of MIME types (`image/png`, `image/*`) or dotted
extensions (`.csv`), written to the input's `accept` and used to refuse a dropped file, because a
drop does not go through `accept` at all. `multiple` defaults true; false keeps one file and replaces
the one before it. `limit` is the largest file in bytes, with no limit when it is omitted.
`clickable` defaults true, so a click anywhere on the zone opens the dialog. `disabled` takes both
away. `onDrop(files)` is called with the accepted platform `File`s after they have been added.
`ready` is a cell the component writes. `type` is the theme variant, `theme` appends segments,
`element` hands in the zone `<div>`, and children replace the default chrome.

**An entry is `{ name, file, status, error }`.** `status` starts as `ready` for a file the zone
accepted and `error` for one it refused, and `error` says why. The application moves `status` to
`loading` while it uploads and back when it lands, which is the upload transport this package never
decides. `file` is the platform `File`, so an application uploads it however it likes.

**A status change is an edit to the list.** An entry is a plain object, and a list hears an index
assignment and not a property written on something it holds. So an application reports a status by
writing the entry back, `files[0] = { ...files[0], status: 'loading' }`, which is one line and is the
edit `ready` and the listing both follow. The alternative was an entry whose every field is a cell,
which every application would then have to unwrap to read a name.

**A refused file is in the list with its reason.** Wrong extension, over `limit`, or a second file
while `multiple` is false: each lands as an entry whose `status` is `error`. A file that disappears
silently reads as a broken drop zone, and the person has no way to find out which of the eight files
they dragged was the wrong one.

**`ready` follows the statuses.** It is written `null` while any entry is `loading`. Otherwise it is
the one entry's `file` when `multiple` is false, and the array of `file`s when it is true, counting
every entry that is not in `error`. So a page waits on one cell rather than watching the list.

**`FileDrop.Button` opens the dialog.** It is a `Button`, for use inside the children, and it reaches
the input through a context the zone provides internally. That context is not exported: it is how the
two halves of one component find each other, not API. A `FileDrop.Button` outside a `FileDrop` is an
assert naming the fix.

**Drag is counted, not flagged.** The `dragging` theme segment goes on while a counter is above zero,
incremented on `dragenter` and decremented on `dragleave`. A flag flickers off the moment the pointer
crosses onto a child of the zone, because the child fires its own `dragleave` at the zone.

## Why

This package never decides the upload transport. Measured across the five applications: five uses,
passing `files`, `extensions`, `multiple`, `loader`, `clickable` and `onClick`; every page
replaces the default chrome with its own children; three render a button inside those children
that opens the dialog. Every page reads an entry as `{ name, file, status }` and takes `file` to
upload it itself. No page passes `ready` or reads a `result`.

So the shape is what those uses need and nothing beyond it. `ready` ships because it is what a
page that does not want to watch the array asks for, and it is one cell.

`loader` and `onClick` are not props here. A page that wants its own chrome writes it as children,
and a spinner in that chrome is the page's own component; `onClick` is what `FileDrop.Button` and
`clickable` already do.

## What this costs

There is no upload here, and there never will be one: no progress, no retry, no destination. This
package decides no storage and no transport, and that is why `status` is the application's to
move.

`extensions` is checked by name and by MIME type, which is what the browser hands over. It is not a
check of what is actually in the file. A page that must know reads the bytes itself.

## What would reverse this

An application needing a directory drop, or a paste. Both are more listeners on the same zone
rather than another component.

## Evidence

`packages/ui/tests/filedrop.test.ts` accepts a file, refuses one by extension, refuses one over
`limit`, replaces the previous file when `multiple` is false, follows `ready` through a status change,
asserts `FileDrop.Button` calls `click()` on the input and that one outside a zone asserts, and drives
the drag counter with a `dragenter` on the zone and a `dragleave` on a child.
`packages/ui/tests/browser.test.ts` sets a real file on the input in Chromium and reads the entry back
out of `files`.
