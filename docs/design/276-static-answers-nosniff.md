# 276: Static answers nosniff

Amends design 249.

## Decision

Every response `static/Files` builds carries `X-Content-Type-Options: nosniff`: the file, the
304, the unknown page, the bare 404 and the 405.

## Why

A browser that sniffs turns a file served as one type into another when the bytes look like it,
which is how a text file or an upload becomes a script. The header is the one line that turns
sniffing off, it is what the standard asks of every response, and this module is the one in the
stack that answers with files whose bytes it did not write.

## What this costs

One header on each response.

## Evidence

`packages/static/tests/files.test.ts`: the header on each of the five answers.

## What would reverse this

Nothing foreseeable.
