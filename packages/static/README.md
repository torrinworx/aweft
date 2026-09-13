# @aweftjs/static

The static battery: one server module, `static/Files`, that answers every HTTP request no route
matched with a file from a directory. It makes the process that runs your application the host
that serves your generated site, so a deployment is one server rather than two.

## Quickstart

```ts
import { createServer, open } from '@aweftjs/server';
import { node } from '@aweftjs/server/node';
import { fromDirectory } from '@aweftjs/modules/node';
import { files } from '@aweftjs/static';

const server = createServer({
	sources: [fromDirectory('./modules'), files],
	gate: open,
	listener: node({ port: 8080 }),
});

await server.start();
```

Its configuration is a file beside your application's own modules, exporting `config` and no
factory, exactly as any battery module is configured:

```ts
// modules/static/Files.ts
export const config = {
	dir: 'dist',
	unknown: '404',
	headers: { 'assets/': 'public, max-age=31536000, immutable' },
	public: true,
};
```

The defaults are `dir: 'dist'`, `unknown: '404'`, no cache header on any path (`headers: {}`) and
`public: true`, so a site in `dist` served to anyone needs no file at all. The cache rule above is
not one of them: no path carries a `Cache-Control` until you name a prefix.
`dir` is resolved from the working directory when the module is made. A `dir` that is not a
non-empty string, an `unknown` that is neither word, a `headers` value that is not a string, or
a `public` that is not a boolean is refused at load with reason `invalid-config`.

`public` is what a gate reads. Under `@aweftjs/auth`'s gate, `true` serves a reader with no
cookie and `false` answers 403 with the gate's reasons, which is a private site in one word.

## The URL rule, and there is no other

The path is decoded and the query dropped. **A path with a segment that is `..`, or that begins
with a dot, is not a file**: it gets the unknown answer, and the file at that path, if there is
one, is never served. What is left is resolved under `dir` and served as the first of these that
is a file:

1. the path itself
2. `<path>/index.html`

Otherwise the unknown answer: `404.html` from `dir` with status 404, or, when `unknown` is
`'shell'`, `shell.html` with status 200. When that page is missing too, the answer is 404 with no
body. `/docs` and `/docs/` are one page.

## How a file is served

**Methods.** GET and HEAD serve a file. Any other method over a file is 405 with
`Allow: GET, HEAD`; over a path with no file it gets the unknown answer, because a 405 there
would say the URL exists and what exists is the files' word.

**The body is a stream** over the file, never the file read whole, so a large bundle is not held
in memory for as long as the socket takes. HEAD carries the same headers and no body.

**Every answer carries `X-Content-Type-Options: nosniff`**: the file, the 304, the unknown page,
the bare 404 and the 405. A browser that guessed a file's type from its bytes could turn a text
file into a script, and this module serves bytes it did not write.

**`Content-Type`** comes from a table of the common web extensions kept in this package; the text
types carry `charset=utf-8`. An extension the table does not name, and a name with no extension,
is `application/octet-stream`. **`Content-Length`** is the file's size.

| Extension | What it answers |
| --- | --- |
| `.html`, `.htm` | `text/html; charset=utf-8` |
| `.css` | `text/css; charset=utf-8` |
| `.js`, `.mjs` | `text/javascript; charset=utf-8` |
| `.json`, `.map` | `application/json; charset=utf-8` |
| `.webmanifest` | `application/manifest+json; charset=utf-8` |
| `.xml` | `application/xml; charset=utf-8` |
| `.txt` | `text/plain; charset=utf-8` |
| `.md` | `text/markdown; charset=utf-8` |
| `.csv` | `text/csv; charset=utf-8` |
| `.svg` | `image/svg+xml; charset=utf-8` |
| `.png` | `image/png` |
| `.jpg`, `.jpeg` | `image/jpeg` |
| `.gif` | `image/gif` |
| `.webp` | `image/webp` |
| `.avif` | `image/avif` |
| `.ico` | `image/x-icon` |
| `.woff` | `font/woff` |
| `.woff2` | `font/woff2` |
| `.ttf` | `font/ttf` |
| `.otf` | `font/otf` |
| `.wasm` | `application/wasm` |
| `.pdf` | `application/pdf` |
| `.zip` | `application/zip` |
| `.mp3` | `audio/mpeg` |
| `.wav` | `audio/wav` |
| `.ogg` | `audio/ogg` |
| `.mp4` | `video/mp4` |
| `.webm` | `video/webm` |
| anything else | `application/octet-stream` |

