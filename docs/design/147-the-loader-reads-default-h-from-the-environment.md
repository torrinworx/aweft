# 147: The Node loader reads `defaultH` from the environment

## Decision

`AWEFT_DEFAULT_H` names the package a `.tsx` with no `h` of its own gets one from, for every file
the Node loader compiles in that process:

```
AWEFT_DEFAULT_H=@aweftjs/ui node --import @aweftjs/build/loader build-site.ts
```

Unset, nothing changes and a file with no `h` compiles against `@aweftjs/dom`, which is what the
gate's own runs still do. Set to anything but the two package names, the loader refuses before it
reads a file: `unknown-default-h`, naming the value and the two that are allowed.

`build`'s surface does not change. `transform` and `aweft()` already take `defaultH` as an option;
this is only how a process with no bundler in it says the same thing.

## Why

A site renders its pages in Node through the loader and serves the same source to a browser
through the bundler, and the two have to compile that source identically. A file that imports
`Theme` and `mount` from `ui` and no `h` is the shape a real page is written in, and with the
setting reaching only the bundler that file gets `ui`'s `h` in the bundle and `dom`'s on the
server: the same page, two different `theme` props, and a hydration mismatch on every element.

The environment rather than `register()` data, because `--import` is how the loader is meant to be
reached and a flag has nowhere to hang an option. `register(specifier, { data })` can carry one,
but only for a caller that imports `node:module` and registers the hook itself, which is a second
way to start the loader and a second thing to document. One variable is readable in a shell
command, in an npm script and in a systemd unit, and it is visible at the top of the command that
sets it.

The variable is read once, when the loader module loads, and an unknown value stops the process as
it starts. Reading it per file left a run that compiles no `.tsx` never seeing the refusal this
promises, and a worker takes its environment when it is made, so nothing could have changed it
between files anyway. A test that wants a different value starts a process with it.

## What this costs

An environment variable is process-wide: a process that renders one page with `ui`'s `h` cannot
render another with `dom`'s. Nothing in this stack wants to, because the setting exists for the
case where every page in a build is a `ui` page.

It is also invisible in the file it changes. A `.tsx` with no `h` compiles two ways depending on
how the process was started, which is the cost the optional `defaultH` field already carries,
arriving here in a second place.

## What would reverse this

A build that has to compile `dom` pages and `ui` pages in one process, which would need the
setting per file rather than per process, and therefore a bundler-style entry rather than a flag.
