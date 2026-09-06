# @aweftjs/sync

Commits between documents over any channel. Both ends of a link run the same code, and the
link decides nothing about what it carries.

Three layers, and you take as many as you want:

| | what it is | reach for it when |
|---|---|---|
| `track` | one document's commits out, and commits in, with echo suppression | you have your own protocol and just need the document's changes |
| `encodeFrame` / `decodeFrame` | this protocol, as bytes | you are writing a transport |
| `connect` | a link: any number of documents by name, batching, and the seam where your own rules go | you are building an application |

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
back. `recipes/sync/main.ts` writes one over a TCP socket in about forty lines and runs the
whole scenario over it, beside the shipped ones, to make the point that they are not special.

Delivery is always asynchronous, on every channel including the in-process one. Applying a
commit from inside a watcher hands it to the receiving document's watchers after the outer
watcher has already returned, so a link that delivered synchronously would work in one process
and break on a socket.

## Quickstart

Both ends are the same few lines. Opening the socket is yours, at either end.

```ts
import { connect, fromWebSocket } from '@aweftjs/sync';

const link = connect(fromWebSocket(socket));
link.share('board', board);                                  // this end has the document
board.tasks.push(createObject({ title: 'write it up' }));    // applies here, and goes
```

```ts
const link = connect(fromWebSocket(new WebSocket(url)));
const shared = link.share<Board>('board');                   // this end has nothing yet
const board = await shared.ready;                            // minted from the other end's root, then its state
```

One link carries as many documents as you share on it. Each is a topic named by the string
you chose; the name rides on the `open` frame and on nothing after it.

```ts
link.share('profile', profile);
link.share('inbox', inbox);
```

If neither end holds the document, both hear `no-document` through `fault` and `ready`
rejects, rather than the two waiting on each other forever.

`link.close()` ends everything on it. Nothing resumes: a new channel is a new link, and
re-sharing on it is yours, the same way opening the socket was. If the channel ends under
the link instead (the other end went away, the socket dropped), every share on it hears
`closed` through `fault`, and a `ready` still waiting rejects with it.

## Your rules go in `accept`

An arriving commit is handed to `accept` before it applies. Return the reasons to refuse it;
an empty array accepts. The default accepts everything. The link has no idea what you check.

```ts
link.share('inbox', inbox, {
	accept: (commit) => commit.deltas.some((d) => d.type === 'remove')
		? [{ code: 'read-only', message: 'nothing is removed from an inbox' }]
		: [],
});
```

Which end may write what is a rule you write here, or a topology you arrange: one end that
refuses is a server, if you want one. The package never asks who made a commit.

## A refusal is reported at both ends

A commit that does not apply, because `accept` said no or because the applier refused it,
refuses that commit and nothing else. The next commit in the same frame still applies. Both
ends hear about it:

```ts
link.share('board', board, {
	refused: ({ mine, seq, reasons, commit, undo }) => {
		// mine: true when this end sent it, false when this end refused it
	},
});
```

The end that sent it is usually the one that can act: its write did not land over there, and
`undo` is the commit that takes it back here. Apply it to yield, or ignore it to keep your
version and let the other end yield instead. The link never chooses.

## Conflicts, and who yields

Inserts never collide: two ends adding to one list at the same moment both keep their item.
Replacing one slot at the same moment is different: each end applies its own write and then
the other's, so the two end up swapped, and stay that way until one of them yields.

Yielding is asking the other end for its state:

```ts
shared.resync();     // this end throws its version away and moves to the other end's
```

The document you hold is moved, never swapped: every watcher, derived value and reference
keeps working, and the change reads like any other commit. Write the rule that decides who
yields once, in your `refused` handler or wherever your application knows best.

## Several networks on one document

A document can be on any number of links, in a store, and under any number of watchers at the
same time, and each hears what the others land. A commit that arrives over one link is an
ordinary local commit to every other link on that document, so:

- a document shared over a socket and persisted by `@aweftjs/store` at the same time puts
  every arriving commit into the store's history without either knowing about the other;
- a node holding one document at the end of two links forwards between them, which is how a
  chain of three converges.

The proof program runs both.

## Two documents in one process

```ts
const editing = mirror(stored);
await Promise.resolve();
(editing.document as typeof stored).title = 'draft';     // reaches `stored` at the end of the tick
```

`mirror` is a link over an in-process pair. The same rules apply: asynchronous delivery,
nothing echoed, both ends equal.

## Just the commits

`track(doc, on)` is the whole engine underneath, for an application with its own protocol:

```ts
const tracker = track(doc, ({ commit, undo, landed }) => {
	if (!landed) send(commit);        // made here: ship it
});
tracker.receive(arrived);             // from elsewhere: applies, and is not shipped back
```

`landed` tells a commit that arrived through `receive` from one made here, by counting
deliveries rather than holding a flag, so a watcher that writes in answer to an arriving
commit produces a local commit that ships. `receive` must not be called from inside a
watcher; every channel here queues and applies on a microtask.

`asCommit(doc)` says a whole document as one commit, `reconcile(doc, snapshot)` computes the
commit that moves a document to another's state, and `rootFrom(id, kind)` mints an empty root
that a commit about that document can reach.

## Requests beside the link

A link carries commits and nothing else. When one end has to ask the other for something
that is not state (a report, a search, a job started), `requests(socket)` puts JSON text on
the same WebSocket the link's binary frames ride, and the two never meet: the socket adapter
ignores text, `requests` ignores bytes.

```ts
import { connect, fromWebSocket, requests } from '@aweftjs/sync';

const link = connect(fromWebSocket(socket));      // commits, as binary
const asks = requests(socket);                    // requests, as text, on the same socket

asks.answer((name, args, progress) => handle(name, args, progress));   // this end answers
const result = await asks.ask('report/Daily', { day: 'mon' }, {        // and asks
	progress: (value) => bar.set(value),
	timeout: 5000,
});
```

Both ends may ask and both may answer. Arguments and results are what `JSON.stringify`
carries, with `undefined` read as `null`; a value it cannot carry is refused as `not-data`.
An answerer that throws answers with its error's `reason` and `message`, plus its `reasons`
when it carries a list of them, and `ask` rejects with the same three. `timeout` is yours to
set; none ships. When the socket closes, every ask still waiting rejects with `closed`. A
text message that is not a request frame closes the socket, the way bytes that are not a
frame end the link and close the socket under it. `stop()` stops asking and answering and
leaves the socket alone. One `requests` per socket: a second throws `duplicate` until the
first has stopped.

The frames are `{ id, name, args }`, `{ id, result }`, `{ id, progress }` and `{ id, error }`,
so a client in another language writes them by hand. Design 073.

## A remote error keeps its own words

Every refusal in this stack renders as `reason: detail. fix`. An error that came back from the
other end of `requests` is the exception: its `message` is the answerer's message, unchanged,
because you asked a remote question and that is the remote answer. The `reason` and the `fix`
are still on the error object, and `explain(error)` from `@aweftjs/debug` shows all three.

```ts
try {
	await asking.ask('rebuild', { id });
} catch (e) {
	console.log(e.message);   // what the far end said
	console.log(e.reason);    // what to branch on
	console.log(e.fix);       // what to do about it
}
```

## Boundaries

- Nothing about who. The link does not know who made a commit or who may write where; that
  is `accept`, and it is yours.
- No sessions, no resume. A new channel is a new link.
- No winner. Two ends that conflict stay in conflict until one yields.
- No messages on the link. A link carries commits and nothing else; an intent is state in
  the document, and a request is `requests`, beside the link and never inside it.
- No storage. That is `@aweftjs/store`, on the same document, beside the link.
