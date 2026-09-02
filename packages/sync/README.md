# @aweftjs/sync

Replication: moving commits between documents over any channel.

Three layers, and you take as many as you want. The bottom one is a hundred lines of your
own code away from any transport that exists; the top one is what a collaborative
application actually needs, and it costs you five lines.

| | what it is | reach for it when |
|---|---|---|
| `track` | one document's commits out, and commits in, with echo suppression | you have your own protocol and just need the document's changes |
| `encodeFrame` / `decodeFrame` | this protocol, as bytes | you are writing a transport |
| `connect` / `serve` | sequencing, optimistic writes, rollback, resume, authority | you are building an application |

## The whole of a transport

A channel is four functions. Nothing in that type knows about a socket:

```ts
interface Channel {
	send(frame: Frame): void;
	receive(fn: (frame: Frame) => void): () => void;
	closed(fn: () => void): () => void;
	close(): void;
}
```

`inProcess()`, `fromWebSocket(socket)` and `fromMessagePort(port)` ship. Anything else is
yours, and it is the same size: put `encodeFrame(frame)` on the wire, hand `decodeFrame(bytes)`
back. `examples/sync/main.ts` writes one over a TCP socket in about forty lines and runs the
whole scenario over it, beside the two shipped ones, to make the point that they are not
special.

Delivery is always asynchronous, on every channel including the in-process one. That is not
politeness: applying a commit from inside a watcher hands it to the receiving document's
watchers after the outer watcher has already returned, so a link that delivered synchronously
would work in one process and break on a socket.

## Quickstart

```ts
import { REST, type Policy } from '@aweftjs/schema';
import { connect, fromWebSocket, serve } from '@aweftjs/sync';

// The host. It owns the document and decides every commit.
const policy: Policy = [{ effect: 'allow', path: ['tasks', REST] }];
const host = serve((name) => (name === 'board' ? { document: board, policy } : undefined));

wss.on('connection', (socket, actor) => host.accept(fromWebSocket(socket), actor));
```

```ts
// A client. Opening the socket is yours, which is what makes reconnecting yours too.
const session = connect(() => fromWebSocket(new WebSocket(url)));

const replica = session.join<Board>('board');
const board = await replica.ready;

board.tasks.add(createObject({ title: 'write it up' }));  // applies here, and goes
```

`join` with no document builds one from what the host sends. Hand one in
(`join('board', { document })`) when you already have it; it must share the host's root id,
and it is synced in place rather than replaced.

## What a client sees

```ts
session.connected   // Derived<boolean>
replica.state       // 'joining' | 'live' | 'lost' | 'left' | 'failed'
replica.pending     // Derived<number>, commits the host has not decided
replica.flush()     // put what is queued on the link now, rather than at the end of the tick
replica.leave()     // stop this document; the link stays up for the others
```

One session carries as many documents as you join. Each gets a topic number when it joins,
and the name you wrote rides on the join frame and nowhere else.

## Writes are optimistic, and a refusal converges before it reports

A local change applies at once and is sent. Until the host decides it, this side is showing
state the host has not agreed to. When the host refuses one, the client rolls back, replays
what survives, and only then hands the refusal to you:

```ts
session.join('board', {
	document: board,
	refused: (group) => {
		for (const { commit, undo, reasons } of group) {
			toast(`${reasons[0].code}: ${reasons[0].message}`);
		}
	},
});
```

They arrive as a group because refusals do. A refusal cannot come back faster than a round
trip, and whatever was written on top of a doomed commit in the meantime goes with it. `undo`
carries the values the slots held before, which this side still has even though prior values
never cross the link. Without a handler they are lost and a line goes to the console.

The document always equals what the host said plus the local commits that still apply on top
of it. One mechanism keeps that true everywhere: undo the pending commits newest first, apply
what arrived, redo them oldest first. A commit that cannot be redone is one the host would
refuse for the same cause, so it is reported without waiting for the round trip.

**That rebase reaches your watchers as several commits, not one.** Undoing three pending
commits and redoing them is seven deliveries, and three of them show a document with your own
just-typed work missing from it. The end state is right and nothing is lost, but a renderer
that animates a removal will animate three removals that never happened. Repaint on a frame
rather than on a commit, or read `replica.pending` and hold the paint while it is above zero.
It is worst after a reconnect that needed the whole document; an ordinary arriving commit with
nothing pending is one delivery and does not rebase at all.

## Authority is not optional, and you have to type it

A topic states who may write it:

```ts
serve(() => ({ document, policy }));              // checked against @aweftjs/schema
serve(() => ({ document, policy: 'trusted' }));   // no check at all, and you said so
```

