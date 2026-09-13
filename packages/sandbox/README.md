# @aweftjs/sandbox

A room for modules the host does not trust: an `@aweftjs/modules` loader on the far end of an
`@aweftjs/sync` link, fed a module document, props, and a list of granted names. Everything a
module inside can reach came through that link, by name.

**This package enforces the window; it does not build or promise the wall.** The window is what
crosses the link: the module document, the props, the granted names, and plain data, and nothing
else. The wall around the room is a runner's, and the operator's. `child` runs under Node's
permission model, which Node itself calls a seat belt rather than a boundary; put a jail around it
(the [`recipes/`](https://github.com/torrinworx/aweft/tree/main/recipes) show bubblewrap and
docker) when a room must be safe beside your database. `iframe` runs in an opaque-origin frame,
which is the browser's own boundary. `inProcess` isolates nothing, and is for tests and for code
you trust.

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

`createSandbox` starts the room through the runner and shares three documents into it, and
beside them whatever you name in `documents`. `load` instantiates modules inside and hands back
a **stub** for each: a plain object with one async function per function the instance had.
Calling a stub's function is a call across the boundary.

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
encode. A call is one commit round trip, about a millisecond in process (measured once, and no
script here reproduces it), so a chatty interface across the boundary is a design smell.

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
nothing when stopped; measured once, no script here reproduces it), so per-call, per-user, or shared is your arithmetic, not this package's.

## Sharing your own documents

Name a document and it crosses under that name, writable from both ends:

```ts
const state = createObject({ count: 0 });
const sandbox = await createSandbox({ runner, modules, grants, documents: { state } });
```

