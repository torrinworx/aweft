# 304: A page is rendered on request with its answers in it

Amends design 149 (the document a page is written as) and design 151 (attach picks its mode from
the stamp). Design 305 is the matching rule it relies on for a 404, and design 306 is what keeps a
page that does not catch a failed read from ending the process.

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

**What it answers.** `GET` and `HEAD`; any other method is declined. A path that names a file under
`dir` is declined, so `static/Files` behind it serves the bundle. Everything else is rendered. The
shell is `index.html` in `dir`, read once when the module is made; a shell that is missing, or has
no head or body, is refused there rather than on the first request. So is a `modules` entry with no
`call`, which is what an import spelled differently from `deps` reads as; `modules` is read once.

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

The page is the document `createSite` writes (design 149), with the recorded answers as
`<script type="application/json" id="aweft-answers">` at the end of the head, `<` written as
`<` so no string in an answer can close the script. A status meta is read off the head list by
the rule `noindex` is read by: the deepest, then the latest. A status other than 200 or a whole
number from 400 to 599 is refused with `bad-status`, because every other status needs a header a
page cannot write or forbids the body a page is. A loader that rejected with nothing to show it
makes the render reject (design 306): after a failed read or an unshared document that is the
shell, 503; otherwise it is the page's defect, thrown for the server to report and answer 500, as
`bad-status` is. A render past its time keeps its place among the `renders` until it ends,
because it is still running. `HEAD` gets the status and headers with no body. No `Cache-Control` is
written.

**The browser half.** `replay(client, document?)` on `@aweftjs/ssg/client` answers a client that
answers each ask from the page's recorded answers first, each answer once and in order per key, and
asks `client` for everything else. A refusal is rejected with its reason, message and reasons. A
page with no recorded answers gets `client` itself. `attach` drops whatever is left once its
hydration has settled.

## Why

**A function the application's module calls, not a battery module.** A battery is configured by
data, and a server hands a factory `store` and nothing else (design 240), so a battery module has
no way to reach the application's read modules or its gate. The application's module already names
what it needs in `deps`; handing those instances to `createPages` is the shape a module that owns a
scheduler already has.

**Through the gate.** A read module that needs a name leaves the refusing to the gate. Calling it
with a context made by hand would put whatever it answers into a page anyone can fetch. So the
render's visitor is whoever the application's own gate says a request with no credentials is, and
a private read in a render is refused exactly as it is for that visitor's browser. A request with
no headers rather than the visitor's own request without its cookie, because a gate may read
identity from any header.

**A refusal is an answer, a failure is not.** A read refused to an anonymous visitor is what the
page shows that visitor, and the browser has to hydrate the same markup, so the refusal is recorded
and replayed. A read that failed is a page with a hole in it. A crawler that indexes it keeps the
hole, which is what a 200 with a missing part did in one application. 503 tells a crawler to come
back, and the shell mounts in a person's browser and asks again, so the person still gets the page.

**The same for a limit.** The shell is not the page, and a 200 with an empty body tells a crawler
the page is empty.

**The status comes from the page's head.** Only the page knows that `posts/:id` found no row. The
head list is where `noindex` is already read from, by the same winning rule, so a page inside a
layout overrides the layout. `http-equiv` is HTML's attribute for what a response header would say.

**404 sends the page, not the shell.** At a path nothing takes, the browser's own router shows the
fallback too, so the rendered fallback hydrates in place and a crawler with no script reads the
site's own not-found page.

**Recorded per key, once each, then dropped.** The browser runs the same page code with the same
URL, so it makes the same asks in the same order. The key sorts object keys because two ends that
build one object can still order its keys differently (design 302). Each answer is used once
because the hydration is the only thing it is for: a later ask with the same arguments wants fresh
data, which is why the rest go when the hydration settles.

**A share never arrives, and says so.** A render has no link. In the browser, a shared document has
not arrived when the page first renders either, so a page that renders its waiting state hydrates
against markup showing the same state. `ready` rejects rather than never settling, because a render
that waits on a promise that never settles never ends, and holds its place among the `renders` for
as long as the process lives.

**No query for the visitor nobody knows.** A gate may read a credential from the query, a token
in a link, as readily as from a cookie; the render's visitor gets the path alone.

**The defaults.** 16 renders in flight, because each one holds a whole page and its answers in
memory until it is written, and with no queue the cap is also how many visitors arrive at once
before one gets the shell. Ten seconds is far past what a render that reads a store needs. Both are
options.

## What this costs

The application names each read twice, in `deps` and in `modules`, and passes its gate a second
time. A different gate there is the render's rule.

A render runs no `connection` hook and emits no `observe` event. A read whose `call` relies on
state a connection set up fails, and the request is 503. The logs battery sees no ask a render made.
An ask's `timeout` option is not read in a render; the render's own limit is.

A page that waits on a shared document is answered with the shell. A render that waits on
anything else that never settles keeps its place for good: after `renders` of them, every page on
the site is the shell until the process restarts. The cap bounds memory; it cannot also keep the
site rendering.

A gate that reads identity out of the page's path itself sees it in a render too.

It renders one language. `createSite`'s `locale` and `locales` are not options here.

It answers every path that is not a file, so another module that answers `request` (uploads) has to
load before it, and `static/Files` after it.

Every request renders. A cache is the application's, in front of the process.

## Evidence

`packages/ssg/tests/pages.test.ts` drives the module through `createServer` on a real port: a page
with its answers in the head; a private read refused by the gate in a render for a signed-in
request and for a token in the query, recorded, and the page still 200; the refusal's message equal
to the one a client reads over a socket from the same server; a refusal the module threw recorded
whole; the status meta winning, and a status out of range answered 500; a path nothing takes, and
one a key only starts, 404 with the fallback page; a failed read and a name not handed over, each
503 with the shell, caught or not, with the server still answering; a page that waits on a share
answered with the shell; a file and a POST declined; `HEAD` with no body; two asks with one key
recorded in the order they were made; progress until the answer, and a handler that throws; the
time limit and the renders cap each answering the shell, and the place held until the render ends;
a shell, options and a module with no `call` refused when the module is made. `packages/ssg/tests/replay.test.ts` replays each
answer once, in order, keys arguments through JSON with sorted keys, rejects a refusal with its
reasons, hands everything else to the client, takes a page `createPages` rendered over with no ask
reaching the client and every element adopted, and drops what the hydration left.
`recipes/pages-on-request` renders a site per request, takes a post over in Chromium, and asserts
that no ask reached the server over the socket, no element the server wrote was removed or
replaced, no box moved, and the next navigation asked the server once.

## What would reverse this

A server API that lets a module ask another module through the gate, which would replace the
`gate` and `modules` options. A measurement on a real application that puts the defaults somewhere
else. An application that needs request-time pages in more than one language.
