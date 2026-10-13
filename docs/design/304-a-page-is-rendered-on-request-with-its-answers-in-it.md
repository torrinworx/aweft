# 304: A page is rendered on request with its answers in it

Amends design 149 (the document a page is written as) and design 151 (attach picks its mode from
the stamp). Design 305 is the matching rule it relies on for a 404. Design 306 makes a static render
reject, so a page that does not catch a failed read cannot end the process.

## Decision

`@aweftjs/ssg` exports `createPages(options)`. It makes a server module, `{ public: true, request }`,
that renders the application's page for every page request, with the answers to the page's reads
written into the document, so a crawler reads real content and the browser takes the page over
without asking for that data again.

The application's own server module calls it from its factory and answers what it returns:

```ts
export const deps = ['auth/Gate', 'posts/List'];

export default ({ imports }) => createPages({
	page: (router, client) => h(Site, { router, client }),
	gate: imports.Gate,
	modules: { 'posts/List': imports.List },
	dir: 'dist',
});
```

**What it answers.** `GET` and `HEAD`. Any other method is declined. A path that names a file under
`dir` is declined, so `static/Files` behind it serves the bundle. Everything else is rendered. The
shell is `index.html` in `dir`, read once when the module is made. A shell that is missing, or has
no head or body, is refused then rather than on the first request. So is a `modules` entry with no
`call`, which is what an import spelled differently from `deps` reads as. `modules` is read once.

**One render per request.** The page is built from a router made from the request's path and query
and from a client made for this render alone. That client's `ask(name, args)`:

1. Sends `args` through JSON, as the socket would.
2. Takes the module from `modules`, keyed by the name the page asks. A name the render was not
   handed is a failed read.
3. Identifies the visitor once per render: the gate's `identify` is handed a request for the page's
   path with no query, no headers at all, and no peer address. That is a visitor nobody knows.
4. Asks the gate's `access` for that module with that context. A refusal rejects the ask with
   `refused` and the gate's reasons, made the way the server makes it, so its message is the one a
   browser would read.
5. Runs the `call` with that context. A throw that carries a `reason` is a refusal and crosses as it
   would on the socket: reason, message and reasons. Any other throw is a failed read.
6. Hands the page the result through JSON, `undefined` read as `null`, so the page holds what a
   browser would. Progress reaches the page's handler until the answer and not after, and a
   handler that throws is reported to the operator and does not fail the read.

`share` answers a handle whose document never arrives and whose `ready` rejects with `not-shared`,
`status` is `open`, and `reconnect` and `close` do nothing.

**What is recorded.** Every answer, a result or a refusal, under the name and the arguments, the
arguments' object keys sorted, in the order the asks were made. A failed read records nothing.

**The answer to the request.**

| what happened | status | body |
|---|---|---|
| a read failed | 503 | the shell |
| the page waited on a shared document and did not catch `not-shared` | 503 | the shell |
| more renders in flight than `renders` (16) | 503 | the shell |
| the render ran past `timeoutMs` (10 000) | 503 | the shell |
| the page wrote `<Meta httpEquiv="status" content="410" />` | that status | the page |
| a stage shows its fallback or nothing | 404 | the page |
| otherwise | 200 | the page |

The page is the document `createSite` writes (design 149). The recorded answers go at the end of
its head as `<script type="application/json" id="aweft-answers">`, with every `<` written as the
JSON escape `\u003c`, so no string in an answer can close the script.

A status meta is read off the head list by the rule `noindex` is read by: the deepest, then the
latest. A status other than 200 or a whole number from 400 to 599 is refused with `bad-status`.
Every other status needs a header a page cannot write, or forbids the body a page is.

A loader that rejected with nothing to show it makes the render reject (design 306). After a
failed read or an unshared document, the answer is the shell, 503. Otherwise the rejection is the
page's defect: the render throws it, and the server reports it and answers 500, as it does for
`bad-status`.

A render past its time keeps its place among the `renders` until it ends, because it is still
running. `HEAD` gets the status and headers with no body. No `Cache-Control` is written.

**The browser half.** `replay(client, document?)` on `@aweftjs/ssg/client` returns a new client.
For an ask the render made, it gives back the recorded answer: each answer once, in the order the
render asked. A recorded refusal comes back as a rejection with its reason, message and reasons.
Every other ask goes to `client`. A page with no recorded answers gets `client` back unchanged.
Once `attach` has finished hydrating the page, it throws away the answers nobody asked for.

## Why

**A function the application's module calls, not a battery module.** A battery is configured by
data, and a server hands a factory `store` and nothing else (design 240), so a battery module has
no way to reach the application's read modules or its gate. The application's module already names
what it needs in `deps`, and it hands those instances to `createPages`. A module that runs a
scheduler is written the same way: it calls `createScheduler` with what it was handed.

