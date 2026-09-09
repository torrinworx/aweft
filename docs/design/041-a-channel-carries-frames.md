# 041: A channel carries frames, and the byte encoding belongs to the transport

## Decision

The link between two documents is a `Channel`: `send(frame)`, `receive(fn)`, `closed(fn)`,
`close()`. It carries frames, which are values. Turning a frame into bytes is what an adapter
does when its transport needs bytes, not something the protocol does on the way in.

`encodeFrame` and `decodeFrame` are public, so a transport nobody has written yet is four
functions and a call to each.

## Why

**Measured, `bench/replicate.ts`.** Handing a frame across an in-process channel costs 0.011
us; encoding and decoding it costs 4.29 us, some four hundred times more. In-process links are
not a test convenience: they are the mirror between two live trees and the bridge to a
sandbox, and both run at mutation rates.

Over a port that structured-clones anyway the two are a wash: 3.56 us to clone a commit
against 4.12 us to encode it, clone the bytes and decode. So the byte encoding buys
nothing there either, except that it is what a socket needs, which is why `fromMessagePort`
uses it: one encoding across sandbox and server rather than two.

**It is not a second protocol.** The frame shape is the protocol and every adapter carries
the same shapes in the same order. What differs is only whether the bytes exist.

## What it costs

A frame is a mutable JavaScript object on an in-process link, shared by both sides rather
than copied. Every type in the surface is `readonly`, and both sides treat a frame as read
only, but nothing enforces it at runtime the way a copy would.

## What would reverse this

A transport that cannot host the encoder, or two independent implementations that have to
interoperate over a link that is not bytes.
