# 298: A server can hash the room's frame scripts

Amends design 280 (the room on the page). Asked for by an application whose pages send a
Content-Security-Policy that allows only its own scripts.

## Decision

The main entry of `sandbox` hands out `frameScripts(inside, importMap)`: the two inline scripts
the `iframe` runner writes into the frame (the import map and the boot), as text, byte for byte
what the frame carries. The runner builds its frame from the same function, so the two cannot
drift. A server hashes the texts and names the hashes in its `script-src`.

## Why

The frame is written from `srcdoc`, so it inherits the page's policy on top of its own. A page
that names no `'unsafe-inline'` blocks both scripts, and the room never boots, with nothing in
the room's own report saying why. The only way to allow exactly these two scripts is by hash,
and a hash needs the exact text, which only the runner knows.

## What it costs

One more export on the main entry. A server that hashes the texts has to call it with the same
`inside` and `importMap` it gives the runner.

## What would reverse it

A frame that loads its import map and boot from files rather than inline. Browsers do not take an
import map from a file today, so that waits on the platform.
