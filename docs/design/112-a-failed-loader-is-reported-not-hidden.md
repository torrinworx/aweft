# 112: A failed loader is reported, never left as a spinner

## Decision

`suspend(fallback, loader, failed?)` returns a component. It mounts `fallback`, calls `loader`,
declares the promise `pending` so a static render waits for it, and replaces the fallback with
what the loader returned.

When the loader rejects:

1. If the call gave a `failed` component, it is mounted with `{ error }`.
2. Otherwise, if a `LoaderContext` above the component names one, that is mounted instead.
3. Otherwise the slot goes empty and the rejection is rethrown on a fresh task, so it reaches
   the host's unhandled-error path rather than nowhere.

A suspend that unmounts before its loader settles mounts nothing and reports nothing. The
promise is not cancelled, because a promise cannot be.

`LoaderContext` carries `{ loading, failed }`, both a component or null, and inherits from the
provider above it field by field.

## Why

Leaving the fallback on screen forever reads to a user as a page that is still working and to a
developer as nothing at all. Every other outcome is better than that.

Rethrowing rather than swallowing, because a rejection nobody handled is the host's business:
Node prints it and fails the process, a browser reports it to `window.onerror`, and both are
places a person is already looking. Swallowing it would make `ui` the reason a bug is invisible.

Three levels rather than one, because the answer is different at each: a page knows what a
particular failure should look like, an application knows what any failure should look like, and
the library knows only that silence is wrong.

## What this costs

A page with no `failed` anywhere gets an empty slot and an error in the console, which looks like
a bug because it is one. That is the intent.

## What would reverse this

`dom`'s `pending` growing a rejection path of its own, at which point `suspend` would report
through it and the third level above would move down a package.
