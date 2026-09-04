# @aweftjs/sandbox

A room for modules the host does not trust: an `@aweftjs/modules` loader on the far end of an
`@aweftjs/sync` link, fed a module document, props, and a list of granted names. Everything a
module inside can reach came through that link, by name.

**This package enforces the window; it does not build or promise the wall.** The window is
what crosses the link: the module document, the props, the granted names, and plain data, and
nothing else. The wall around the room is a runner's, and the operator's. `child` runs under
Node's permission model, which Node itself calls a seat belt rather than a boundary; put a jail
around it (the `examples/` show bubblewrap and docker) when a room must be safe beside your
database. `iframe` runs in an opaque-origin frame, which is the browser's own boundary.
`inProcess` isolates nothing, and is for tests and for code you trust.

## Quickstart

```ts
import { createArray, createObject } from '@aweftjs/core';
import { createSandbox, inProcess } from '@aweftjs/sandbox';

// The modules an agent or a user wrote, as source in a document.
const modules = createObject({
	'report/Daily': createObject({ source: `
		export const deps = ['data/Rows'];
		export default ({ imports }) => ({ run: (day) => imports.Rows.forDay(day).length });` }),
});

// The names the room may reach. Change this array whenever you like.
const grants = createArray(['data/Rows']);

const sandbox = await createSandbox({ runner: inProcess(), modules, grants });
sandbox.expose('data/Rows', { forDay: (day) => rowsFor(day) });

const { 'report/Daily': daily } = await sandbox.load(['report/Daily']);
await daily.run('mon');        // a call into the room; arguments and result are data
await sandbox.stop();
```

The module document is an `@aweftjs/core` observable object (`createObject`) keyed by module
name, and `grants` is an `@aweftjs/core` observable array (`createArray`); a plain object or
array will not do, because the room follows their changes. A module names what it needs in
`deps`, and each dependency reaches its factory under the **last segment** of the name, so
`data/Rows` is `imports.Rows`; that is `@aweftjs/modules`' rule, and it holds for a granted
name too.

`createSandbox` starts the room through the runner and shares three documents into it. `load`
instantiates modules inside and hands back a **stub** for each: a plain object with one async
function per function the instance had. Calling a stub's function is a call across the
boundary.

## What crosses, and what does not

The link carries commits and nothing else, so a call is a row in a document: the request goes
in, the answer is written beside it, and the side that asked deletes the row once it has read
the answer. Only data crosses. An argument or a result that is not plain data (a function, an
observable, a class instance, a `Uint8Array`, a cycle) is refused by name, at the end that
tried to send it, before anything is written:

```ts
await daily.run(() => 1);      // throws: reason 'not-data', path 'args[0]'
```

What is data is what `JSON.parse(JSON.stringify(x))` gives back unchanged. Binary is yours to
encode. A call is one commit round trip, about a millisecond in process, so a chatty interface
across the boundary is a design smell.

## Granting a name

A module inside names what it needs in `deps`, exactly as any module does. A name it may reach
is one the application both **exposed** and **granted**:

```ts
const withdraw = sandbox.expose('files/Read', { read: (path) => allowedText(path) });
grants.push('files/Read');     // now a module that deps on 'files/Read' can load
// ...
grants.splice(grants.indexOf('files/Read'), 1);   // the next call to it is refused
withdraw();                                         // and the instance is let go
```

Inside the room the granted name is an import: a plain object carrying the instance's
functions. Only functions cross; a property that is not a function is not visible, so expose a
function that returns it. The host checks the grant on **every** call against its own list, so
a room editing its own copy of the list changes nothing.

Modules in one room use `deps` among themselves and may trust each other, which is how a room
of client components imports a button into a larger one. Whether each user, or each module, or
each call gets its own room is yours: a room is a process (about 90 MB, about 120 ms to start,
nothing when stopped), so per-call, per-user, or shared is your arithmetic, not this package's.

## Libraries and reloading

A library is a module. Pass `bundle` (a module specifier whose default export is a
`fromBundle` map) and the room's loader can import it. Pass `follow: true` and a module whose
source changes in the document is reloaded inside the room, with `handlers.applied` and
`handlers.failed` told as data. Nothing reloads unless you ask.

## The runners

| runner | the room is | the wall is | what it stops |
|---|---|---|---|
| `inProcess()` | this process | none | nothing; the trusted case |
| `iframe({ inside, into })` | an opaque-origin frame | the browser | the page, its storage, cookies, the network, navigation |
| `child(options)`, on `@aweftjs/sandbox/node` | a Node process | Node's permission model, plus your `wrap` | files, network, spawning, workers, native addons, eval, the environment |

`child` takes `limits.memoryMB`, `limits.callMs` (a call the room does not answer in time
errors with `timeout`), `read` (paths besides this package's own it may read), `env` (empty
unless given), and `wrap` (a command in front of the Node command: a bubblewrap invocation, a
`sudo -u`). None of the limits ship with a value. A runner is `start()` returning a channel and
`stop()`; a room on another machine is the same runner over a socket, and `examples/` shows a
docker one whose channel is the container's stdin and stdout.

A runner proves what it stops by passing `roomChecks()` from `@aweftjs/testing`, an append-only
escape suite run in every shipped runner (and, for the frame, under a real browser).

## What this package never decides

Which runner. How many rooms, for how long, or how they are grouped. What the wall is. Who may
load, grant, or call. Limits. What a granted module lets a caller do. It enforces the window,
each runner says what it stops, and the wall is yours.

The design notes are in `docs/design/` 066 to 070.
