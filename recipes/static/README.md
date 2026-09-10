# recipes/static

The site from `recipes/ssg`, built, written out, and then served by the stack's own server in the
same process. One program is the whole deployment: no second server in front of the first, and no
host configuration anywhere.

## See it

```
AWEFT_DEFAULT_H=@aweftjs/ui node --import @aweftjs/build/loader recipes/static/main.ts
```

That is also what the gate runs. It exits nonzero when any assertion fails. Three passes.

**The site, built and written out.** The client bundle is `recipes/ssg`'s, built through that
recipe's own config with the output sent to `recipes/static/dist`, so nothing here writes into the
directory that recipe owns. `createSite` is then handed the shell and the same page function, and
`write()` leaves nine pages, `404.html`, `shell.html` and `sitemap.xml`.

**The directory, served.** Two servers boot over it, each `createServer({ sources, gate, listener })`
with `files` in the sources and nothing else. Over HTTP the run asserts: a generated page is served
at its own URL with the stamp a hydration reads; HEAD carries the same headers and no body; a second
request with the ETag is 304 with no body; `/nope` is 404 and the page it shows is the fallback act;
a climbing path and a dot path are both 404; `sitemap.xml` is served as XML. The second server sets
`unknown: 'shell'` and answers that same `/nope` with 200 and the plain shell.

**Driven in Chromium.** A `MutationObserver` is installed with `addInitScript`, before the bundle
runs, and records every element removed or inserted under `<body>` once the parser has finished. A
deep link to `/posts/hello` hydrates with none of either: no element the server wrote is thrown
away, and none of the client's is put in. Then a link click changes the act and the document title,
`/nope` renders the fallback act at status 404, and the same URL from the shell server mounts live
and renders the same act from the URL.

## How it is put together

`modules/static/Files.ts` is the configuration file, and it is the shape to copy: a file named
after a module this application did not write, exporting `config` and no factory, in a source
listed before the battery. It sets `dir` and one `Cache-Control` prefix. `dir` is built from the
file's own URL rather than written as `dist`, because a relative path is resolved from wherever the
process was started.

The second server shows the merge rule doing its job: a bundle source carrying `unknown: 'shell'`
is listed ahead of the modules directory, so its `config` wins and the second server is the first
one with one word changed.

## What it does not do for you

**It keeps nothing in memory.** A hot page is read from disk on every request that does not carry
its ETag. An application that wants more puts a cache in front, which is a host's job.

**It compresses nothing and answers no range.** Seeking inside a video is not something this
serves.

**It does not stop you putting a host in front.** Nothing here changes what the generator writes,
so the same directory is still the thing any static host serves. Serving it from the process is the
option this adds, not the only one left.
