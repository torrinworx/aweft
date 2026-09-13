# 249: The files battery

Amended by design 262: this module never declines a request, so a module that answers a path
under the same fallthrough, such as `uploads/Serve`, is listed before it in `sources`.

## Decision

`@aweftjs/static` is a battery: a source of one server module, `static/Files`, that serves
a directory of files through the hook of design 248. The package exports `files`, the
source, and nothing else. The module's instance carries `public` from its configuration,
true unless configured otherwise, so under the auth battery's gate an anonymous request is
served, and an application that sets that one word to false has a private site.

Its configuration, set the way any battery module is configured (a same-named file in the
application's own source exporting `config`, design 240):

```ts
export const defaults = {
	dir: 'dist',        // the directory, resolved from the working directory
	unknown: '404',     // what a URL with no file gets: '404' or 'shell'
	headers: {},        // Cache-Control by path prefix: { 'assets/': 'public, max-age=31536000, immutable' }
	public: true,       // what the gate reads; false makes the site private
};
```

A `dir` that is not a non-empty string, an `unknown` that is neither word, a `headers` value
that is not a string, or a `public` that is not a boolean is refused at load with reason
`invalid-config`.

**The URL rule, and there is no other.** The path is decoded before it is split and the
query dropped, so an encoded slash cannot smuggle a segment past the check. A path with a
segment that is `..`, or that begins with a dot, is not a file: it gets the unknown answer, and
the file at that path, if there is one, is never served. What is left is resolved under `dir` and
served as the first of these that is a file: the path itself; `<path>/index.html`. Otherwise the
unknown answer: `404.html` from `dir` with status 404, or, when `unknown` is `'shell'`,
`shell.html` with status 200. When that file is missing too, the answer is 404 with no body.
`/docs` and `/docs/` are one page. The unknown answer carries the page's type and length and
no `ETag` and no cache header, because one page answers every unknown URL and a tag off it
would tell a reader their cached copy of one URL is the answer for another.

**How a file is served.** GET and HEAD. Any other method on a path that names a file is 405
with an `Allow` header; on a path with no file it gets the unknown answer, because a 405
there would say the URL exists, and what exists is the files' word. The body is a stream over
the file, never the file read whole, and HEAD carries the same headers and no body.
`Content-Type` comes from a table of the common web extensions kept in the package, the text
types with `charset=utf-8`, and an extension the table does not name is
`application/octet-stream`. `Content-Length` is the file's size. A weak `ETag` is built from
size and modification time, and a request whose `If-None-Match` carries it is 304 with no
body. That header is read by its own rule and not one of this module's: `*` matches whatever
the file currently is, and every listed tag is compared weakly, so a tag spelled without `W/`
matches the same tag spelled with it. `Cache-Control` is written only when a configured prefix
matches the start of the path as spelled without its leading slash (`'assets/'`, not
`'/assets/'`); the longest matching prefix wins; a prefix of `''` is the start of every path and
is the way to set one value for the whole site; a page with no matching prefix carries no cache
header at all.

**What it never does.** List a directory. Serve a dotfile. Follow `..`. Compress. Answer a
range. Rewrite or redirect. Decide whether a URL exists, which the files decide. Decide a
cache policy of its own. Decide who may fetch, which is the gate's. Decide whether to follow a
symlink: a link inside `dir` that points outside it is followed like any other file, so what a
link may reach is the operator's, settled by what goes in the directory.

## Why

A generated site is a directory whose layout every static host serves without configuration,
and the one thing the stack could not do was be that host itself, so an application had to
put a second server in front of the first. This module makes one process the whole deployment
while keeping the option of a separate host, because nothing here changes what the generator
writes.

The unknown answer is 404 by default and shell by choice, because a site whose every page was
enumerated should say "not found" with the status that means it: a 200 on every mistyped URL
is a page search engines index and readers bookmark. A site with pages only the client can
render says so in its configuration and gets the shell for them.

The cache header is configured by prefix and has no built-in rule, because which paths carry a
content hash in their name is the bundler's choice and this module does not know the bundler.
The ETag is always there because it costs one `stat` the module already paid for, and it turns
a repeat visit into headers alone without any application deciding anything.

The MIME table is kept here rather than taken from a dependency because the stack's server has
one runtime dependency, its WebSocket implementation, and a table of thirty lines is not a
reason to add a second.

## What this costs

One `stat` per request, and a second for the index fallback when the path is a directory.
Nothing is cached in memory, so a hot file is read from disk on every request that does not
carry its ETag; an application that wants more puts a cache in front, which is a host's job.

A file added to `dir` while the process runs is served on the next request, and a file removed
is 404 on the next request, because nothing here holds a listing.

A file truncated between the `stat` and the stream is sent short: the `Content-Length` is the
size the `stat` read, and the reader gets a cut-off body under it rather than an error. Writing a
new file and renaming it over the old one is the way around that, and is what a build does anyway.

The module reads the disk for every request the route table missed, including requests for
paths that could never be files, because it cannot know which those are.

## Evidence

`packages/static/tests/files.test.ts`, through a server with the node listener: the exact
file; the index fallback; a trailing slash; the unknown answer in both settings and with the
file missing; `..` and a dot segment getting the unknown answer and never the file beside the
directory; a `dir` that is not there answering a bare 404 for a refused path and an ordinary miss
alike; HEAD with the headers and no body; 405 with `Allow`; the ETag and 304, for `*`, for the
strong spelling of the file's own tag, for that tag among two others, and 200 for a different one;
`Content-Type` for a named and an unnamed extension; `Cache-Control` for the longest matching
prefix, for a prefix of `''` under every path, absent where none matches and absent for a prefix
spelled with a leading slash; a file larger than one stream chunk arriving byte-identical; an
invalid configuration refused at load. Over a listener the test holds rather than a port, where
the answer is read as the module built it: HEAD carries no body at all, and the body of a GET is a
stream whose first chunk is smaller than the file. `packages/static/tests/surface.test.ts`
pins the one export. `recipes/static` serves what `recipes/ssg` writes and drives it in a
browser: a deep link hydrates with no element replaced, an unknown URL gets the fallback act's
page with status 404, the same URL under `unknown: 'shell'` mounts live.

## What would reverse this

A generated site whose layout needs a rule this one cannot express, such as a page at a URL
with an extension in it, or a need for range requests for media. The first changes the rule;
the second adds a capability the note above says is refused, and needs a note of its own.
