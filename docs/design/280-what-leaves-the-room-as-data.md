# 280: What leaves the room as data

## Decision

The far end reports uncaught errors, unhandled rejections and the console levels the host
named, as calls to the host carrying plain data, one call per tick with the tick's reports in
a list:

```ts
interface Report {
	kind: 'error' | 'rejection' | 'console';
	level?: string;     // the console method, for `console`
	message: string;
	stack: string;      // '' when there is none
	module?: string;    // the act on screen, when the room knows it
}
```

`createSandbox` gains `console?: readonly string[]`, the levels that cross, default
`['error', 'warn']`, written into the room control document as `console`. `handlers` gain
`error(entry)`, which hears `error` and `rejection`, and `console(level, text, stack)`. The
host hands each entry of a call to its handler in order. A handler that throws costs nothing:
the throw is dropped, the entries beside it are still handed over, and the room goes on. A
report that is not this shape is dropped at the host, not thrown, and costs the entries beside
it nothing; a call whose argument is not a list is dropped whole. A room that sends malformed
reports is a room being hostile, and the host's own code is not the thing that should break.

**One call per tick.** The far end queues each report and flushes the queue as one call from a
microtask, so a module that logs in a loop writes one row, not one per line. A microtask rather
than a timer, because the burst that costs the host is a synchronous one and a microtask catches
all of it, and because a hidden page's throttled timers would otherwise hold an error back. The
host walks every open call row on every commit of the calls document, so rows are the cost that
matters (measured: ten thousand lines in one tick reached the host after 99 s as ten thousand
rows, and after 211 ms as one).

**How a line is made.** Console text is built safely: a string as itself, an `Error` as its
name and message, anything else through `JSON.stringify` and then `String`, each attempt in
its own guard, so an argument whose `toString` throws cannot throw back into the room. Message
and stack are each cut to 4096 characters. The stack is taken in the room's realm, at the
wrapper, so it names the room's own frames. Every forwarded line still reaches the room's
real console first; the wrapper adds a report and takes nothing away. A level the host named
that the console does not have is left alone. `module` is `page.act` when the host gave one.

**Which realms report.** The far end takes `forward: { errors?, console? }` and installs
nothing on its own.

- A frame (`insidePort`, and `room` on the page) forwards errors, rejections and console.
  Nothing else in the frame reaches the host: its console is its own, and an uncaught error
  in it is invisible to the page that made it.
- A child process (`child`'s bootstrap) forwards console only. Its stdout and stderr are
  inherited, so an operator already sees them, but the host cannot attribute a line to a
  module from a pipe; an uncaught error ends the process, and the channel closing is the report
  the host already gets (`closed` on every waiting call).
- An in-process room (`inside` over `inProcess`) forwards nothing. It shares the host's realm:
  an `error` listener there would hear the host's own errors, and its console is the host's
  console.

## Why

The two applications this is for each forward errors and console lines from the frame to the
host, attributed to the module on screen, so that an agent can read what its module did and a
log can record it. Only data crosses the link (design 068), so an error crosses as its message
and stack, and the host decides what to do with them.

Levels named by the host rather than every level, because `log` and `debug` are what a module
prints while it is being written, and a room that forwarded them would carry a call round trip
per line. `error` and `warn` are the two that mean something went wrong.

## What it costs

One call row per tick of forwarded lines, so a module that logs across ticks pays a round trip
per tick. The application names fewer levels, or none.

A report attributes to the act on screen, not to the module that printed. A shared dependency
printing under an act is reported under that act.

## What would reverse this

An application that needs the console line's arguments as structured data rather than text,
or attribution by stack frame to the module that printed. The first widens `Report`; the
second needs a source map the room does not have.
