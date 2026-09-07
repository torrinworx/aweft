# recipes/ssg

A routed site written out as files, served by anything that can serve a directory, and taken over
in place when the reader's browser gets to it.

## See it

```
npx vite recipes/ssg
```

That is the development server: the shell with an empty body, the page mounted live. Click around;
nothing here is generated yet.

## What the gate does with it

```
AWEFT_DEFAULT_H=@aweftjs/ui node --import @aweftjs/build/loader recipes/ssg/main.ts
```

It exits nonzero when any assertion fails. Four passes.

**The client bundle.** `vite build` through `aweft({ defaultH: '@aweftjs/ui' })`, which leaves
`dist/index.html`: the shell, with the module script in its head and nothing in its body.

**Every page, written out.** `createSite` is given the shell, the output directory, the site's
absolute URL, and one function that builds the page from a router. `write()` renders `/`, reads the
stage list, turns every declared act into a URL, renders each new one until none appear, and writes
`<url>/index.html` per page, `404.html`, `shell.html` and `sitemap.xml`. Nine pages, twelve files.
It then asserts: the files exist and nothing else does; the fallback act has no page of its own;
the sitemap has the root and a post and does not have the page whose head says `robots noindex`,
the fallback, or an act nothing enumerated; `404.html` carries the fallback act's own title;
`shell.html` is the shell byte for byte, with no stamp on it.

**One page at a time.** `write(['/posts/second'])` into a fresh directory writes that page and
nothing else, and no sitemap, because a sitemap is a statement about every page. This is the call a
running application makes when it publishes something; `recipes/posts-to-pages` is that application.
The same pass asks for a slug the site has no page for and gets `not-a-page` back, which is the
failure that call is one typo away from.

**Driven in Chromium.** The directory is served with `node:http` and the pages are driven. A
`MutationObserver` is installed with `addInitScript`, before the bundle runs, and records every
element removed or inserted under `<body>` once the parser has finished. A deep link to
`/posts/hello` hydrates with none of either: no element the server wrote is thrown away, and none
of the client's is put in, because this page has no popup sink and its live region is part of the
markup the server already wrote. Then a plain `onClick` on that page answers a real click, a link
click changes the act and the document title, `/404.html` carries its title, and `/tags/rust`, the
URL nothing could enumerate, is served the plain shell and mounted live.

The same run prints what a hydration costs: the number of `document.createElement` calls between
the entry's two performance marks, and the milliseconds between them. Those numbers are what
any change to the bookkeeping of a hydration is measured against.

## How it is put together

`page.tsx` is the whole page: the routed site from `recipes/routed-site`, imported rather than
copied, with a banner above it. The site's two parameterised acts declare `entries()`, its
`tags/:tag` act does not, and `dialog` is an act nothing links to.

`banner.tsx` is the file that binds no `h` at all. The bundler is told which package gives it one
in `vite.config.ts` and this process is told the same thing in `AWEFT_DEFAULT_H`, so both compile
it against `ui`'s `h` and `theme="nav"` becomes a generated class on both sides. Told nothing, a
Node process compiles it against `dom`'s instead, `theme` is written out as an attribute nothing
reads, and the hydration finds the two documents disagreeing.

`entry.tsx` is what the browser runs, for a generated page and for the plain shell alike. It calls
`attach`, which reads `data-aweft-ssg` off the body: present, the page is hydrated in place;
absent, it is mounted.

## What it does not do for you

**It does not decide where page data comes from.** `entries()` and the components read whatever
they read. This site knows its posts because they are a list in a file; a real one asks a store.

**It does not host anything.** The `node:http` server here is twenty lines and exists so the run
has something to point Chromium at. A real host serves the directory: the exact file, then
`<path>/index.html`, then `shell.html` for a URL only the client can render, then `404.html`.
`server`'s routes are exact, so serving a directory through it would be a route per file, and a
`static` battery is its own step.

**It does not fail the build for an act it could not enumerate.** `tags/:tag` is reported in
`write()`'s result and the live shell answers those URLs. An application that wants a build to stop
there reads the report and stops.

**Every declared act is a page except the fallback**, including one only ever reached with
`stage.open`. `dialog` is written to `dialog/index.html`; `missing`, which the stage names as its
`fallback`, is written once as `404.html` and nowhere else. Nothing tells an act meant for a URL
from an act meant for an `open`, so a page you do not want found says so in its head, as this one
does, and the sitemap leaves it out.

**Put no `<title>` in your page shell that you want to keep.** A page that declares one has the
shell's removed, so the document a crawler reads carries exactly one.

**Keep your shell's `<body>` empty.** The page's markup is what goes in it, and a hydration refuses
anything else it finds there. A bundler puts its module script in the head, which is where it has
to stay.
