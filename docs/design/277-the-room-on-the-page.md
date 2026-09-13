# 277: The room on the page

## Decision

`@aweftjs/sandbox` gains two subpaths, one for each side of the wall, so that a page can run
untrusted act modules inside a frame with the same stage, the same documents and the same
`client` shape the page itself uses. The package stays what design 066 made it: the window,
never the wall. What the two halves add is what a page needs and nothing a compute room
refuses.

**`@aweftjs/sandbox/page` exports `Room`, a `ui` component for an act.**

```tsx
<Room inside="/room.js" modules={doc} grants={grants} documents={{ state }} client={client}
	act="app/Main" allow={{ images: [origin] }} console={['error', 'warn']}
	handlers={{ error, console, applied, failed }} focus />
```

It makes the `iframe` runner and the sandbox; shares every document in `documents` on the
room's link under its name (design 278); shares a `route` document and runs the tail it
holds across the wall (design 279); hands the room's asks to the page's `client.ask` for
granted names and refuses the rest; hands errors and console lines to `handlers` (design
280); passes `styles: true` and `allow` to the frame (design 281); focuses the frame on
request; and stops the room when the act leaves, which is the runner's `stop` (design 069)
run from the component's unmount. The frame is the component's own element, sized by the
theme like any element. One frame per act instance.

**`@aweftjs/sandbox/room` exports `room(port, { template })`.** The application's room entry
is its own bundle, served from its origin, and it exports
`insidePort = (port) => room(port, { template })`. `room` runs the far end over the port
(`enter`, below), builds the room's `client`, makes the router over the `route` document, and
mounts

```tsx
<StageContext router loader acts={{ '*': act }} template><Stage /></StageContext>
```

into the frame's body, `act` being the name the host passed as `page.act`. `template` is
where the application puts `Theme` and `Icons`.

**One loader in the room.** `room` builds it, over the sources the far end lists in the order
`inside` has always listed them (granted names ahead of the module document, the bundle
after), and hands it to both ends of the room: to the far end, which answers the host's
`load`, `unload`, `loaded` and calls against it, and to the stage as `StageContext`'s
`loader`. That is why the far end is split into `enter(channel)` and `serve(loader)`: `enter`
connects the link, waits for the host's documents and answers with what a loader is built
from; `serve` takes the loader and attaches the bridge and `follow`. `inside(channel)` is
`enter`, `createLoader`, `serve`, unchanged for a compute room.

**A factory in the room gets `client`, and the `props` the host gave.** Designs 240 and 242
state the props rule for the server and the page; the room is the third plane and the rule is
the same, with the one thing a compute room already had kept: `createSandbox`'s `props` are
spread into every factory's props beside `client`, as they always were, and `client` wins a
name they both use. The room's `client` is the page's own type (`Client` from
`@aweftjs/client`), so an act module runs on either side of the wall unchanged:

- `share(name)` hands back the document the host shared under `name`, and refuses a name the
  host did not share with `not-shared`, at once, with the fix naming `documents` on `Room`.
- `ask(name, args)` is a call to the host, answered by the page's own `client.ask` when `name`
  is in `grants` and refused with `refused` otherwise. The server sees the page's identity, not
  the room's, because the room has none.
- `status` mirrors the page client's, through the control document.
- `reconnect()` and `close()` are refused with `not-in-room`. The connection is the page's;
  a module that could close it from the room would be reaching past the window. A no-op
  would let a module believe it had done something.

With `follow`, a reloaded act on screen is rebuilt: the stage's loader is the loader `follow`
reloads into, `serve(loader, handlers)` lets `room` hear `applied` beside the host, and when
the module applied is the act or one the act depends on, `room` unmounts the stage and mounts
it again. The stage was handed the loader, so unmounting drops only the act it showed, and the
router keeps the URL, so the act comes back on the screen it was on. No `ui` surface was added
for this; a remount is what a stage already does. The cost is one more factory run: `follow`
built the new instance, the stage lets it go and builds it again. A reload that fails to compile
leaves the module unloaded, as `follow` does everywhere: the screen keeps what it showed, the
failure reaches `handlers.failed`, and a later edit is not followed until the next navigation
loads the module again, because `follow` reloads loaded modules only.

**What the host is told.** The `module` on a report is `page.act`, the name the host passed,
which is the one act a room shows; the stage's own `current` is an act key, not a module name.
`Room` resolves `inside` against the page's URL, so `/room/room.js` is that path on the page's
origin, which is the one origin the frame may load scripts from. `room()` refuses a compute
room, one started with no `page`, with `no-act`. `room()` takes `document`, the frame's own
when left off, which is the one seam that lets the whole loop run in a Node test over two light
documents and Node's own `MessageChannel`.

**The room bundle is served with CORS.** A frame with an opaque origin sends `Origin: null`
with every module request, and a module script is always fetched with CORS, so the bundle and
everything the import map names come with `Access-Control-Allow-Origin: *` or the frame imports
nothing. The recipe's dev server sets it; whatever serves the bundle in production does the
same for the room's files.

**The act under `*` stays across inner navigation.** The room's stage keys the act on the bare
`*`, which takes no parameter and parks the whole URL as the tail (designs 122 and 279), so a
move from `/` to `/second` inside the room is a tail change and not a parameter change: the
act's nested stage follows the tail and shows the right screen, and the act's component, and
the state it holds, are left alone (design 123). Keying it on `*rest` instead would make the
rest a parameter and build the act again on every move.

**What it never decides.** Which modules go in a room, or how many rooms a page has. What a
granted name lets a module do. Whether a write from the room is acceptable: that is `schema`
on the host's copy (design 278). What the template looks like. Which console levels cross
beyond `error` and `warn`. Whether a link out of the room opens: the room intercepts nothing,
and an application that wants `<a target="_blank">` to work exposes a name and writes the
in-room module. Exit gestures, theme mode, location, files: application modules on granted
names. Pointer lock and `confirm()`: the sandbox attribute does not widen, and both are known
limits in the README.

## Why

Two applications on this stack each carry a hand-written boot file and a hand-written bridge
to run agent-written or participant-written modules in a frame: a UI booted with theme, icons
and popups; a live state document mirrored both ways; the module's tail mirrored to the
address bar and back; uncaught errors and console lines forwarded to the host; a closed table
of grant-checked calls; a CSP opened for styles, images, fonts and media. Every one of those is
a thing the sandbox already half has (a link, a loader, call rows, grants) or the page already
has (a stage, a router, a client), and the two halves here are those pieces joined once.

A `client` shaped like the page's rather than a plain prop bag, because the point of a module
is that it does not know which side of the wall it is on. `share` and `ask` are the two things
a page module does with its connection, and they are the two things a room can hand across
the link as data.

One loader rather than one for the far end and one for the stage, because two loaders would
build two instances of a shared module and each would think it owned the document, the timer
or the socket inside it; that is the rule design 242 already states for nested stages.

## What it costs

A room carries the page's whole rendering stack: a bundle of core, dom, ui and one icon is
362 KB, 104 KB gzip, unminified. The application serves it from its origin, and the frame
imports it once per room.

`ask` from the room is two hops, room to page and page to server, and each hop is a call
round trip. A chatty module across the wall feels it, as design 068 already says.

`status` in the room is a mirror written by the host, so it lags the page's cell by one
commit delivery.

## What would reverse this

An application that needs two independent module graphs in one frame, or a room that must
reach the server directly rather than through the page's identity. Either would be a design
note of its own; neither widens this one.