**Through the gate.** A module that needs a name does not check it itself: the gate refuses the
call. If the render called that module with a context it made up, the module would answer, and its
answer would be in a page anyone can fetch. So the render asks the application's own gate who a
request with no credentials is, and asks the gate whether that visitor may call each module. A
private module is then refused in the render, as it is in that visitor's browser. The render sends
a request with no headers at all, not the visitor's request with its cookie removed, because a gate
may read identity from any header.

**A refusal is an answer, a failure is not.** When a read is refused to an anonymous visitor, the
page shows that visitor the refusal, and the browser has to hydrate the same markup. So the refusal
is recorded and replayed. When a read fails, part of the page is missing. A crawler that indexes
that page indexes it with the part missing, which is what a 200 did in one application. A 503
tells the crawler to come back later. The shell mounts in a person's browser and asks again, so the
person still gets the whole page.

**The same for a limit.** The shell is not the page, and a 200 with an empty body tells a crawler
the page is empty.

**The status comes from the page's head.** Only the page knows that `posts/:id` found no row. The
head list is where `noindex` is already read from, by the same winning rule, so a page inside a
layout overrides the layout. `http-equiv` is HTML's attribute for what a response header would say.

**404 sends the page, not the shell.** At a path nothing takes, the browser's own router shows the
fallback too, so the rendered fallback hydrates in place and a crawler with no script reads the
site's own not-found page.

**Recorded per key, used once each, then thrown away.** The browser runs the same page code with
the same URL, so it makes the same asks in the same order. The key sorts object keys, because two
programs that build the same object can still put its keys in a different order (design 302). The
recorded answers exist only so the hydration matches the server's markup. An ask after the
hydration should get current data from the server, so each answer is used once and the unused ones
are thrown away when the hydration is done.

**A share in a render rejects.** A render has no link, so no shared document can arrive. In the
browser, a shared document has not arrived yet when the page first renders either. A page that
shows its waiting state therefore renders the same markup in both places, and hydrates. `ready`
rejects instead of staying pending, because a render that waits on a promise that never settles
never ends, and it keeps its place among the `renders` for as long as the process runs.

**No query for the visitor nobody knows.** A gate may read a credential from the query, such as a
token in a link, as easily as from a cookie. The request the render identifies carries the path
and nothing else.

**The defaults.** 16 renders in flight, because each one holds a whole page and its answers in
memory until it is written, and with no queue the cap is also how many visitors arrive at once
before one gets the shell. Ten seconds is far past what a render that reads a store needs. Both are
options.

## What this costs

The application names each read twice, in `deps` and in `modules`, and passes its gate a second
time. If it passes a different gate here, the render follows that one.

A render runs no `connection` hook and emits no `observe` event. A read whose `call` relies on
state a connection set up fails, and the request is 503. The logs battery records no ask a render
made. A render ignores an ask's `timeout` option. The render's own `timeoutMs` applies instead.

A page that waits on a shared document is answered with the shell. A render that waits on
anything else that never settles keeps its place until the process restarts. Once `renders` of
them are stuck, every page on the site is answered with the shell. The cap stops stuck renders
from filling memory, and that is the price.

A gate that reads a credential from the path itself still finds it in the path a render sends, so
that render runs as the person the credential names.

It renders one language. `createSite`'s `locale` and `locales` are not options here.

It answers every path that is not a file, so another module that answers `request` (uploads) has to
load before it, and `static/Files` after it.

Every request renders. A cache is the application's, in front of the process.

## Evidence

`packages/ssg/tests/pages.test.ts` drives the module through `createServer` on a real port. It
checks:

- a page with its answers in the head
- a private read refused in a render, for a signed-in request and for a token in the query, with
  the refusal recorded and the page still 200
- the refusal's message equal to the one a client reads over a socket from the same server
- a refusal the module threw, recorded whole
- the status meta winning, and a status out of range answered 500
- a path nothing takes, and one a key only starts, answered 404 with the fallback page
- a failed read and a name not handed over, answered 503 with the shell whether the page caught
  them or not, with the server still answering afterwards
- a page that waits on a share, answered with the shell
- a file and a POST declined, and `HEAD` with no body
- two asks with one key, recorded in the order they were made
- progress until the answer, and a progress handler that throws
- the time limit and the renders cap each answering the shell, with the place held until the
  render ends
- a shell, options and a module with no `call` refused when the module is made

`packages/ssg/tests/replay.test.ts` checks that each answer is replayed once and in order, that
arguments are keyed through JSON with sorted keys, that a refusal is rejected with its reasons, and
that every other ask goes to the client. It takes a page `createPages` rendered over with no ask
reaching the client and every element adopted, and checks that the unused answers are thrown away.

`recipes/pages-on-request` renders a site per request and takes a post over in Chromium. It asserts
that no ask reached the server over the socket, that no element the server wrote was removed or
replaced, that no box moved, and that the next navigation asked the server once.

## What would reverse this

A server API that lets a module ask another module through the gate, which would replace the
`gate` and `modules` options. A measurement on a real application that puts the defaults somewhere
else. An application that needs request-time pages in more than one language.
