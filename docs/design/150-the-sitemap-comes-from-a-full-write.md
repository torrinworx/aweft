# 150: The sitemap comes from a full write

## Decision

`site.write()` with no list walks the site, writes every page, `404.html` and `shell.html`, and
then writes `sitemap.xml` when the site was made with a `base`. `site.write(urls)` with a list
writes those pages and touches nothing else: no walk, no 404, no shell, no sitemap.

A page whose head carries a `robots` meta whose content holds `noindex` is written as a file and
left out of the sitemap. The 404 is never in it. With no `base` there is no sitemap at all, and
the result says so rather than writing a file with relative URLs in it.

Whether a page is noindex is read off the render's head list, not off the HTML: the winning
`robots` tag is the deepest and then the latest, which is design 127's rule and the same rule
`markup()` applies.

## Why

A list is what a running application has. A post is published, one page changes, and rewriting the
whole site to learn that is the difference between a write that happens inside a request and one
that does not. So the list has to be the cheap path, and a sitemap cannot be part of it: a sitemap
is a statement about every page, and one built from a single-page write would drop the rest of the
site.

That leaves a full write as the only thing that can produce a correct one, which is fine, because
a full write is what a build does and what a scheduled refresh does. A site that publishes pages
through `write(urls)` all day and runs `write()` nightly has a sitemap that is at most a day
behind, and the alternative, reading the existing `sitemap.xml` back and merging into it, would
make `ssg` the owner of a file it did not write and cannot verify.

## What this costs

A page published between two full writes is live and not in the sitemap. The application decides
whether that matters and can run a full write whenever it does.

## What would reverse this

A sitemap large enough that a full write is not affordable, which would want an index of sitemaps
and an append rather than a rewrite. Nothing measured here is near that.
