# 273: The listener bounds a body and a frame unless told not to, and reads the proxy's own entry

Amends design 072.

## Decision

`node()` bounds a WebSocket message and an HTTP body at 1 MiB (1 048 576 bytes) when
`maxPayload` is not given. `maxPayload: Infinity` removes the bound, and is the one way to.

`forwarded: true` reads the peer address from the last entry of `x-forwarded-for`, the one the
proxy in front appended, and the scheme from `x-forwarded-proto`. `forwarded: 'x-real-ip'`
reads the address from that header instead, for a proxy that sets it. Off, both come from the
socket.

## Why

Design 072 shipped `maxPayload` with no value, and every server built on the scaffold since had
no bound at all: a body of any size on a public route, read to its end. The bound is a default
an application widens in one word, and 1 MiB holds every request the stack's own routes take by
a wide margin.

The first entry of `x-forwarded-for` is what the client itself sent, when it sent one, because
a proxy appends its view of the client to the header the client gave it. Under the earlier
reading, a client behind a trusted proxy named its own address, which is the address the limits
of design 272 count by. The last entry is the one proxy's word, which is what "a proxy you
trust" means. Behind two, the operator configures the outer one to replace the header, or names
the one header its proxy writes.

## What this costs

A route that takes a large upload sets `maxPayload` itself, and the refusal at 413 names the
option. A deployment behind two appending proxies reads the inner proxy's address until it is
configured; that was not safer before, only differently wrong.

## Evidence

`packages/server/tests/node.test.ts`: a body and a frame of 1 MiB plus one byte are refused
with no option set, `Infinity` lets them through, the last forwarded entry is the address and
the first is not, and `x-real-ip` is read when named.

## What would reverse this

A runtime whose socket bound cannot be set, or a deployment shape where the proxy's entry is not
last, which would want a count of trusted hops.
