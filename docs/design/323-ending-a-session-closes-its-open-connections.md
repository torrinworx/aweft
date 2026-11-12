# 323: Ending a session closes its open connections

Amends design 074 (the auth battery) and design 185 (identity is fixed for a connection's
life), which together left a socket holding its user after the session behind it ended.

## Decision

**`auth/Session` takes the `connection` hook.** The module is public, so the gate lets the
hook run for every socket. For a connection whose context carries a session it keeps that
connection's `close` beside the session, and returns the ending that forgets it. An anonymous
connection is never kept.

**`revoke(token)` closes every connection kept for that session**, after the document is
written. `revokeAll(user, except)` closes the connections of every session it ends and leaves
the kept session's alone. So a password change drops the person's other devices, a reset or a
confirmed take-over (design 321) drops all of them, and `DELETE /api/session` drops the
sockets of the session that asked.

**The hook reads the session once more after it has kept the connection.** A session can end
between the handshake that identified the socket and the hook that keeps it; a connection
whose session is no longer live by then is closed at once.

Nothing changes on the wire and nothing in `@aweftjs/server`: `close` is what a `connection`
hook was already handed.

## Why

Identity is fixed at the handshake, and `revoke` only wrote the stored document. A page left
open by whoever held the old password went on reading and writing as the user after a reset,
for as long as its socket lived, which with a healthy network is until the tab closes. The
person who reset their password because someone else was in their account had not put them
out.

Closing the socket rather than changing who it is: every hook, share and offer on a
connection was made for the user the handshake named, and there is no way to take those back
one by one. A closed socket is the one state every module already handles, and the client
comes back by itself, anonymous, because the cookie now names a dead session.

In the battery rather than in the server: the server does not know what a session is, and the
hook hands a module everything this needs.

The kept connections are one set, read through on every revoke, rather than a table by
session: a set has nothing left in it for a session whose connections have all ended, so
nothing grows with the number of sessions ever seen.

## What this costs

One read of the session document per signed-in socket, beside the one the handshake made.
A revoke walks every signed-in connection this process holds.

A page that signs out has its socket closed by the server a moment before its own reconnect.
The client's reconnect drops whatever socket it holds and opens one, so the page still ends
on one anonymous connection; a client with reconnecting on may open one extra socket between
the two, which the next replaces.

**Only this process's connections are closed.** Two processes over one store (two versions
during a deploy) each keep their own. A session revoked through one stays connected on the
other until that socket closes for another reason. A session that reaches the end of its
lifetime is not closed either: nothing calls `revoke` for it.

## Evidence

`packages/auth/tests/integration.test.ts`, `ending a session closes its open connections, and
only those`: one person's sessions, another person and a visitor over the real server through
the `loadServer` harness; `revoke` closes both sockets of its session and no other,
`revokeAll(user, keep)` leaves the kept session connected, `revokeAll(user)` closes the rest,
and the other person and the visitor stay open until the other person signs out.
`session.test.ts` checks that an ended connection is forgotten (a later revoke does not call
its `close`), that an anonymous one is never kept, and that a session revoked before the hook
ran is closed by the hook. `client.test.ts`, `signing out in one tab drops the other tab of the
same session`, runs two clients with reconnecting on: the second comes back anonymous with
nothing called on it, and no socket is opened after both have settled.

## What would reverse this

A deployment that runs several processes for long, not for the minute of a deploy. Then the
closing has to cross processes: each process follows the session documents it holds
connections for, through the store, and closes on the write rather than on the call.
