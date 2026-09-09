# 184: A reconnect re-shares the same document, and the server wins

The link's rules (designs 053, 054 and 055) are unchanged; this is what a client does with them.

## Decision

A `share` handle holds one document object for its whole life. When the socket drops and a new one
opens, the client makes a new link and re-shares every live handle's object on it, then calls the
link's `resync()`, so the server's state is applied to that object in place. The page's watchers
see the reconnect as ordinary commits. Nothing the page holds is replaced.

Edits made while there was no socket are not kept: the resync moves the document to what the
server holds. The `closed` fault a dead link raises on every topic is the client's to handle and
is not passed to the handle's `fault`; every other fault is, including a `root-mismatch` after a
reconnect, which means the server now holds a different document under that name and the page has
to hear so.

The client reconnects on its own. After a drop it retries after 500 ms, doubling to a 10 s cap, and
resets when a socket opens. Where the globals exist, it also retries at once when the browser fires
`online` or the document becomes visible, and lets go of those listeners on `close()`.
`reconnect()` drops the socket and opens a new one now; `reconnect: false` on the options turns the
automatic retry off, the two triggers with it, and leaves `reconnect()` to the application.

## Why

A scoreboard page rebuilt its whole subtree on every reconnect,
because a new link with nothing to hand in mints a new document and the old one is dead. Read from
`sync`: `share(name, document)` on a new link pairs with the server's copy by root id, and
`resync()` reconciles the held object to the server's state without swapping it, so the document
can survive the socket with no change to the link.

The server wins because the alternative is the commit-log client this stack deleted: keeping
what was typed offline and replaying it needs a per-client sequence in the envelope and a rollback
engine, which is a later step if a migration needs it. A drop on a page is seconds long; the
window where an edit is lost is that long too, and the page hears `status` go to `closed`.

The backoff numbers are one policy, chosen rather than derived. The `online` and visibility
triggers are there because a laptop lid is the common drop, and a timer alone would wait up to
10 s after the lid opens.

## What this costs

An edit made while `status` is `closed` disappears on reconnect. An application that must not lose
one disables the automatic reconnect, or waits for `open` before writing.

## What would reverse this

A migration that needs offline edits kept. That is the sequence-numbered envelope and a new note,
not a change to this one.
