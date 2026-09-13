# @aweftjs/uploads

The uploads battery: a file from a page or a module, kept as bytes in a directory or an
S3-compatible bucket and as a record in the application's own store, served back at
`/files/<id>`. The rules an application varies (which types, how large, what a file must pass
before it is kept, who may read one, who may upload) are configuration, not a fork.
`@aweftjs/uploads/client` is the browser half that posts a file with progress;
`@aweftjs/uploads/s3` is the bucket adapter; the readers this package exports are for any
process.

## Quickstart

The server side is three modules, the store declarations they query, and one rule about order:

```ts
import { auth, paths as authPaths } from '@aweftjs/auth';
import { fromDirectory } from '@aweftjs/modules/node';
import { createServer } from '@aweftjs/server';
import { node } from '@aweftjs/server/node';
import { files } from '@aweftjs/static';
import { createStore, memoryDriver } from '@aweftjs/store';
import { paths as uploadPaths, uploads } from '@aweftjs/uploads';

const store = createStore({ driver: memoryDriver(), declare: { ...authPaths, ...uploadPaths } });

const server = createServer({
	// `uploads` before `files`: static/Files answers every URL it is asked, so it goes last.
	sources: [fromDirectory('./modules'), uploads, files, auth],
	store,
	gate: 'auth/Gate',
	listener: node({ port: 8080 }),
});

await server.start();
```

The page posts a file and keeps the URL it gets back wherever it keeps state:

```tsx
import { createUploads } from '@aweftjs/uploads/client';
import { FileDrop } from '@aweftjs/ui';

const uploads = createUploads();

const changePhoto = async (file: File): Promise<void> => {
	const record = await uploads.upload(file, { progress: (fraction) => bar.set(fraction) });
	profile.image = record.url;   // '/files/<id>', served by uploads/Serve
};

<FileDrop.Button label="Change photo" extensions={['image/*']} multiple={false} onDrop={([file]) => changePhoto(file)} />
```

That is the whole wiring. Under the auth battery's gate the post needs a signed-in user and
the file is readable by anyone with its URL; both are one word of configuration away.

## What it does

**`POST /api/uploads`** takes one file as the request body. `Content-Type` is the file's type
and `X-Upload-Name` its name, percent-encoded. The route refuses before storing a byte when the
type is not one the application takes (415), the declared length is over the cap (413), or
there is no `Content-Length` (411). It reads the first bytes and refuses a file whose bytes are
not its declared type (415) for the types it can tell (png, jpeg, gif, webp, pdf, mp4, webm,
ogg, mp3, wav, flac). Then the body streams into storage while it is counted and hashed: a body
that runs over the cap is cut and removed (413), one shorter than declared is removed (400).
Then the application's `accept`, then the record, then 201 with the record. A refusal reads and
discards what is still arriving, up to twice the cap, so the answer reaches a sender that is
still mid-body through a streaming proxy; the gate's 403 for an anonymous post reads nothing.
A sender whose socket fails mid-body is 400 `incomplete`; storage that fails is the module's
failure, 500 and reported, never a refusal. A name is kept to 255 characters, cut by code
point.

```json
{ "id": "k3jd8sQ2pL0aZx9C", "url": "/files/k3jd8sQ2pL0aZx9C", "user": "u1", "name": "cat.png",
  "type": "image/png", "size": 48213, "sha256": "…", "at": 1757800000000,
  "storage": { "adapter": "directory", "key": "k3jd8sQ2pL0aZx9C" }, "meta": null }
```

Every refusal is JSON `{ reasons: [{ code, message }] }`. Over `concurrent` uploads in flight
the route answers 429.

**`GET /files/<id>`** streams the bytes with the type from the record, the length, an `ETag`
that is the sha256 (304 on `If-None-Match`), `Cache-Control: public, max-age=31536000,
immutable` (an id never changes content), `X-Content-Type-Options: nosniff`,
`Content-Security-Policy: sandbox`, and `Content-Disposition: inline` with the name. `HEAD`
carries the headers and no body, and 404 when the bytes are gone, as GET does. A path that is
not `/files/<one segment>`, or an id with no record, is declined so the next module answers it;
another method on a live file is 405.

**From a module**, name `uploads/Files` in `deps`:

```ts
export const deps = ['uploads/Files'];

export default ({ imports }) => ({
	call: async (args, context) => {
		const csv = await exportOf(context.user);
		// The trusted path: no type rule, no cap, no accept. Bytes in, record out.
		const record = await imports.Files.put(new TextEncoder().encode(csv), { type: 'text/csv', name: 'export.csv', user: context.user });
		return record.url;
	},
});
```

`put(bytes | stream, { type, name?, size?, user?, meta? })` (a stream needs its `size`, and
`type` is one MIME type with no parameters), `get(id)`, `open(id)` for the record and a stream
over its bytes, and `remove(id)`, which takes the bytes first and the record second and answers
whether there was one.

**From any process**, the readers over the store:

```ts
import { records, upload } from '@aweftjs/uploads';

const one = await upload(store, id);
const hers = await records(store, { user, limit: 50 });     // newest first
const same = await records(store, { sha256 });              // the same bytes uploaded twice
```

## Configuring it

The way every battery module is configured: a same-named file in the application's own source
exporting `config`.

