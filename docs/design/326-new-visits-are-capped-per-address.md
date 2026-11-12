# 326: New visits are capped per address

Amends design 261.

## Decision

`logs/Visits` gains **`visitsPerAddressPerMinute`**, 60 with nothing set. A batch for a visit
the module does not hold counts against the address it came from as well as against
`visitsPerMinute`, the total. Over either, the batch is refused as `capped`, which the route
answers 429, and nothing is stored.

The address is the `address` on the request's context, read by its shape the way `user` and
`session` are, so this package still imports no gate. `auth/Session` puts the listener's peer
address there. A context with no address is counted against the total alone, as before this
cap: it shares no key with other such contexts.

The total is read first and counted last:

1. If the total has no room, the batch is refused and the address is not counted.
2. The address is counted, when the context carries one. Over its cap, the batch is refused
   and the total is not counted.
3. The total is counted.

So an address past its own cap takes nothing more from the total, and the map of addresses
gains a key only for a visit the total had room for: at most `visitsPerMinute` new keys a
minute. The map is swept of passed minutes the way the other two counters are.

A batch for a visit already held counts against neither, as before. The address is a key in
memory for a minute. It is never written to a visit, an entry or the store.

A value that is not a number above zero is refused at load with `invalid-config`.

## Why

Design 261 left a cap by address to the application, because a route is handed a context and
never the peer. The auth battery's context has carried the address since, so the battery can
count by it without reading a forwarding header itself.

Without it, one address could open visit after visit up to the total, 600 a minute, each a
stored document kept 30 days, and while it did so nobody else's visit was admitted.

60 is a tenth of the total, so it takes ten addresses to fill it. A person starts a visit when
a page loads, a few a minute at most. A visit also counts as new when its document was let go:
after `idleMs` with no batch, or after the server restarted. So 60 is every tab of a few dozen
people behind one address coming back in the same minute. A batch refused here is dropped by
the page, and the next one is admitted in the next minute.

## What this costs

One counter per address that started a visit this minute.

People behind one address share one cap. A deployment behind a proxy sets `forwarded` on the
listener, or every visit is the proxy's address and the cap is 60 new visits a minute for
everyone.

Under a gate that puts no address in its context, `open` included, this cap does nothing, and
one address can still fill the total. One shared key for those contexts would have made the cap
a second total of 60 below the first for every application whose gate carries no address. Such
an application puts the address in its context to have the cap.

An address counted in step 2 that was admitted keeps that count even when the store then fails
the write.

## Evidence

`packages/logs/tests/visits.test.ts`: the new visit over the cap from one address is refused
as `capped` and stores nothing, while another address is admitted; a batch for a held visit is
not counted; an address past its cap takes nothing from the total; a full total counts nothing
against an address; a context with no address is bounded by the total alone; the next minute
admits again; a
bad value is refused at load. `packages/logs/tests/record.test.ts`: over the route under the
auth gate, the peer's address is the one counted, the answer is 429 with `capped`, and another
peer is admitted.

## What would reverse this

A measured deployment where ordinary people behind one address pass 60 new visits a minute,
which raises the number. Every gate in use carrying an address, which would let a context
without one share a single key, as a request with no peer address does.
