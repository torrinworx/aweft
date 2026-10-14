# 313: A prefix is not a page, and a prefix carries any header

Amends design 249 (the static battery).

## Decision

`static/Files` takes two more things in its configuration.

**`notPages`**, a list of path prefixes, matched as `headers` is: against the path with its leading
slash removed. A URL under one of them is looked up as any other, so a file there is still served.
When no file answers it, the answer is never the shell and never `404.html`. It is 404 with the
server's own JSON for a refusal, `{ reasons: [{ code: 'not-found', message }] }`, whichever
`unknown` says. The prefix is matched against the decoded path, as a `headers` prefix is, and
against the path as written when it does not decode, so that path still gets the 404.

**A `headers` value may be an object** of header names to values, beside the string it is today. A
string is still a `Cache-Control`. The longest matching prefix still wins, whole: its headers are
the ones written, and a shorter prefix's are not added to them. The headers go on a file's 200 and
its 304, as `Cache-Control` does today. The configuration refuses the four headers this module
writes itself (`content-type`, `content-length`, `etag` and `x-content-type-options`) and the six
that belong to a single connection (`connection`, `keep-alive`, `proxy-connection`, `te`,
`transfer-encoding` and `upgrade`). It also refuses a name that is not a header name and a value
with a line break inside it. Spaces, tabs and line breaks at either end of a value are trimmed, as
`Headers` trims them, and the trimmed value is the one written.

## Why

Under `unknown: 'shell'` every URL with no file is the page with status 200, `/api/nope` included. A
fetch of a mistyped API path reads a 200 and parses HTML as JSON, and a stale `/files/<id>` in an
`<img>` paints the whole site. Two applications wrote a module that answers those two prefixes with
a 404 before this one runs, in the same JSON.

A frame with an opaque origin imports its modules in CORS mode, so a room's bundle needs
`Access-Control-Allow-Origin`, and the battery could send a `Cache-Control` and nothing else. Two
applications wrote a second file server for one directory to send one header.

The JSON is the server's own shape for a refused request (design 248), so a page reads a 404 the
same way whoever wrote it.

## What this costs

Two configuration fields, and a `headers` value of two shapes. A prefix's headers do not merge with
a shorter prefix's, so a directory that wants both a cache rule and CORS names both. A header whose
value depends on the request, such as a policy naming the request's host, is still a module of the
application's own. The unknown answer carries no configured header, as before.

## Evidence

`packages/static/tests/files.test.ts`: an API path under `notPages` answering 404 JSON under both
`unknown` settings, a file under the prefix still served, a prefix holding a space or a letter
outside ASCII and one spelled with an escape matched once decoded, a path that does not decode
answering the 404, the shell still answering a path outside every prefix, a header set on the 200
and the 304 and on HEAD, the longest prefix winning whole, a string still writing `Cache-Control`,
and each refused name and value refused at load.

## What would reverse this

A header an application needs computed per request on every file, which would make a value a
function of the request.
