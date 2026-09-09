# 012: A refusal refuses the commit, never the connection

Superseded by design 054, which keeps the rule that a refusal never closes the link.

## Decision

The server refuses the offending commit, keeps the connection, and keeps judging later commits
on their own merits. Structurally dependent ones fail as unreachable; independent ones apply.

Disconnection is never the protocol's answer to a policy refusal. A server may still drop a
connection for a protocol violation, meaning a frame or commit that does not parse, and a
deployment may rate-limit a client that accumulates refusals. Both sit outside refusal
semantics.

## Why

A well-behaved client produces refusals through ordinary races, and cannot learn of one faster
than a round trip, during which it keeps writing. Disconnecting on refusal turns every race
into a reconnect and a full resynchronization, which is the most expensive path in the system,
taken at the moment the client is busiest.

Identifying a refused commit by its position also depends on the ordered channel staying up.
Closing the connection on every refusal would push the resume handshake into the common path.

One refused commit does not tell a hostile client from a developer's policy mistake. From the
server's side they look identical. Guessing hostile wrongly breaks a working application.
Guessing benign wrongly costs one refused commit. Refusing per commit is the recoverable
error, so it is the right default.

## What would reverse this

A measured attack or bug class where continuing to process a refusing client's stream costs
the server more than reconnect storms would cost well-behaved clients. Even then the answer
is a throttle with backpressure inside the protocol, not a disconnect.
