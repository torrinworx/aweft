# 053: A link has two equal ends

Supersedes designs 011, 012, 043 and 045; re-scopes 042 and 044.

## Decision

`sync` moves commits between documents over a channel and decides nothing about them. Both
ends of a link run the same code. There is no host, no client, no session, no rollback
engine and no policy in the package.

- `connect(channel)` makes a link. `share(name, document)` shares a document under a name;
  when both ends have shared the same name the topic is live. `share(name)` with no document
  mints one from the other end's root and asks for its state.
- Each end numbers the topics it opens. A frame names a topic by the sender's number, so
  one link carries many documents and a name never rides on a commit frame.
- An arriving commit is handed to the application's `accept` before it applies. The default
  accepts everything. Applying it goes through `track`, so nothing is echoed back.
- A commit is the only thing a link carries. Commits made in one tick travel in
  one frame.
- A new channel is a new link. Nothing resumes: reconnecting is the application's, as
  opening the socket already was, and it re-shares what it wants shared.

Unchanged: `track`, the three channel adapters, the frame codec's shape, `asCommit`,
`reconcile` and `rootFrom`. `mirror` is a link over an in-process pair.

## Why

The transmission layer is serverless and clientless: any piece of software running the stack
can define or hook into a network, and each node enforces its own rules for reads and writes.
Designs 043 and 045 put an authoritative host and an optimistic client inside the package,
which nothing asked for; they traced to one sentence of design 011 that assumed a server. The
two capabilities that presupposed a host, authority on the stream and rollback with replay,
were 1,148 of the package's 2,070 lines and produced most of the findings against it.

A symmetric link is also what makes several networks on one document compose (design 055):
a node in the middle of a chain is just an end of two links holding one document.

## What it costs

Convergence under conflicting writes is the application's arrangement, not the link's. Two
ends that replace the same slot at the same moment end up swapped until one of them yields
(design 054). Concurrent inserts do not collide (040). An application that wants one node to
decide builds a star and has that node refuse what it does not accept.

A commit of this end's own that the other end refused is reported, not rolled back: the
application decides whether to yield.

## What would reverse this

A need for an authoritative topology in the library. It would then be a package above
`sync`, which is where `server` already sits in the build order, and never inside it.
