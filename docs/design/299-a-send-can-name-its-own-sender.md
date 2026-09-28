# 299: A send can name its own sender

Amends design 268 (the notify battery). Asked for by an application that sends sign-in mail from
one address and a newsletter from another, in one process.

## Decision

`send` takes an optional `from`, a string, which reaches the email channel only, beside `html` and
`replyTo`. The mail a sender is handed carries it as `from` when the send named one. The Resend
adapter posts it in place of the configured `from`; a send without one goes out from the
configured address as before. A `from` that is not a string is `invalid-notification`, like
`replyTo`.

## Why

The configured `from` is one address per process. An application with two kinds of mail, such as
account mail from `hello@` and a weekly issue from `weekly@`, had two ways out: a second process,
or an `email` function of its own that switches the address on something smuggled through another
field. The address is a property of the one mail, the same as `replyTo`, and Resend takes it per
request.

## What it costs

One more optional field on `SendOptions` and on `Mail`. An application's own `email` function now
sees `from` when a send names one and has to decide what to do with it. The battery does not check
that the address belongs to a verified domain; the provider refuses one that does not, and the
refusal lands in the delivery record like any other.

## What would reverse it

A provider the battery ships that cannot take a sender per mail. Then `from` would be refused for
that adapter at send time rather than silently dropped.
