# 329: A send can carry mail headers

Amends design 268 (the notify battery) and design 299. Asked for by an application whose
newsletter must carry `List-Unsubscribe` and `List-Unsubscribe-Post` (RFC 2369, RFC 8058).

## Decision

`send` takes an optional `headers`, a plain object of header name to string value, which reaches
the email channel only, beside `html`, `replyTo` and `from`. The mail a sender is handed carries it
as `headers` when the send named one. The Resend adapter posts it as Resend's `headers` field. A
`headers` that is not a plain object, a name that is not an RFC 5322 field name, or a value that is
not a string or holds a carriage return or line feed is `invalid-notification`.

## Why

A list mail needs the one-click unsubscribe headers: Gmail and Yahoo ask bulk senders for them,
and a mail client's own Unsubscribe button posts to the address they name. Only a POST
unsubscribes, so a company's link scanner, which opens every link in a mail, cannot unsubscribe a
reader by following the footer link. The headers belong to the one mail, the same as `from`, and
differ per recipient because each carries that reader's token. Without this the application had
to post to Resend itself and lose the battery's caps, timeout and delivery record.

## What it costs

One more optional field on `SendOptions` and on `Mail`. The battery does not list which headers
are allowed: the provider refuses one it will not set (Resend sets `From`, `To` and the like
itself), and the refusal lands in the delivery record. A line break in a value is refused at the
send, because a value read from a user could otherwise add a header of its own on a provider that
writes them raw.

## What would reverse it

A provider the battery ships that cannot take headers per mail. Then `headers` would be refused for
that adapter at send time rather than silently dropped.
