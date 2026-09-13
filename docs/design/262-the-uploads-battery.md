# 262: The uploads battery

Amends design 249: `uploads/Serve` loads before `static/Files`, which never declines.

## Decision

`@aweftjs/uploads` is a battery: a source of three server modules that take a file from a page
or a module, keep its bytes in a directory or an S3-compatible bucket and its record in the
application's store, and serve it back at `/files/<id>`; a client half that posts a file with
progress; two adapters; and readers any process imports. The application's rules go in through
configuration: which types, how large, what a file must pass before it is kept, who may read
one, and who may upload.

**The server modules**, configured the way every battery module is (design 240):

- `uploads/Files` is the keeper. It holds the storage adapter, mints ids, and writes and reads
  `upload:<id>` documents. To a module that names it in `deps` it offers `put(bytes, { name,
  type, size, user, meta })`, the trusted path, which runs no rule (bytes in hand, or a stream
  with its size, because a bucket asks for the length up front); `get(id)`; `open(id)`, the
  record with a stream over the bytes; and `remove(id)`, bytes first and then the record, so a
  record whose bytes are already gone is still removed and a crash between the two leaves a
  record `remove` finishes next time rather than an orphan nothing names. `receive(stream, {
  name, type, size }, context)` is the checked path `uploads/Receive` walks: it is the same
  `put` after the rules. Configuration and defaults: `storage` (an adapter; `directory('uploads')`
  under the working directory when unset), `types` (`image/png`, `image/jpeg`, `image/gif`,
  `image/webp`), `maxBytes` (10 MiB; one number, or a map by MIME family `{ image, audio,
  video, default }` so a site takes small pictures and large recordings through one route),
  `accept` (a function, none by default). A value of the wrong type is refused at load with
  `invalid-config`.
