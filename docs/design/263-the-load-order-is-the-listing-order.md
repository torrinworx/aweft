# 263: The load order is dependency order, and then the order the sources listed the modules

Amends designs 061 and 062, and makes the sentence in design 248 about source order true.

## Decision

A loader instantiates a set of modules in dependency order, every module after everything it
depends on, and breaks every tie by the order the modules were listed: the position of the
source in `sources`, then the position of the candidate in that source's listing. Nothing
about a module's name decides where it loads.

A module that is in several sources (an application's file that only configures it, and the
battery's file that implements it) takes the place of the candidate that implements it. So a
configuration file never moves a module in the load order, and an application's override of a
battery module, which is an implementation in the application's own source, loads where the
application's modules load.

A document source lists its entries sorted by name, the way a directory source lists its walk
sorted, because two replicas of one document can hold its keys in two orders and a listing has
to be the same on both. Within one source the source decides its listing; across sources the
application decides, by the order it wrote them.

`loaded()` is still the order the factories finished, which is this order for one `load` and
appends for the next.

## Why

The loader broke ties by name, sorted, which was deterministic and meant nothing. It was written
as a requirement, "the same whatever order the sources listed them", with no reason recorded
beyond determinism, and the order the sources are listed was already the rule for precedence
(design 062): the first source with a factory wins the name. Precedence and load order were two
different answers to one question, which source comes first.

The order is visible. A server runs `connection` hooks, `observe` hooks and the fallthrough
`request` walk in load order (designs 072, 248, 260), and the fallthrough walk is where it
matters: the first module to answer a request no route matched is the request's answer, and a
module that answers everything (`static/Files`, design 249) has to be walked last. Under the
name rule `static/Files` was walked before `uploads/Serve` in every application, with no lever
to change it, and design 248's text said a lever existed. Under this rule the lever is the one
the application already holds: `sources: [own, uploads, files, auth]` walks in that order.

The implementing candidate ranks the module, because an application configures a battery's
module by writing a same-named file that exports only `config`, and that file sits in the
application's own source, which is first. Ranking by the first candidate would move every
configured battery module to the front and put `static/Files` back ahead of `uploads/Serve`
the moment an application configured it.

Determinism is kept, restated: the same sources in the same order give the same load order,
every time. A directory walks sorted, a bundle lists in the order its map was written, a
document lists sorted.

## What this costs

An application that lists sources in a different order gets a different load order, which is
the point, and which a module could come to depend on without saying so. A dependency is
still the only way to say "after that one"; the listing breaks ties and nothing more. A module
that must load after another names it in `deps`.

An application that rewrites its bundle map in a different key order changes its load order.
A bundler writes the map in a stable order, and the modules that care are the ones with a
`request` hook, of which an application has one or two.

## Evidence

`packages/modules/tests/internal.graph.test.ts`: `order` breaks ties by rank and not by name,
with a dependency still pulled first wherever it was listed; `resolve` ranks a module by the
candidate that implements it and not by one that only configures it.
`packages/modules/tests/behavior.modules.test.ts`: the load order is dependency order and then
the listing order, the same for the same sources every time, `zeta` listed first loading before
`alpha`; across three sources a module configured in the first and implemented in the third
loads in the third's place, with the first's configuration. `packages/uploads/tests/serve.test.ts`:
`uploads` listed before `static` serves a file, listed after it gets the 404 page. The server,
sandbox, static, health, logs, auth and uploads suites pass unchanged.

## What would reverse this

A source whose listing cannot be made stable, which would need a rank the source declares
rather than its position. A second thing the application needs to order that a listing cannot
express, such as one battery module ahead of another battery's while the rest stay, which
would be a declared word on the module.
