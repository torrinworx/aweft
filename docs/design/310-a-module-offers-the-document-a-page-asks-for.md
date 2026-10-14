# 310: A module offers the document a page asks for

Amends design 072 (a connection and its hooks) and design 053 (a link). Design 184 (the client comes
back after a drop) needs no change for it.

## Decision

**A server module may declare `offer(name, context)`.** When a page shares a name that no share on
its connection is waiting for, the server asks each loaded module that declares `offer`, in load
order, behind the gate, once every `connection` hook on that connection has run. A module the gate
refuses is skipped.

- `undefined` declines, and the next module is asked.
- `{ document, accept, refused?, fault? }` is the offer. The server shares `document` under that
  name on that connection with those handlers, which is the share a `connection` hook would make,
  `no-accept` rule included. The walk stops.
- A throw that carries a `reason` refuses. The page's share ends with that reason and message, and
  its `ready` rejects with them. The walk stops.
- Any other throw, `no-accept` included, is reported to `handlers.failed` under the module's name,
  and the page's share ends with `failed`. The walk stops.
- When every module declines, or the gate skips them all, nothing is sent. The page's share waits,
  as it always has, so a share that a `call` or a later hook makes still pairs with it.

A module is asked once for each share the page makes that is still waiting when its turn comes. A
second share of a name the page is already waiting on takes the first one's place. The offered
document's `fault` hears the end of the share: `left` when the page stops it, `closed` when the
connection ends. An offer that arrives after the page stopped that share, or after a newer share of
the same name replaced it, is not shared, and its `fault` hears `left`. After the connection ended,
it hears `closed`.

**`@aweftjs/sync` gets the seam this needs.** `connect(channel, { unshared })` calls
`unshared(request)` when an `open` arrives that nothing here pairs with, a name this end does not
share or a second share of a name already live, once for each topic the other end opens. The link
holds that open, as it always has, so a share made later pairs with it. `request.name` is the name.
`request.held()` says whether the link still holds that open unpaired. `request.refuse(reason,
message)` answers it with `fault`, naming the other end's number for the topic, and stops holding
it. A `leave` for a topic the link holds unpaired now drops the held open too. It is still answered
with `no-topic`, as before. A share whose document is not an observable throws before the link keeps
the topic. It used to throw after, and the topic it left paired with the next `open` of the name and
threw again inside the frame, which an offer made of a module's mistake would reach.

**The client is unchanged.** It shares every handle again on every new socket (design 184), so a
page's share asks again after a reconnect, and the module offers the document on the new connection.
A handle whose share was refused is shared again too, so a page that signs in, which reconnects, is
asked again.

## Why

Two applications wrote the same four parts by hand, four times. A `connection` hook keeps the
connection's link in a map keyed by its context. A `call` opens the document and shares it on that
link. The page shares the name and then asks for it. And on every reconnect the page asks again,
because the new connection offers nothing. One application forgot the last part, and a dropped
socket lost every edit until a reload. With the hook, the page's share is the ask. The client
already shares again after a drop, so asking again comes free.

**Nothing on the wire changes.** The page sends `open`, as it does today for any share. An offer
answers with `open` and `state`, as any share does. A refusal is a `fault` naming the page's number
for the topic. `spec/replication.md` section 2 already says that a `fault` answering a frame names
the topic by the number that frame carried, and section 4 that a `fault` naming a topic ends it. The
spec does not close the list of reasons a fault may carry. `unwanted-state` (design 269) is a reason
the spec does not name either. The frame is the shape of `spec/frames/008-fault-topic.json`.

**Declining waits rather than refusing,** because a page may share a name before the `call` that
shares it runs. One application does exactly that. If a decline ended the share, that page would
break the day any module of its application declared `offer`. For the same reason the gate skipping
a module refuses nothing: an anonymous page sharing a name a later `call` shares would be refused by
a private module that never meant to offer it.

**After the hooks,** because a `connection` hook may share the same name, and a hook is async. An
offer made first would leave the hook's share unpaired. A call is answered after the hooks for the
same reason (design 072).

**`held()`,** because an offer is async and the page can stop its share, or share the name again,
while a module is still opening the document. A share made for an open the link no longer holds
pairs with nothing. It keeps every commit it makes, waiting for an `open` that never comes.

## What this costs

Two of the link's changes reach every application, offer or not, and change frames in two cases. A
page that leaves a share before the server shares the name: the server's later share used to pair
with the topic the page had left, send it `open` and `state`, and get `no-topic` back. Now it sends
its own `open` and waits. A share of a value that is not an observable: it used to leave a topic
that threw out of the next frame naming that name, uncaught. Now the throw is the share's own and
nothing is left. Both are cases where the old behaviour was already broken, and a page that works
today sends neither.

One more hook on a module, and one more option on `connect`. A module is asked once per share, so a
page that shares one name again after the first was answered is offered it again. A slow offer holds
the page's share until it answers. No `observe` event says a document was offered: adding a kind to
`ServerEvent` would break an application's exhaustive `switch` over the kinds at the type level. A
refused share's `fix` does not cross, because a `fault` carries a reason and a message and nothing
else.

## Evidence

`packages/sync/tests/unshared.test.ts` holds an open, refuses it, pairs a later share with it, drops
it on `leave`, asks once per topic when the other end sends a second `open` for the same topic,
which a client sharing a held document again does, and leaves nothing behind for a share of
something that is not an observable. `packages/server/tests/offer.test.ts` drives a connection:
offered, declined then offered by the next module, refused with the page's `ready` rejecting with
the reason, a throw reported and answered `failed`, an offer of something that is not an observable
answered `failed` and offered again on the next share, a gate that skips a module, the walk waiting
for the hooks, a module that declines leaving a later `call`'s share to pair, a page that stops
before the offer arrives, and an application with no `offer` sending nothing it did not send before.
`packages/client/tests/offer.test.ts` drops the page's socket: the module is asked again on the new
one, and the page's document object is the one it held. It also refuses a share and offers it after
a reconnect, as a sign-in would. `recipes/full-stack` does the same in Chromium across the reconnect
a sign-in makes.

## What would reverse this

A wire format that names a refusal frame of its own. An application that needs one name offered by a
table rather than asked of each module, which would make the hook a map of name prefixes.