Inside the room the far end hands it back as `share('state')` (a room with a page in it wraps
that as the module's `client.share`); a name you did not share is refused at once with
`not-shared`. The names `modules`, `room`, `calls` and `route` are the room's own and are
refused with `reserved`. A room may write whatever it can read, so where it must not, put
`@aweftjs/schema`'s `guard` on your copy: a write the guard refuses never lands on your side,
and the room's copy diverges, exactly as with a page against a server.

## Asking the host

A room with a page in it asks by name, and the ask reaches `client.ask` on the host when the
name is in `grants`:

```ts
const sandbox = await createSandbox({ runner, modules, grants, client });   // client: what createClient answered
```

A name not in `grants` is refused with `refused`, as is every ask when no `client` was given.
A refusal from the server crosses with its own reason and message. The host client's `status`
is mirrored into the room, and reads `closed` when there is no client.

## What leaves the room as data

Uncaught errors, unhandled rejections and the console levels you name cross as plain data:

```ts
const sandbox = await createSandbox({
	runner, modules, grants,
	console: ['error', 'warn'],                            // the default
	handlers: {
		error: ({ kind, message, stack, module }) => log(kind, message),
		console: (level, text, stack) => log(level, text),
	},
});
```

Each realm forwards what it can and what is not already yours. A frame (`iframe`) forwards
errors, rejections and the named console levels, because nothing else in it reaches the page
that made it. A child process (`child`) forwards the console only: its stdout and stderr are
inherited, and an uncaught error ends the process, which you hear as `closed` on every waiting
call. An in-process room forwards nothing, because its console and its errors are already yours.
Every forwarded console line still reaches the room's real console first; the text is cut to
4096 characters and the stack is the room's own. The lines of one tick cross as one call and
reach the handler one by one, in order. A handler that throws costs the room nothing, and a
report that is not the shape above is dropped.

## A room with a page in it

A room can hold an act: a module that renders, on the same stage, with the same documents and
the same `client` a page module gets, inside a frame the page cannot be reached from. Two
subpaths, one for each side of the wall.

**The host act**, from `@aweftjs/sandbox/page`, is a `ui` component for an act:

```tsx
import { createObject } from '@aweftjs/core';
import { Room } from '@aweftjs/sandbox/page';

// Every entry of the module document is its own createObject, as in the quickstart.
const modules = createObject({ 'app/Main': createObject({ source: mainSource }) });

const App = () => (
	<Room inside="/room/room.js" importMap={{ '@aweftjs/ui': '/room/ui.js', '@aweftjs/core': '/room/core.js' }}
		modules={modules} grants={grants} documents={{ board }} client={client} act="app/Main"
		allow={{ images: [] }} handlers={{ error: (entry) => log.write(entry) }} focus />
);
mount(document.body, <StageContext router={router} acts={{ '': Home, 'app/:id': App }}><Stage /></StageContext>);
```

It renders one element on the `room` entry, the frame fills it, and the room is made when the
act mounts and stopped when it leaves: one frame per act instance. Key the host act `app/:id`,
not `app/:id/*tail`: a `*name` takes the rest as a parameter and leaves no tail, so a host key
with one rebuilds the act, the frame and the room on every move inside the room and hands the
room nothing to route on. What an act does not match is its tail, so `app/:id` is enough, and
`app/:id/*`, which parks the rest without taking it, is the same match written out. `theme`,
`class`, `element` and the rest of the props go to the element, as on every component. It is sized by the theme like any element: `<Room theme="tall">` and
`Theme.define({ room_tall: { height: '80vh' } })`, or a `Theme` provider over `room`; the
default height is `$roomHeight`.

**The room entry**, the application's own bundle, calls `room` from `@aweftjs/sandbox/room`
with the port the frame is posted:

```tsx
import { room } from '@aweftjs/sandbox/room';
import { Theme, light } from '@aweftjs/ui';

const Layout = (props) => <Theme value={light}>{props.children}</Theme>;
export const insidePort = (port) => room(port, { template: Layout });
```

`room` runs the far end over the port, builds one loader, mounts a stage on the act the host
named into the frame's body, and takes over the anchors under it. `template` is where `Theme`
and `Icons` go, because a frame starts with no theme at all.

**The room bundle and the import map.** The frame imports `inside` from the page's origin, and
the acts in the module document import bare names (`@aweftjs/ui`, `@aweftjs/core`) that the
frame's import map has to answer from that same origin, because the frame's policy allows
scripts from nowhere else. Build the entry and one file per bare name as one library, so every
entry shares one copy of `ui`:

```ts
// room.config.ts
export default defineConfig({
	plugins: [aweft({ defaultH: '@aweftjs/ui' })],
	build: { lib: { entry: { room: 'room.tsx', ui: 'names/ui.ts', core: 'names/core.ts' }, formats: ['es'], fileName: (_f, name) => `${name}.js` } },
});
// names/ui.ts:   export * from '@aweftjs/ui';
```

`Room` passes `importMap` into the frame and resolves `inside` against the page's URL. Serve
the bundle with `Access-Control-Allow-Origin: *`: the frame's origin is opaque, so every module
it imports is a cross-origin request. `recipes/room` builds it this way and serves it from the
dev server with `cors` on; a production server sends the same header for the room's files.

**Inside the room, a factory gets `client`**, shaped as the page's: `share(name)` for a
document named in `documents`, `ask(name, args)` for a granted name, answered by the page's
own `client.ask` so the server sees the page's identity, and `status`, the page client's
mirrored. `reconnect` and `close` are refused with `not-in-room`; the connection is the page's.
The host's `props` are spread beside it. So an act module runs on either side of the wall
unchanged:

```js
export default ({ client }) => {
	const board = client.share('board');
	return { component: () => <Editor board={board} save={() => client.ask('app/Save')} /> };
};
```

An act with screens of its own renders a `StageContext` with no `router`, as any nested stage
does: it follows the room's router through the tail the act did not take, the same as on a
page. A `createRouter()` inside the frame throws as it is made, because the frame has no
history of its own and the router's first write to it is refused.

**`documents`** is what the page holds and the room may read and write: the same objects the
page shares with the server, so a room write reaches the server through the page, and a server
write reaches the room. Refusing a write is your `schema` guard on the page's copy.

**`allow`** opens what a page in the frame needs to paint and nothing else: inline styles
always, and `images`, `fonts` and `media` from the inside origin, `data:`, `blob:` and the
origins you name. An image from an origin not named is a broken image in the frame, not an
error on the page. Scripts and connections never widen: `fetch` in the room is refused whatever
`allow` says.

**The route across the wall.** The tail of the page's URL under the host act is the room's whole
URL: at `/app/7/second` the room's stage is on `/second`, `''` is its index, and an act's own
nested stage routes on it. The room's stage keys the act on the bare `*` key, which takes no
parameter, so a move inside the room changes the nested stage's screen and the act's component,
with the state it holds, is not built again. A navigation inside the room is a navigation on the page, at the
act's prefix, so the address bar follows, the browser's back works, and a deep link opens the
room deep. A room can push or replace under its tail and nowhere else; its `back` is honoured
only while the entry showing is one it pushed, and one at a time: a second back before the
page's entry has moved is dropped. A `url` over 8192 characters or holding a control character
is refused on both sides. The page's query and hash ride along with the tail, because a routing
tree has one query. Under a stage with no router, or no stage at all, the room's URL is `/` and
its moves change nothing on the page.

**What leaves the room** is data: uncaught errors and unhandled rejections to
`handlers.error`, each carrying `module`, the act, and the console levels you name to
`handlers.console`. The page decides what to do with them; `recipes/room` writes them with
the logs battery.

**Known limits.**

- No pointer lock, no `confirm()`, no `alert()`, no popups: the sandbox attribute is
  `allow-scripts` and nothing else.
- No links out. The room intercepts nothing: an `<a target="_blank">` in the room opens
  nothing, and an application that wants one exposes a name and writes the in-room module
  that asks for it.
- No `connect-src`. A module that must fetch is a room with a network, which is not this
  runner.
- One act per room. A second `StageContext` beside the act's is a content swapper, as on a page.
- The bundle and every name in the import map come from the inside origin, with CORS, or the
  frame imports nothing.

## Libraries and reloading

A library is a module. Pass `bundle` (a module specifier whose default export is a
`fromBundle` map) and the room's loader can import it. Pass `follow: true` and a module whose
source changes in the document is reloaded inside the room, with `handlers.applied` and
`handlers.failed` told as data. In a room with a page in it, a reload of the act or of a module
it depends on rebuilds the act on screen, on the URL it was on. A reload that fails leaves the
module unloaded: the screen keeps what it showed, and a later edit is not followed until the
next navigation loads the module again. Nothing reloads unless you ask.

## The runners

| runner | the room is | the wall is | what it stops |
|---|---|---|---|
| `inProcess()` | this process | none | nothing; the trusted case |
| `iframe({ inside, into, allow })` | an opaque-origin frame | the browser | the page, its storage, cookies, the network, navigation |
| `child(options)`, on `@aweftjs/sandbox/node` | a Node process | Node's permission model, plus your `wrap` | files, network, spawning, workers, native addons, eval, the environment |

`iframe` takes `allow`, what a page in the frame may load beyond scripts: `styles: true` for
inline styles, and `images`, `fonts` and `media`, each a list of origins beside the inside origin,
`data:` and `blob:`. Scripts and connections never widen: `connect-src` stays refused whatever
`allow` says, and the sandbox attribute stays `allow-scripts` alone. `child` takes
`limits.memoryMB`, `read` (paths besides this package's own it may read), `env` (empty unless
given), and `wrap` (a command in front of the Node command: a bubblewrap invocation, a
`sudo -u`). `createSandbox` takes `limits.callMs` (a call the room does not answer in time
errors with `timeout`), because a room of any runner can hang. None of the limits ship with a
value. A runner is `start()` returning a channel and `stop()`; a room on another machine is the
same runner over a socket, and [`recipes/`](https://github.com/torrinworx/aweft/tree/main/recipes)
shows a docker one whose channel is the container's stdin and stdout.

A runner proves what it stops by passing `roomChecks()` from `@aweftjs/testing`, an append-only
escape suite run in every shipped runner (and, for the frame, under a real browser).

## What this package never decides

Which runner. How many rooms, for how long, or how they are grouped. What the wall is. Who may
load, grant, or call. Limits. What a granted module lets a caller do. Which modules go in a
room, whether a write from the room is acceptable, what the template looks like, whether a link
out of the room opens. It enforces the window, each runner says what it stops, and the wall is
yours.

The design notes are in
[`docs/design/`](https://github.com/torrinworx/aweft/tree/main/docs/design) 066 to 070 and 277
to 281.