**`ETag` and 304.** A weak `ETag` is built from the file's size and modification time, and it is
on every file, because it costs one `stat` the module already paid for. A request whose
`If-None-Match` carries it is 304 with the ETag, the cache header and no body. That header is read
by its own rule: it is a list, `*` matches whatever the file currently is, and each listed tag is
compared weakly, so `"5-1a2b"` and `W/"5-1a2b"` are one tag. The unknown answer carries no ETag:
one page answers every URL with no file, and an ETag off it would tell a reader their cached copy
of one URL is the answer for another.

**`Cache-Control`** is written only when a configured prefix matches the start of the path, and
the longest matching prefix wins. Prefixes are matched against the path with its leading slash
removed, so `assets/` matches `/assets/app.js` and `/assets/` matches nothing. A prefix of `''` is
the start of every path, which is how you set a default for the whole site. A page with no
matching prefix carries no cache header at all, because which paths carry a content hash in their
name is your bundler's choice and this module does not know your bundler.

## What it never decides

List a directory. Serve a dotfile. Follow a climbing segment. Compress. Answer a range. Rewrite
or redirect. Whether a URL exists, which the files decide. A cache policy of its own. Who may
fetch, which is the gate's. Whether to follow a symlink: a link inside `dir` pointing outside it
is followed like any other file, so what a link may reach is yours, decided by what you put in
the directory.

## Known limits

**One `stat` per request, and no cache in memory.** A hot file is read from disk on every request
that does not carry its ETag, and a path that is a directory costs a second `stat` for the index
fallback. An application that wants more puts a cache in front of the process, which is a host's
job.

**Two modules declaring `request` answer in load order.** The server asks each in turn and the
first `Response` wins (design 248). This module always answers, so anything that must answer
ahead of it is loaded ahead of it: name it earlier in `sources`, or have it `deps` on nothing this
module needs.

**A file added or removed while the process runs is seen on the next request.** Nothing here holds
a listing, so a page published a moment ago is served at once and a page deleted is 404 at once.

**A file truncated between the `stat` and the stream is sent short.** The `Content-Length` is the
size the `stat` read, and the reader gets fewer bytes than that under it, a cut-off body rather
than an error. Write a new file and rename it over the old one, which is what a build should do
anyway.

**Under `unknown: 'shell'`, a URL with no file is the shell with status 200 for any method**, PUT
and DELETE included, because a 405 there would say the URL exists and what exists is the files'
word. Only a path that names a file answers 405.

**A prefix of `''` matches every path**, which is the way to set one `Cache-Control` for the whole
site; a prefix spelled with a leading slash matches nothing, because the path it is matched
against has had its leading slash removed.

**`If-None-Match` is compared weakly and `*` matches**, per that header's own rule, so a reader
that stored `"5-1a2b"` gets its 304 from a file whose tag is `W/"5-1a2b"`.

## Proven by

[`packages/static/tests/files.test.ts`](https://github.com/torrinworx/aweft/blob/main/packages/static/tests/files.test.ts)
boots a real server on a real port and fetches from it: the exact file, the index fallback, a
trailing slash, the unknown answer in both settings and with the page missing, a climbing segment
and a dot segment getting that answer and never the file beside the directory, a `dir` that is not
there answering a bare 404 for a refused path and an ordinary miss alike, HEAD with the headers
and no body, 405 with `Allow`, the ETag and the 304 for `*`, for the strong spelling of the tag
and for the tag among others, `Content-Type` for a named and an unnamed extension, `Cache-Control`
for the longest matching prefix, for the empty prefix and absent otherwise, a file larger than one
stream chunk arriving byte-identical, and an invalid configuration refused at load. Over a
listener the test holds, so the answer is read as this module built it: HEAD carries no body at
all and a GET body is a stream that arrives in chunks.
[`packages/static/tests/surface.test.ts`](https://github.com/torrinworx/aweft/blob/main/packages/static/tests/surface.test.ts)
pins the one export.

[`recipes/static`](https://github.com/torrinworx/aweft/tree/main/recipes/static) builds the site
[`recipes/ssg`](https://github.com/torrinworx/aweft/tree/main/recipes/ssg) writes, serves it from
this battery, and drives it in Chromium: a deep link hydrates with no element the server wrote
removed or replaced, an unknown URL is 404 with the fallback page, the same URL under `unknown:
'shell'` is 200 and mounts live, HEAD and the 304 answer as they should, a climbing path and a dot
path are 404, and the sitemap is served as XML.

## Boundaries

An integrator: it may import anything, and nothing imports it. It reads `node:fs`, `node:path` and
`node:stream`, and has no third-party dependency of any kind. The rule it implements is
`design 249`; the hook it answers through is `design 248`.

## The design notes

A `design NNN` above is the note of that number in
[`docs/design/`](https://github.com/torrinworx/aweft/tree/main/docs/design), which says what was
decided, why, what it costs, and what would reverse it.