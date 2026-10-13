# 305: An exact stage takes a path whole

Amends design 122 (how an act path is matched).

## Decision

`StageContext` takes `exact`, a boolean, off unless it is set. Every stage below an exact stage is
exact too, unless it sets `exact={false}`.

In an exact stage:

- A key matches a path only when it takes every segment of it. `about` matches `/about` and not
  `/about/x`. `:name` and literal segments take one segment each, and `*name` takes the rest, as
  before.
- A key that ends in a bare `*` matches the path its other segments take, and parks the rest for
  the stage below (design 282). That is how an exact stage nests: `docs/*` is the act whose own
  stage answers `/docs/install`.
- A path no key takes whole shows the `fallback`, or nothing when there is none. `initial` is never
  shown for a path that was not matched; it is for a stage no URL decides.

Without `exact`, matching is exactly what it was: `about` still matches `/about/x` and parks `x`.

**The walk is unchanged.** It still reports an act whose key ends in a bare `*` as one it cannot
enumerate, so the pages under an exact site's `docs/*` stage are not written at build time unless
`write(urls)` lists them. Reading a bare `*` as no parameter would change what `write()` writes for
a site that never set `exact`, and nothing in the request-time render needs it.

## Why

A path that only starts with a page's key showing that page is a page at a URL the site never
meant to have, and request-time rendering (design 304) answers it with 200 and the wrong content.

Prefix matching cannot simply stop, because nesting is built on it. One application nests an admin
area's stage under a plain key, and this repo's routed-site recipe and the `ssg` suite each nest a
docs stage the same way. Each would lose every page under the nested stage.

A rule applied only to the status a server sends would leave the browser showing the About page at
`/about/x` under a 404: a person and a crawler would be told different things about one URL, and the
person still sees the page. A mode on the stage puts one rule on both ends, so the server's render
and the browser's agree and a 404 page hydrates.

The bare `*` already means "the rest is for the stage below", so an exact stage spends no new
syntax on nesting. Inherited because a nested stage that matched by prefix would bring the problem
back one level down.

`initial` is not a fallback in an exact stage because a stage that shows something at a path it did
not match is the same mistake one level down.

## What this costs

An application that turns it on rewrites every key that has a stage, or a routed child that claims
the tail, under it: `docs` becomes `docs/*`. A key it misses stops matching its deeper paths, and
those pages show the fallback.

An exact site that is also written at build time lists its nested pages for `write(urls)`, because
the walk does not follow a `*` key.

## Evidence

`packages/ui/tests/internal.route.test.ts` matches the same keys with and without `exact`.
`packages/ui/tests/stage.test.ts` mounts an exact stage at a path a key only starts, nests one under
`docs/*`, inherits it below and turns it off there, and shows nothing rather than `initial` for a
tail no key takes. `packages/ssg/tests/pages.test.ts` answers 404 at `/about/x` on an exact site.

## What would reverse the walk's part

A site that is exact and written at build time, whose nested pages are too many to list. Then the
walk reads a trailing bare `*` as no parameter, which is a change to what `write()` writes for every
site with such a key, and wants its own note.

## What would reverse this

An application that needs a nested stage under a key that also matches deeper paths without one,
under the same exact stage. That would need the act to say whether its tail is claimed before it
renders, which a stage cannot know until the act has mounted.
