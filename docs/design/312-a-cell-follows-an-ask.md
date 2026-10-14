# 312: A cell follows an ask

## Decision

`@aweftjs/client` exports `asking(client, name, args?, options?)`. It returns a read-only cell of
the latest answer to `client.ask(name, args)`:

- `{ state: 'waiting', data }` while an ask is out. `data` is the last answer's, or `null` before
  the first, so a list dims in place rather than blanking.
- `{ state: 'ready', data }` with the answer.
- `{ state: 'failed', data: null, error }` with what the ask rejected with.

`args` may be a cell. Every value it takes asks again, and an answer to an ask that a newer one
replaced is dropped. A plain value is asked once.

The cell asks only while something watches it, the way `fromEvent` listens only while watched. The
first watcher asks. When the last one stops, an answer still out is dropped, and the next watcher
asks again. Reading it with nothing watching answers the state it holds and asks nothing.

`options.pending` is handed the first ask, settled either way, so a component passes its own
`pending` and a render on a server waits for the answer. `options.timeout` is the ask's own.

## Why

One application wrote this as `asking` and calls it 27 times. Another carries an older copy. The
older copy blanks its data on every new ask and has no way to make a render wait. Both take the
component's `cleanup` to stop following the arguments. Asking only while watched removes that
argument: a component that unmounts stops watching, and the cell stops with it. That is how a cell
in this stack already behaves, so nothing about it is new to learn.

`client` cannot know about components (`docs/architecture.md`), so `pending` is a function the
caller hands in, typed as a function of a promise and imported from nowhere.

## What this costs

A cell nobody watches asks nothing, so `asking(...).get()` alone reads `waiting` forever. A page
that hydrates what a server rendered reads `waiting` at first, because the answer the render
recorded arrives a microtask later: a component that shows its waiting state there builds elements
the server sent no pair for. A page that must adopt the server's markup reads its first answer
through `ui`'s `suspend`, which shows nothing while a hydration is open (design 243). An ask that
fails because the socket dropped is not asked again on the next socket.

## Evidence

`packages/client/tests/asking.test.ts`, against a real server over sockets wired in memory: an
answer, a change of arguments asking again, a slow answer to an old ask dropped, the last data kept
while waiting, a refusal read as `failed` with its reason, nothing asked while nobody watches, a
watcher that stops dropping the answer out, a second watcher sharing the first's ask, and `pending`
handed the first ask. `recipes/full-stack` follows a search field with it in Chromium.

## What would reverse this

An application that needs the cell to ask again after a reconnect, which would make it follow
`status`.
