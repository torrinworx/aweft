# 282: The route across the wall

Amends designs 121, 122 and 123. The router keeps one history path and the tail keeps one
claimant; what changes is that where the URL and its entries live may be handed in, that a
component which is not a stage may claim a tail, and that an act key may end in a bare `*`,
which parks the whole path as the tail and takes no parameter.

## Decision

**The room's stage owns the tail under the host act, and nothing above it.** The host act on
the page matches `app/:id`, and what the URL holds past that is the act's tail (design 123);
the room's stage runs over that tail as if it were the whole URL, with `''` as its index. A
room can never move the page outside its tail.

**A bare `*` act key parks the whole path as its tail.** The room's stage keys the act on `*`,
and the act's own nested stage routes on what the room's URL holds, so what the room's URL
holds is the tail a stage under the act claims, and `taken`, which is what a child's acts sit
under, stops before the `*`. The `*` takes no parameter, and an act is rebuilt on a parameter
change and not on a tail change (design 123), so a move inside the room changes the nested
stage's act and leaves the room's act, and its component state, where they were. A `*name`
still takes every segment left as its parameter and leaves no tail, as design 122 says; an act
that wants the rest as a value keys on `*name`, and one that wants a stage under it keys on
`*`. Under design 122 as first written there was no key that both matched every path and left
a tail, so the room's stage could not route.

**A `route` document crosses the wall.** `createSandbox` shares it under the reserved name
`route` when `page` is given, with `page.route` as the host's copy, and the far end answers it
on `enter` as `route`. It is flat:

```ts
interface RouteDocument {
	url: string;                          // the tail showing now, a path starting with `/`
	key: string;                          // the page's history entry key for it
	move: 'push' | 'replace' | 'back';    // how the room's last write is applied
	seq: number;                          // counts the room's writes
}
```

The host writes `url` and `key` whenever the page's entry changes under the act, so back and
forward on the page reach the room the same way a room push does: as a commit on the document.
`url` is the tail with the page's query and hash on it, because a routing tree has one query
cell and the room's stage is under it: a room that writes its `query` replaces the page's, and
the page's query reaches the room. The host writes after the page's router has settled, in a
microtask, because the router writes its key and then its URL and a write between the two
would send the room the old path under the new key; it applies a room move from a microtask
too, because a cell written during a delivery reads as it was until the delivery settles, and
the key recorded after a push made inside one was the key of the entry the push left.
The room writes `url`, `move` and `seq` in one `atomic` block to push or replace, and `move`
and `seq` to go back. `seq` counts up on every room write, because a slot written with the
value it already holds is not a commit (measured: two writes of one value deliver once), and
the room pushes the URL it is already showing whenever a stage takes a history entry for an
open (design 124).

**The host applies a room write as a page navigation.** A `push` or `replace` of `url`
becomes the same on the page's router at the host act's own prefix plus `url`. A `back` is
honoured only when the entry showing now is one the host pushed on the room's behalf; the
host keeps those keys, and otherwise the write is a no-op, so a room cannot walk the page
back past where it was mounted. One back at a time: once a back is honoured, every further back
is dropped until the router's key has moved off the entry it left. In a browser the key moves
on `popstate`, a later task, so two backs in one burst (a `close` called twice) would both see
the entry the first is leaving and the second would pop the page's own entry under the act.

**A `url` outside the tail is refused where it is written.** A path is a string starting with
`/`, not with `//` or `/\`, whose segments before any `?` or `#` are none of `.`, `..` or a
percent-encoded spelling of either, because the browser resolves those against the prefix and
`/app/3/../../x` would leave the tail. It is at most 8192 characters, because a history entry
is not where a room keeps its data, and it holds no control character (below 0x20, or 0x7f),
because the browser strips those from a URL it is handed and the router's cell would then
disagree with the address bar. The room's entries object refuses such a `url` before it
writes, and the host's share of `route` carries an `accept` that refuses any room commit
writing `key`, writing a `url` that is not such a path, or writing a `move` outside the three.
The second is what holds against a room that is not running this package's far end.

**`@aweftjs/dom/router` gains `createRouter({ entries })`.** `Entries` is exported as a type:
`current()`, `state()`, `push(state, href)`, `replace(state, href)`, `back()` and
`listen(fn)`, which is the half of the router's internal seam that is about where the URL and
its entries live. With `entries` given, clicks, scroll and storage still come from the window
when there is one and from memory otherwise; the window's history is never touched. An anchor
click under such a router is resolved against the entries' own current URL rather than the
window's location, because an opaque frame's location is `about:srcdoc`, which no path resolves
against, and a link inside a room means a path in the room. The room's router is this over an
entries object that reads and writes the route document and keeps, by the page key the host
answers with, the entry state it stamped.

**`ui` exports `claimTail(context)`.** A component that is a routed child without being a
stage claims exactly what a nested `StageContext` claims: the parent stage's tail, once,
released on unmount. It answers the tail cell, `base` (the path the parent's acts sit under
plus what the parent matched, as `StageEntry.prefix` spells it, read on each ask because the
parent's match can change), the tree's router or null, and `release`. It answers null when
there is no stage above or the tail is already claimed, which is what a second `StageContext`
under one act gets (design 123). `Room` is the first such component.

**`StageContext` gains `loader`.** A platform that already holds the loader the modules are in
hands it over instead of `sources`. Everything design 242 says still holds: one loader per
routing tree, a nested stage inherits it, and a stage that names both `sources` and `loader`
is a loud assert. A stage handed a loader does not unload the loader's modules when it is
removed, because the loader belongs to whoever built it; it lets go of the act it was showing,
as a nested stage does. It reads no `entries` off an act module either, because a loader does
not say what sources it was built over; the static walk goes through `sources`.

## Why

Inside an opaque-origin frame `history.pushState` and `sessionStorage` throw `SecurityError`
and `location.href` is `about:srcdoc` (measured). `createRouter()` sees a `window` and would
take the browser path, so a router in the room has to be fed across the wall, and the only
thing that crosses a link is a document.

A document rather than calls for the route, because a route is state the other end cares
about, not an intent: the page's entry changes under the act and the room follows, the room
moves and the page follows, and both are reads of one object. Calls would be a second protocol
for the one thing a document already does.

Handing in the entries half of the seam rather than the whole `Host`, because scroll, storage
and clicks are the frame's own and work in it; only the history does not. Design 121 said the
seam would become an option when a second history implementation was worth shipping, and a
document across a wall is that implementation.

A claim function on `ui` rather than a stage inside `Room`, because `Room` renders a frame,
not acts, and a stage with no acts would exist only to hold the tail. What `Room` needs is
exactly the claim, and the claim is already the mechanism.

## What it costs

A same-URL push from the room costs a commit that changes only `seq`. The host writes `key`
back on every move, so each room navigation is two commits across the wall.

`url` is written from both ends, so the host must tell its own write from the room's. It does
so by watching `seq`, which only the room writes.

A room's `back` after the page navigated on its own is silently a no-op. The alternative,
letting a room pop any entry, would let it walk the page off the act. A `Room` under no stage,
or under a stage with no router, has no page history at all: the room's pushes move nothing on
the page, and its `back` goes nowhere, while its own URL cell still moves, so the act's screens
still change.

## What would reverse this

An application whose room must own a query or a hash on the page's URL rather than a path
tail, or one that needs two routed regions under one host act. The first widens the document;
the second is design 123's own reversal condition.