An authenticated client is not an authorized one, so there is no default. `'trusted'` is for
a link with no untrusted party on it, such as one in the same process. On a checked topic one
path reaches the document and it does validate, apply, record in that order; nothing else can
get an authority index out of step with the document it describes.

**The host builds and keeps that index for you.** Hand it a document you built by mutating and
it says the document as one commit to start the index off, then folds in every commit it
accepts. There is nothing to wire and nothing to do before you call `serve`.

**One document has one authority.** Resolving the same document with a different policy for a
different actor is refused with `policy-mismatch`, because otherwise whichever join arrived
first would decide what everyone after it may write. Serve two documents, or write one policy
that covers both actors. Syncing one document twice on one link is refused the same way, as
`document-in-use`: every commit on one topic would be published to the other and back again.

A host lets go of a document once nothing is joined to it and no remembered session can come
back to it, so a `resolve` that opens a document per name does not grow for as long as the
process runs.

### Ownership is shape, not data

A policy reads paths and never reads values, so "only the person who added this may remove it"
cannot be a field on the item. It is where the item lives:

```ts
// items/<who>/<item>, the owner level an object so the key is yours, the item level a map so
// each item is keyed by its own id.
{ effect: 'allow', path: ['items', SELF, REST] },        // your own bucket, entirely
{ effect: 'allow', path: ['items', ANY, ANY, 'done'] },  // anyone may tick anything
```

`SELF` is compared against `actor.id` exactly as written, and a map slot is named by an id in
text form, so the owner level cannot be a map keyed by a name. Put the elements one actor owns
under a step only that actor matches, and the rule falls out.

The actor comes from the connection, never from a message: `host.accept(channel, actor)` is
where you say who authenticated. A commit is never sent back to whoever made it.

A refusal refuses the commit and never the link. A join that is turned away is an answer, not
a violation, and the link carries on for whatever else is on it. Only a frame that makes no
sense ends one.

## Reconnecting, and what it costs

`connect` takes a function that makes a channel, so it can make another one. It backs off
from 100ms to 30 seconds by default; `retry` replaces that and returning `false` stops it.

The host mints a session id and remembers, per client, how far it had got. On the way back in
the client replays exactly what did not land. If the gap is inside the host's window of recent
commits (256 by default) it is sent what it missed; otherwise it is sent the whole document as
one commit and works out the difference itself, so **the document you are holding is never
swapped for another one**. A watcher on it sees an ordinary change.

A verdict that was in flight when the link dropped is lost: the host remembers how far it got,
not what it decided. The document is still made right on the way back in.

If a replica ever ends up disagreeing with the host about something neither can talk its way
out of, it asks for the whole document. If that does not settle it after a few tries the
replica goes `failed` with the reason `resync-loop`, rather than asking forever: a client in a
loop starves the machine it runs on, and saying so is the only useful thing left to do.

## Two documents in one process

```ts
const editing = mirror(stored);
await Promise.resolve();
(editing.document as Board).title = 'draft';   // reaches `stored`
editing.stop();
```

The same engine, with both ends in one heap and no authority check. In step at the end of the
tick, not the end of the statement.

## Just the commits

If none of the above is what you want, take the bottom layer and wire it to anything:

```ts
const tracker = track(doc, ({ commit, undo, landed }) => {
	if (!landed) myTransport.write(encodeCommit(commit));
});
myTransport.onData((bytes) => tracker.receive(decodeCommit(bytes)));
tracker.stop();
```

`landed` is false for a commit this document made and true for the one `receive` was handed.
Telling them apart is the part that is easy to get wrong: a flag held across the apply does
not work, because delivery is deferred and a watcher that writes in answer to an arriving
commit produces its commit inside the same drain. `track` counts instead. `receive` must not
be called from inside a watcher, which is why every channel here delivers on a microtask.

`asCommit(doc)` says a whole document as one commit, and `reconcile(doc, target)` is the
commit that moves one document to what a snapshot says. Both are public because both are
useful on their own: `record(index, asCommit(doc))` is how a document built by mutation is
fed to an authority index.

## Boundaries

This package knows about commits, channels and authority. It does not know about the DOM, and
it does not know how anything is stored: a host's window of recent commits is bookkeeping, not
a history, and a client that falls outside it is sent the document.

Deliberately not here: application messages. A connection carries commits and nothing else. An
intent that is not a state change goes into the document as state and a server-side handler
with wider authority reads it and writes the outcome, which is design 009's model and means
one enforcement mechanism rather than two.

The reasoning is in `docs/design/` designs 040 to 046, the wire shapes in
`spec/replication.md`, and a program using all of the above over three transports in
`examples/sync/`.