- `uploads/Receive` answers `POST /api/uploads`. It declares no `public`, so under the auth
  battery's gate it needs a signed-in user, and `public: true` in its configuration opens it.
  The body is the file's bytes, `Content-Type` is the file's type with its parameters
  dropped, and `X-Upload-Name` is the name, percent-encoded UTF-8; absent means no name. Before
  a byte is stored: a type not in `types` is 415, a declared length over the family's cap is
  413, no `Content-Length` is 411, a name that does not decode is 400. The first bytes are read
  and matched against the declared type for the types the sniff table knows (png, jpeg, gif,
  webp, pdf, mp4, webm, ogg, mp3, wav, flac); a mismatch is 415 before anything is written, and
  a type the table does not know keeps its declared type. Then the body streams into storage
  while it is counted and hashed: over the cap it is cut and the object removed (413), and a
  body that ends short of its declared length is removed too (400). Then `accept`, then the
  record, then 201 with the record as JSON. In-flight uploads are counted and one over
  `concurrent` (16) is 429. Every refusal is JSON `{ reasons: [{ code, message }] }`.

  A refusal reads and discards what is still arriving, up to twice the family's cap and at
  least a mebibyte, before it is answered; past that the body is cut. A proxy that streams the
  body forward (the dev server's) and a browser mid-send both need the answer to arrive on an
  open socket, or the person sees a network error where the reason should be. The gate's own
  403 for an anonymous post is the server's and reads nothing, which is what keeps an
  anonymous body from costing anything. A sender whose socket fails mid-body is 400
  `incomplete`; an adapter that fails is the module's failure, thrown as it was, 500 and
  reported, never dressed as a refusal. A store that refuses the record takes the bytes with
  it, so no object is left that nothing names. A name is kept to 255 code points.
- `uploads/Serve` answers `GET` and `HEAD /files/<id>` through the hook of design 248,
  `public: true` unless configured otherwise, with `allow(upload, context)` in its configuration
  for a per-file rule: nothing means allowed and reasons mean 403. An id is one path segment of
  URL-safe characters; any other path, and an id that names no record, is declined so the next
  module answers. Another method on a live id is 405 with `Allow`. The answer streams from the
  adapter with `Content-Type` from the record, `Content-Length`, a strong `ETag` that is the
  sha256 (an id never changes content, so the tag is the content), 304 on a matching
  `If-None-Match`, `Cache-Control: public, max-age=31536000, immutable`,
  `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox`, and
  `Content-Disposition: inline` carrying the record's name. A record whose bytes are gone, or
  whose key is outside the key rule and so names no bytes, is 404 with no body, for HEAD as
  for GET. HEAD carries the headers and no body.

**The adapter.** `{ put(key, stream, { type, size }), open(key), head(key), remove(key) }` over
opaque keys of letters, digits, `_` and `-`, at most 128 of them; `keyOf` on the root is the
rule, and a key of any other shape is refused with `invalid-key` before it reaches a path or a
URL. `remove` on the keeper still takes a record whose key is outside the rule, since there are
no bytes to take first. `directory(path)` ships on the root: one file per key under
`path`, written to a temporary name beside it and renamed over, so a reader never sees a
partial file and a put that fails leaves nothing. `s3(options)` ships on
`@aweftjs/uploads/s3`: `{ endpoint, region, bucket, accessKey, secretKey, prefix }` (the prefix
letters, digits, `_`, `.`, `/` and `-`, so it can never become a query), requests
signed with Signature Version 4 using Node's own `crypto` and sent over Node's own `http`, so a
put carries its `Content-Length` with a streaming body, the payload unsigned so the bytes are
read once. No dependency and no peer. The adapter type
is exported so an application writes its own, and `adapterChecks()` on `@aweftjs/testing`
proves one the way `driverChecks` and `listenerChecks` do.

**The rule hook.** `accept(upload, context)` runs after the bytes are in storage and before the
record is written. `upload` is `{ id, name, type, size, sha256, user }` and `bytes()`, which
reads them back from storage. Nothing means accept; `{ reasons }` means refuse, and the bytes
are removed and the reasons answered with 422. A throw is the module's defect: 500, reported
under `uploads/Receive`, the bytes removed. Moderation, a manifest check, a quota all live here
and none ships.

**The client half.** `createUploads(options?)` answers `{ upload(file, options), url(id) }`.
`upload` posts one file over `XMLHttpRequest`, because `fetch` reports no upload progress in
every browser; `progress(fraction)` is called as bytes leave, `signal` aborts, `name` and
`type` override the file's own. It resolves to the record and rejects with the status and the
reasons. Credentials are the page's own cookie on its own origin. It never touches the socket.
Options: `origin` (the page's own by default) and `request`, a seam a test hands its own
`XMLHttpRequest` through.

**What is stored.** `upload:<id>`: `kind`, `user`, `name`, `type`, `size`, `sha256`, `at`,
`storage` (the adapter's name and the key), `meta` (what `put` was handed, plain data). An
ordinary document; the battery truncates its own documents' tails to nothing, since nothing
replays them. The id is the record's name and may be any text the key rule takes, so a script
that records objects already in a bucket under such keys writes their records through the
store, and `Serve` finds them; an object under another kind of key is copied first. `paths` declares `kind`, `user`, `sha256`, `type` and `at` for
the application's store.

**The readers**, exported from the root for a script, a harness or a job: `upload(store, id)`
answers one record as plain data; `records(store, { user, sha256, type, since, limit })` lists
them newest first. The source is `uploads`, so the list reader is not.

**The order rule, amending design 249.** `static/Files` answers every request that reaches it,
with a file or with the unknown page, and never declines. `uploads/Serve` declines what is not
its own. So in `sources` the uploads battery is listed before the static one, and the server
walks it first, because load order follows the listing (design 263); listed after, every
`/files/<id>` is the 404 page, or the shell with status 200 under `unknown: 'shell'`, and an
`<img>` gets HTML.

**What it never does.** Decide who may upload beyond the gate's word and `accept`. Decide who
may read beyond `public` and `allow`. Delete over the wire: no route, because the uploader is the
wrong owner in most applications (a listing's image belongs to the listing) and under the open
gate there is no uploader. Expire anything: no sweep. Index, tag, dedupe, resize, strip
metadata, transcode or thumbnail. List a directory. Answer a range. Redirect to a CDN. Read a
storage setting from the environment: the adapter is configured, and the application reads its
own environment. Store an address.

## Why

Every application on the stack takes a file from a person or an agent and shows it back, and
each one wrote the same three things: a page helper that posts a file, a route that checks type
and size and writes bytes, and a server for `/files/<id>` that reads the type off a record
because the object has no extension. This is that join, once, with the rules an application
actually varied (types, caps by family, a check before the record, who may read) as
configuration rather than a fork.

The body is one file as raw bytes rather than a multipart form, because the listener hands a
route a streaming `Request` and the gate runs `access` before the handler touches the body
(design 248, and `packages/server/src/server.ts`), so an anonymous body is refused before it
is read and a signed-in one streams to storage without a parser and without being held in
memory. A multipart body would be parsed whole in memory by `Request.formData()`, which is the
shape that let an anonymous caller fill a heap in an earlier stack. The client half ships, so
the shape is the battery's own and a page never spells it.

The bytes land in storage before `accept` rather than being held for it, so memory stays flat
whatever the cap, and a moderation hook that needs the bytes reads them back. A refusal costs
one put and one remove, which is the rare case.

Serving carries `nosniff` and a `sandbox` policy because a file a person uploaded is served
from the application's own origin, and a browser that guessed a type or ran a script inside an
SVG would run it as the application. The default types are four image formats for the same
reason: a default that took anything would serve HTML from the origin.

`ETag` is the sha256 rather than size and time, because an id never changes content, so the
hash is the content and the tag is strong for free. `Cache-Control` says `immutable` for the
same reason.

No delete route and no sweep, because both are policies the applications disagreed on: whose
file it is, and when nothing references it, are the application's to know. `remove` and the
readers are the tools; the rule is the application's module.

S3 signing is written here rather than taken from a dependency, because the stack's server has
one runtime dependency and the four calls this adapter makes need one signing function that the
published test vectors pin.

## What this costs

An upload holds the request open until the bytes are in storage and `accept` has answered; a
slow adapter is a slow upload, and `concurrent` is what keeps the process from holding more
than it can. A refused `accept` costs a put and a remove. A refusal drains up to twice the cap
off the socket so the answer lands, which is bandwidth and never memory; the drain has no
clock of its own, so a sender that stalls holds its slot until the listener's request timeout.

A served file streams through the process, so a page that plays a 25 MB stimulus pulls it
through the box each time; an operator who wants a bucket's own edge to serve `/files/` puts
it in front, and the route is then never reached. A hot file is read from storage on every
request that does not carry its ETag; nothing is cached in memory.

The record and the bytes are two writes with no transaction across them. `receive` writes the
bytes first and the record last, so a crash leaves an object nothing names, which the adapter's
own listing finds and nothing here removes.

The sniff table knows eleven types. A declared type outside it is trusted as declared, and
`nosniff` plus `sandbox` are what keep that from becoming a script.

A name is kept as the person gave it, bounded at 255 characters; nothing here decides what a
name may say.

## Evidence

`packages/uploads/tests/`: `files.test.ts` (put, get, open, remove in order, `invalid-config`
for each setting, the family caps), `receive.test.ts` (through a server with the harness
listener: 201 with the record and the file served back; each refusal by status and code with no
object and no record left; the sniff; the length that lies both ways; `accept` refusing and
throwing; the concurrent cap; anonymous under the auth gate refused before the body is read),
`serve.test.ts` (headers, 304, HEAD, 405, decline on a wrong path and a missing record, `allow`,
`public`, bytes gone), `directory.test.ts` and `s3.test.ts` (the adapter suite; the signing
vectors, with the signature and the string to sign copied from the published suite; a real
bucket when the environment names one), `client.test.ts` (through a fake request object:
headers, progress, abort, the refusal's status and reasons), `readers.test.ts`,
`surface.test.ts`. `recipes/uploads` drives a page in Chromium through the full-stack shape:
a signed-in page uploads a png from `FileDrop` and the image paints from `/files/<id>` with the
headers above; an anonymous post is refused before its body is read; each refusal; a module's
`put`; `remove`; `allow`; the order rule against `static/Files`.

## What would reverse this

A file too large to hold in storage twice or to stream through the process, which is a
resumable upload and a redirect to the bucket's own URL, both new notes. A signing case the
vectors and a real bucket cannot settle, which is the SDK as an optional peer under design 140.
A delete route with an owner rule, or an expiry, each a note of its own.
