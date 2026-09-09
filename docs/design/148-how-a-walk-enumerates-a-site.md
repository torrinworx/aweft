# 148: How a walk enumerates a site

## Decision

`site.walk()` renders `/`, reads the render's stage list (designs 126 and 145), and turns every
declared act into a URL. It renders each URL it has not rendered yet and repeats until a render
adds none. It answers the URLs it found and the acts it could not enumerate.

The rules, in the order they apply to one act:

| what the act key is | what the walk does |
|---|---|
| a plain key, no `entries` | one URL: the key under its stage's prefix |
| a plain key with `entries()` | the same one URL, unless `entries()` answers `[]`, which writes nothing |
| a key with `:param` or `*rest` and `entries()` | one URL per answered object, its values put in place of the names |
| a key with `:param` or `*rest` and no `entries` | no URL. The act is reported as unenumerated |

**The prefix is the stage's, not the pattern's.** Design 126 gives a nested stage the path its
parent actually matched, so an act declared `:page` inside a stage that matched `posts/3` is
`posts/3/:page` and never `posts/:id/:page`.

**The stop condition is that a render added no URL.** A nested stage exists only while the act
holding it is mounted, so the URLs under it are unreachable until the parent page has been
rendered once. The walk is a queue: render, add what is new, take the next.

**A URL is one string.** `/docs` and `/docs/` are the same page, because the matcher strips the
slashes either way, so the walk normalises every URL to a leading slash and no trailing one before
it decides whether it has seen it.

**The fallback is rendered at a URL nothing matches.** The registry entry does not say which act
is the fallback, and it does not need to: rendering a path the site declares nothing for is what
puts the fallback on the page. That page becomes `404.html` and its URL is not one of the site's.

**An `entries()` that answers nothing writes nothing.** An empty answer is a site saying it has no
posts yet, not a site that failed to say.

## Why

The walk starts from a render because the alternative is reading the source, which means a second
matcher living in a build tool and drifting from the one the page runs. Design 126 built the
registry for exactly this.

Rendering the fallback at an unmatched URL rather than by naming the act keeps `ssg` out of the
stage's business: the 404 is whatever the site puts on a page nothing matched, which is the same
thing a host serving `404.html` will show.

An unenumerated act is reported rather than fatal, and an application that wants the build to stop
fails on the report: a site with a page per database row is normal, and a build tool that refuses
to finish because it cannot see the database is not.

## What this costs

Every declared act becomes a page, including one the application only ever reaches through
`open()`. A dialog declared as an act is written out as a page of its own. That is the honest
reading of "declared act": nothing distinguishes an act meant for a URL from one meant for an
`open`, and inventing a marker for it would be a new concept the application did not ask for.

A walk renders each page twice in the worst case: once to discover what is under it, and once more
for anything a later round adds. In practice a page is rendered once by the queue and once by
`write`.

## What would reverse this

A site whose stages appear only after user interaction rather than on a render, which would leave
the walk unable to see them at all and would need the acts declared somewhere a walk can read
without rendering.
