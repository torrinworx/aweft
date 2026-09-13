# 274: A drawing fetched at run time is refused when it can run

Amends design 143.

## Decision

`fromUrl` refuses an answer whose icon body can run or reach out: one that carries `<script`,
an attribute beginning with `on` and ending in `=`, `<foreignObject`, `javascript:`, or an
`href` or `xlink:href` whose value does not begin with `#`. The refusal is `unsafe-body`, naming
the icon, and the resolver throws it rather than answering null, so the page hears which source
refused and why rather than falling through to the next. A built-in set is read at build time
from an installed package and is not read here.

## Why

`ui`'s `Icon` writes the body into the group with `innerHTML` (design 144), because the paths
become ordinary child nodes a static render serializes and a hydration pairs. Inside an SVG
written that way a `<script>` element does not run, but an event attribute does, on the element
it sits on, when it is inserted; `<foreignObject>` carries HTML in; a `use` or an `image` with
an `href` reaches a URL. A body from an installed set was looked at when it was installed. A body
from a URL was not: `fromUrl` is exactly the resolver that makes the body somebody else's, and a
mirror of the icon API is a route an application runs, which can be wrong.

A list of what can run rather than a parser that rewrites the drawing, because a rewriting
sanitizer is a second SVG implementation with a surface of its own, and an icon that trips the
list is not one anybody wants drawn in another form; it is an answer to refuse.

## What this costs

A drawing that uses `<use href="#id">` passes; one that fills from `url(#id)` passes; one that
embeds an image from a URL does not, and the refusal says so.

## Evidence

`packages/icons/tests/from-url.test.ts`: each pattern named above is refused with `unsafe-body`
and the icon's name; a body with a `#` href, a `url(#id)` fill and plain paths passes.

## What would reverse this

An SVG parser in the stack for another reason, at which point the body could be walked rather
than matched.
