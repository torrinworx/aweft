# 248: A module may answer what no route matched

Amended by design 263: load order breaks ties by the order the sources are listed, so "its source
is listed first" below is a lever the application holds.

Amends design 072.

## Decision

A server module may carry a fourth optional hook beside `connection`, `call` and `routes`:

```ts
request?(request: Request, context: C): Response | undefined | Promise<Response | undefined>;
```

It runs for an HTTP request that no exact route matched. The gate's `identify` has already
run, as it does for every request. The server walks the loaded modules in load order, asks
the gate's `access` for each one that declares `request`, skips the ones it refuses, and
calls the rest in turn until one answers with a `Response`. That answer is the request's.
A hook that answers `undefined` has declined and the walk goes on.

When the walk ends with no answer, the request is 404, as it was before this hook existed,
with one exception: when at least one module was refused by the gate and none answered, the
answer is 403 carrying the first refusal's reasons, the same shape a refused route gets.

A hook that throws is 500 and reported under its module's name, as a route is, and the throw
ends the walk: no later module is asked, because a defect is not a decline. A hook that answers
anything that is neither a `Response` nor `undefined` is the module's defect too: 500, reported
as `not-a-response`.

Exact routes are unchanged. A route's key is still `METHOD /path` matched whole, two modules
still may not declare one key, and a matched route never reaches this hook.

## Why

Some answers are not a route. A directory of files has one URL per file and a rule for the
rest, and a route table keyed by exact path would need a row per file and could never say
"and everything under it". The rule belongs to the module that owns the files, and the
server's job is only to say when a request has fallen through to it.

The walk is in load order because load order is dependency order, which is the one order
the application already controls: a module that wants to answer before another depends on
it, or its source is listed first. A skipped refusal, rather than a 403 on the spot, lets a
public module answer under a private one that happens to be loaded first; the 403 at the
end keeps a private site from looking like an empty one.

`undefined` is the decline rather than a 404 `Response`, so that a module which cannot tell
whether a request is its own does not have to answer for every other module's.

## What this costs

One more hook the gate must be asked about per request that misses the route table, once
per module that declares it. A request that matches a route pays nothing new.

An application with two modules answering the same fallthrough gets the first in load order,
and nothing warns it. The route table refuses that case by name; this hook cannot, because
"the same request" is not knowable from a declaration.

## Evidence

`packages/server/tests/request.test.ts`: a request no route matched reaches the hook with
the gate's context; a matched route never does; two modules in load order, the first
declining and the second answering; a refused module skipped and a later one answering; a
refused module and no answer is 403 with the reasons; no module declaring the hook is 404 as
before; a throw is 500, reported under the module's name, and asks no module after it; a
non-Response answer is 500 and reported as `not-a-response`; the hook runs for HEAD and for any
method.

## What would reverse this

A second module type that needs a fallthrough with a different order than load order, or a
need to name which module answers a fallthrough at `start()` so a conflict can be refused
early. Either turns the hook into a declared pattern on the route table, which design 072
chose not to have.
