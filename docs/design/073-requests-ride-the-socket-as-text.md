# 073: Requests ride the same socket as text frames, and the link still carries commits only

## Decision

`sync` gains `requests(socket)`: a two-ended helper over the same `SocketLike` that
`fromWebSocket` takes. Either end may `ask(name, args, { progress, timeout })` and either may
`answer(fn)`, where `fn(name, args, progress)` returns the result and calls `progress(value)`
as often as it likes before that.

A request is one text message carrying JSON: `{ id, name, args }`. The answer is `{ id,
result }`, each progress report is `{ id, progress }`, and a failure is `{ id, error }` with
`error` as `{ reason, message, reasons? }`. `undefined` crosses as `null`. Ids are the asker's
own counter: a frame carrying `name` is a request and one carrying `result`, `progress` or
`error` is an answer, so the two ends never read each other's ids and cannot collide.

The link's frames are binary messages and the request frames are text, told apart by the
WebSocket's own text-or-binary bit. `fromWebSocket` already ignores a text message
(`packages/sync/src/channel.ts`), and `requests` ignores a binary one, so the two share a
socket with no framing of our own and no change to the replication protocol: a link still
carries commits and nothing else (design 042). `SocketLike.send` now accepts a
string beside bytes, which every WebSocket already does.

At the asking end, `timeout` rejects with `timeout` after that many milliseconds and no
value ships; the socket closing rejects every ask still waiting with `closed`; an answer
nothing asked for is dropped. At the answering end, one answerer is registered at a time and
registering a second throws; a request that arrives with none registered is answered
`missing`; a text message that is not a request frame closes the socket, as bytes that are
not a frame end the link. `stop()` stops asking and answering and leaves the socket alone,
because the socket belongs to whoever opened it.

`sandbox` keeps its call rows (design 068): a room's channel may be a process's stdin and
stdout, which have no text bit, and a call row already works over any channel.

## Why

Reusing the sandbox's call rows for a client asking a server is the wrong fit; a helper built
to send and return requests is what that job needs. The source settles where the helper goes:
the socket adapter drops any message that is not binary, so text frames beside the link cost
nothing and change nothing. Measured: a link runs unchanged over a `ws` server socket and
Node's built-in client with text messages on the same socket.

In `sync` rather than a new package, because it rides on `SocketLike`, which is `sync`'s, and
a package for a hundred lines would be a package for a hundred lines.

## What it costs

A transport with no text bit (a raw stream, a message port) cannot carry requests this way;
it carries rows, as the sandbox does. A `progress` report after the answer is dropped.

## What would reverse this

A measured need to carry requests over a transport with no text bit at the server. That
would be a framing of our own, and a new design note.

## Amended

- **One request channel per socket.** A second `requests(socket)` on a socket that has one
  throws `duplicate` until the first has stopped or the socket has ended. Two would each
  number their asks from 1 and each answer every request, so the second's asks resolved with
  the first's answers and every request ran twice.
- **Bytes that are not a frame close the transport**, not only the link: `fromWebSocket` and
  `fromMessagePort` close the socket or port whose bytes would not decode. A transport left
  open under a dead link is one the other end keeps writing to, with nothing to tell it.
- A progress report after the result is dropped at the answering end as well as ignored at
  the asking end, and the test looks at the wire, because a test that watches only the asking
  end cannot tell whether the answering end dropped it.
