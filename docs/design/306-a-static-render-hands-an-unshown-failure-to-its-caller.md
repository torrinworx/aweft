# 306: A static render hands an unshown failure to its caller

Amends design 112 (a failed loader is reported, never left as a spinner).

## Decision

When a `suspend` loader rejects and no failure component shows it, the slot still goes empty, and
where the rejection goes depends on the render:

- **A mount or a hydration** rethrows it on a fresh task, as design 112 says, for the host to report.
- **A static render** keeps it, and `render` rejects with the first one once the page has settled.

Nothing else changes: a failure component, the call's own or the `LoaderContext`'s, still shows the
failure and the render answers its markup.

## Why

Design 112 rethrows so the failure reaches a place a person already looks: "Node prints it and
fails the process". For a build that is the right end. For a server that renders a page per request
(design 304), it means one request to a page whose read was refused or failed ends the process,
because a rejection thrown on a fresh task cannot be caught by the code that started the render. A
page that does not catch every read's refusal is common, and every visitor can reach it.

Handing the rejection to the caller keeps design 112's rule that a failure is never hidden: the
caller hears it, as a rejection it can catch. A build script that does not catch it still fails,
with the same error, because an unhandled rejection ends a Node process too. A request-time render
catches it and answers the request.

The render is the right place because it is the one call that owns the page's whole lifetime, and
`ui` already marks a render object as static for its own components (design 153).

## What this costs

A build that caught nothing behaves as before. A build that wraps `write()` in a `try` now catches
an unshown loader failure it could not catch before, which is the point. A static render with
several unshown failures rejects with the first; the rest go nowhere, because the first is enough
to say the page did not render.

## Evidence

`packages/ui/tests/suspend.test.ts`: in a static render, a loader that rejects with nothing to show
it makes `render` reject with that same error, and one with a failure component renders the
component's markup; the existing test that a mount reports the rejection to the host, in a process
of its own, still passes. `packages/ssg/tests/pages.test.ts`: a page that does not catch a failed
read is answered with the shell, 503, and the server keeps answering; one that does not catch a
refusal is a 500 the server reports.

## What would reverse this

`dom`'s `pending` growing a rejection path of its own, which design 112 already names: then every
mode reports through it and this special case goes.
