# 152: A stage entry says which act is its fallback and which act is showing

Amends design 126.

## Decision

The registry entry design 126 describes gains two read-only fields:

| name | what it answers |
|---|---|
| `fallback` | the act shown when nothing matched, by name, or null when the stage names none. What `StageContext` was given as its `fallback` prop |
| `current` | the act showing now, by name, or null when nothing is. Read on every ask rather than captured, so a caller that renders a URL and then reads the entry learns what that URL showed |

Two rules follow, and both are `ssg`'s:

**The fallback act is not a page.** A walk writes no file for it and it is in no sitemap. The
fallback is what a URL nothing matches shows, and that page is written once, as `404.html`.

**A URL that leaves a stage showing its fallback, or showing nothing, is refused.** `site.page(url)`
and `site.write(urls)` throw `not-a-page` naming the URL, the stage's prefix and what it was showing.
The one render that is allowed to end that way is the internal one behind `404.html`.

## Why

Both are the same defect seen from two sides, and no test caught either. Without `fallback`, the
walk read `missing` as an ordinary act and wrote `missing/index.html`, so the generated site had a
page titled "Not found" at a URL it told search engines about in its own sitemap. Without
`current`, `write(['/typo-in-a-slug'])` wrote the fallback page at that path and said nothing, and
that call is exactly what an application makes from inside a request: a publish with a typo in it
published a 404 as a page.

Both need something only the stage knows. `ssg` cannot work either out: the matcher is `ui`'s, the
fallback is a prop `StageContext` was given, and re-deriving them in a build tool is the second
implementation of the matcher that design 126 exists to avoid.

`current` is a getter rather than a captured value because the entry outlives the render that made
it (design 145), and a walk reads it after the call has returned.

## What this costs

Two more names on `ui`'s surface for a package that has not shipped yet, which is the cost design
126 already accepted for `entries`. `current` is also the first field on the entry that is not
fixed for the life of the stage, so two reads of one entry can differ; the block comment says so.

A site whose fallback act is also reachable at its own URL, a `/not-found` page somebody links to,
no longer gets that page written. It declares the act twice, under the name it wants as a page and
under the name it names as the fallback.

`not-a-page` sees exactly as much as the routing does. An act declared `posts/:id` matches any id,
so a slug naming no row is a page as far as this check is concerned, and what that page shows is the
act's business. An application that knows which rows exist checks before it writes, which is what
`recipes/posts-to-pages` does.

## What would reverse this

An application wanting the fallback written at its own key as well, which would make the skip an
option rather than the rule. Nothing has asked; declaring the act twice is the answer today.
