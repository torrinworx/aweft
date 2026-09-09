# 011: A refusal converges the document, then reports the whole refused group

Superseded by design 054: there is no server, and a refusal is reported rather than rolled
back.

## Decision

When a refusal arrives, the client rolls back to the last state the server accepted and
replays the commits the server took. This is the framework's job and not the application's
choice.

Everything refused in that window, meaning the refused commit and every commit refused
because it depended on that one, is then delivered to the application as **one event**
carrying the commits, each refusal reason, and the prior values the client already holds.

An application with no handler loses those changes and gets a warning in development.

Refused state never stays applied, and is never marked inside the document. The document
equals what the server accepted.

## Why

**Roll back and replay is the only mechanism that recovers in every case.** Measured across
four scenarios. Inverting the refused commit locally is enough when what followed was
independent, and it fails when a later commit depended on the refused one. Rolling back to the
state before the first refusal and replaying the accepted commits works in all four.

Keeping refused state applied in the document is a replica fork with a friendlier name.

**Refusals arrive as groups, not singles.** A refusal cannot reach the client faster than a
round trip, and the client keeps writing in the meantime. At thirty commits per second, a
100ms round trip puts three commits on top of a doomed one and 500ms puts fifteen. The server
refuses the structurally dependent ones as unreachable, so one event per commit would make
every application reassemble the group by hand. Delivering after convergence also means the
handler reacts against a document that is already consistent.

**Only the application knows what should happen.** A toast, a merge, or a re-issued intent
through the pattern in design 009 are all reasonable, and they differ per feature. The event
carries everything the framework knows, prior values included, which is possible precisely
because the client holds prior values locally even though they are not on the wire.

Silent loss with no hook was rejected: losing an edit with no way to notice is not acceptable.
Mandatory handling was also rejected: a prototype should not have to write refusal handling
before it has a policy worth refusing against.

## What would reverse this

Evidence from real applications that nearly every handler rebuilds the same "keep it visible
as refused, offer a retry" interface, which would justify a standard buffer in the framework.
Or a workload that needs a hook **before** rollback, to capture interface state tied to the
optimistic values, which an event delivered after convergence cannot serve.
