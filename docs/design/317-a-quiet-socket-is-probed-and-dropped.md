# 317: A quiet socket is probed while something waits, and dropped when the probe goes unanswered

Designs 073 (requests ride the socket as text) and 184 (a reconnect re-shares the same document)
are unchanged; this adds the one thing a browser cannot do on its own: notice a socket that died
without closing.

## Decision

`requests` answers a request named `''` itself, with `null`, before any answerer runs. A module
name is never empty, so the name is free, and an older end with no such rule still answers it
`missing`, which is an answer all the same. Nothing on the wire changes: it is an ordinary request
frame.

`createClient` takes `quiet`, in milliseconds, 10 000 by default, `false` for off. While the open
socket has an ask in flight or a share whose document has not arrived, and nothing at all has
arrived on the socket for `quiet`, the client sends that probe with a `quiet` timeout. Any message
counts as heard. When the probe times out, the client treats the socket as dropped: every ask in
flight on it rejects with `closed`, every share is re-shared on the next socket (design 184), and
a new socket is made at once. A socket that nothing is waiting on is never probed. The ask that
made the wait hears `closed` one to two `quiet` periods after it was made: one when the socket
was already silent, two when something had just arrived. `reconnect()` and `close()` also end the
old socket's asks at once instead of waiting for its close event.

The logs battery's page half records a `waiting` entry once for an ask in flight longer than 5 s,
and once for a share whose document has not arrived after 5 s, at the next flush tick and in the
last batch a leaving page sends, so a visit that hangs shows what it hung on even when the answer
never comes and no `ask` entry is ever written.

## Why

Measured on a production application: a page on cafe Wi-Fi sat on a skeleton
until reloaded. A TCP proxy that stops forwarding without closing reproduces it against the stack
as it was: an ask made after the freeze had no answer after 60 s, `status` still read `open`, and
a later ask waited too. A browser exposes no WebSocket ping, and a server's ping frames
(`heartbeatMs` on the node listener) only free the server's end. The TCP stack takes minutes to
call such a connection dead, and while it does not, nothing reaches the page.

Probing only while something waits keeps an idle tab silent, so it costs a server nothing for the
tabs nobody is looking at. A probe that rides the request channel needs no frame of its own and no
change to `spec/`, and works against a server that predates it.

10 s is one policy, chosen rather than derived: past the answer time of almost every call
that application makes (p95 under 400 ms on the server), and short enough that a stuck page
recovers in about 20 s.

## What this costs

A server whose event loop is blocked for longer than `quiet` while a page waits on it is taken for
dead: the page's asks reject `closed` and it reconnects. That server was already failing its pages.
An application with calls that legitimately hold the event loop that long raises `quiet` or turns
it off.

An answer that takes longer than about `quiet` to arrive whole looks like silence, because a
message counts as heard only once all of it has come: a very large result on a slow link is cut
off and its ask rejects `closed`.

A page that asked something and then lost its socket hears `closed` on that ask, not an answer;
the ask is not sent again, because the stack cannot know an ask is safe to repeat.

## What would reverse this

A transport that tells the page about a dead connection on its own. WebTransport would; WebSocket
does not.
