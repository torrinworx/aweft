# 151: `attach` picks its mode from the stamp

## Decision

`@aweftjs/ssg/client` exports one function:

```ts
import { attach } from '@aweftjs/ssg/client';

const stop = attach(document.body, <Site router={router} />);
```

It hydrates when the target carries `data-aweft-ssg` and mounts when it does not, and answers the
removal either way. It is a subpath of its own and imports `mount` and `hydrate` from
`@aweftjs/ui` and nothing else, so a bundle that reaches for it carries no file that reads the
disk.

## Why

The dev server and the generated site are the same page reached two ways: `npx vite` serves the
shell with an empty body, the build writes the same shell with the markup in it, and the entry
file is the same file. Choosing between `mount` and `hydrate` in the entry means an application
writing the test itself, and getting it wrong is silent in both directions: `mount` over server
markup renders the page twice, and `hydrate` over an empty body asserts that the markup ran out.

The stamp is the only thing that can answer it, because an empty body is not proof of anything.
`ssg` writes the stamp, so `ssg` is the package that can read it, and one function is smaller than
the two-line snippet every application would otherwise carry.

## What this costs

One more name on a package's surface for what an application could write itself, which is the
thing this repo usually refuses. It ships because the two-line version is wrong in a way nobody
sees until the page is live.

## What would reverse this

`dom` learning to tell a hydrating target from an empty one on its own, which would put the choice
in `mount` and leave `attach` with nothing to do.