```ts
// modules/uploads/Files.ts
import { directory } from '@aweftjs/uploads';
import { s3 } from '@aweftjs/uploads/s3';

export const config = {
	storage: process.env.SPACES_BUCKET
		? s3({ endpoint: process.env.SPACES_ENDPOINT!, region: 'nyc3', bucket: process.env.SPACES_BUCKET, accessKey: process.env.SPACES_KEY!, secretKey: process.env.SPACES_SECRET! })
		: directory('var/uploads'),
	types: ['image/png', 'image/jpeg', 'image/webp', 'audio/mpeg', 'video/mp4'],
	maxBytes: { image: 5 * 1024 * 1024, audio: 25 * 1024 * 1024, video: 25 * 1024 * 1024 },
	accept: async (upload, context) => {
		if (!upload.type.startsWith('image/')) return;
		const verdict = await moderate(await upload.bytes(), upload.type);
		if (!verdict.ok) return { reasons: [{ code: 'moderation', message: verdict.reason }] };
	},
};
```

| module | setting | default | what it is |
|---|---|---|---|
| `uploads/Files` | `storage` | `directory('uploads')` under the working directory | where the bytes go: `directory(path)`, `s3(options)`, or an adapter of your own |
| | `types` | png, jpeg, gif, webp | the MIME types the route takes |
| | `maxBytes` | 10 MiB | one number, or a map by family: the part of the type before the `/` (`image`, `audio`, `video`, any other), and `default` for a family the map does not name |
| | `accept` | none | `(upload, context)`: nothing to accept, `{ reasons }` to refuse; `upload` is `{ id, name, type, size, sha256, user, bytes() }` |
| `uploads/Receive` | `public` | `false` | `true` lets anyone post under a gate that reads it |
| | `concurrent` | 16 | uploads held in flight at once |
| `uploads/Serve` | `public` | `true` | `false` makes every file need a signed-in reader |
| | `allow` | none | `(upload, context)`: nothing to allow, `{ reasons }` for 403 |

A value of the wrong type is refused at load with `invalid-config`.

`accept` runs after the bytes are in storage and before the record is written, so it reads
them back with `bytes()` and its refusal removes them. A throw out of it is 500, reported under
`uploads/Receive`, the bytes removed. Moderation, a quota, a manifest check: all here, none
ships.

**The bucket adapter.** `s3({ endpoint, region, bucket, accessKey, secretKey, prefix? })`
signs every request with Signature Version 4 and streams a put with its length and an unsigned
payload; path-style URLs, so it reaches a bucket on DigitalOcean Spaces, MinIO or AWS alike.
No dependency. `prefix` is letters, digits, `_`, `.`, `/` and `-`, such as `site1/`.

**A key** is letters, digits, `_` and `-`, at most 128 of them; `keyOf(key)` on the root
answers it or throws `invalid-key`, and every adapter applies it before a key becomes a path
or a URL. An adapter of your own is `{ name, put, open, head, remove }` over such keys;
`adapterChecks()` from `@aweftjs/testing` is the suite it passes, the key rule among them.

**Storage, the order rule.** `static/Files` answers every request it is asked, with a file or
with its 404 page, and never declines. Load order follows the order of `sources`, so list
`uploads` before `files`. Listed after, every `/files/<id>` is the 404 page, or the shell with
status 200 under `unknown: 'shell'`, and an `<img>` gets HTML.

## The store, and the record

`upload:<id>` holds `kind`, `user`, `name`, `type`, `size`, `sha256`, `at`, `storage` (the
adapter's name and the key) and `meta` (what `put` was handed, plain values only). It is an
ordinary document; the battery truncates its own documents' tails to nothing. `paths` declares
`kind`, `user`, `sha256`, `type` and `at`; `user` is the auth battery's declaration and the
same path.

An id is any text the key rule takes (letters, digits, `_`, `-`, at most 128), so objects
already in a bucket under such keys are recorded by a script that writes `upload:<oldkey>`
documents through the store with `storage: { adapter: 's3', key: '<oldkey>' }`, and
`uploads/Serve` finds them at `/files/<oldkey>`. An object under a key outside the rule (a
slash, a dot) is copied under one inside it first. A record whose key is outside the rule
names no bytes: it serves 404 and `remove` still takes it.

## What it never decides

Who may upload beyond the gate's word and `accept`. Who may read beyond `public` and `allow`.
Whether a file may be deleted over the wire: no delete route ships, because whose file it is
differs by application (a listing's image belongs to the listing, not the uploader); `remove`
is the tool and the route is yours. When a file expires: no sweep ships; the readers list by
user, hash and time, and your job calls `remove`. What a file means: it never indexes, tags,
dedupes, resizes, strips metadata, transcodes or thumbnails. It never reads a storage setting
from the environment, never lists a directory, never answers a range, never redirects to a
CDN, and never stores an address.

## Known limits

- A served file streams through the process. A bucket's own edge in front of `/files/` (an
  nginx location, a CDN) is the way to keep a busy site's media off the box; the route is then
  never reached.
- Nothing is cached in memory: a file is read from storage on every request that does not
  carry its ETag.
- The record and the bytes are two writes with no transaction across them. The bytes land
  first and the record last, so a crash between them leaves an object nothing names, which the
  bucket's own listing finds and nothing here removes.
- The sniff table knows eleven types; a declared type outside it is trusted as declared, and
  `nosniff` plus `sandbox` are what keep that from becoming a script on the origin.
- `fetch` reports no upload progress in Firefox or Safari, so the client half posts over
  `XMLHttpRequest`. A page that wants `fetch` posts the file itself: `POST /api/uploads` with
  the body, `Content-Type` and `X-Upload-Name`, credentials included.
- No range requests: a `<video>` that seeks pulls the whole file. A need for ranges is a note of
  its own.
- No resumable or chunked uploads: a file has to fit one request, and the listener's
  `maxPayload`, when set, bounds it too.
- A refusal is answered once the body has been drained, and the drain has no clock: a sender
  that stalls mid-body holds its `concurrent` slot until the listener's own request timeout
  ends it (Node's is five minutes).
- A `put` from a module runs none of the rules, on purpose; a module that wants them calls
  `receive` with a stream, the declared type and the size.
