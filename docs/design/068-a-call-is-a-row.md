# 068: A call across the boundary is a row in the calls document

## Decision

A call from either end is a row in the `calls` document: an entry keyed by a call id whose
fields are `from` (`host` or `room`), `to` (a granted name, a loaded module's name, or the
other end itself as `sandbox` or `host`), `method`, `args` as JSON text, and, once answered,
`result` as JSON text or `error` as `{ reason, message }`. The end the row is addressed to
watches the document, answers rows addressed to it, and the end that wrote the row deletes
it once it has read the answer.

Both directions are the one mechanism. A room's granted import writes rows to the host; the
host's `load(names)` hands back stubs whose functions write rows to the room, answered by
the loaded instance there. `load`, `unload` and `loaded` from the host are rows addressed to
`sandbox`; `follow`'s `applied` and `failed` are rows addressed to `host`.

Only data crosses. Before a row is written, the arguments are walked: a function, a symbol,
an observable, a `Uint8Array`, or an object that is not a plain object or array is refused
with reason `not-data`, naming the path to it. A result is walked the same way at the
answering end. What crosses is what `JSON.parse(JSON.stringify(x))` would give.

A call the host does not answer within `limits.callMs` on a runner that takes one errors
with reason `timeout`; the room keeps running, and stopping it is `stop()`.

## Why

A row in a document beats a second protocol beside the link, because it uses what is already
there. A link carries commits and nothing else, and an intent that goes into a document as
state, answered by whoever holds wider authority, is design 009's pattern. It is also why a
room on another machine needs nothing new: documents already travel.

Deleting an answered row keeps the document small; a document that kept every call ever
made would grow without bound, and history is the store's job when the application stores
this document.

JSON text, rather than nested observables, because a document slot holds a primitive or an
observable (core refuses a plain nested object with `inline-container`), and because the
walk that refuses a function is the same check that makes the text.

## What it costs

One commit round trip per call: measured at p50 1.2 ms over process IPC through a 1 ms poll,
so a call is not free and a chatty interface across the
boundary is a design smell the application will feel. Binary data crosses as text (an
application encodes it). A call cannot stream; a long result is one row.

## What would reverse this

A measured workload where the round trip dominates and no batching at the application level
helps. The answer then is a second protocol beside the link, which is a new design note.
