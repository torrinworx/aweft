# 091: Asserts now, the property mangle later

## Decision

`build` ships the assert strip working today, and the release mangle configuration for
trailing-underscore properties with nothing yet using the convention.

`mangle` is one export: the pattern that matches a manglable property name, and that pattern
already shaped for the two minifiers an application is likely to run. The pattern matches a name
that ends in exactly one underscore and does not begin with one, so `queue_` is manglable and
`_private`, `plain` and `queue__` are not. That is the distinction the stack insists on:
leading `_foo` is a behavioral rule about wildcard observers, trailing `foo_` is a build rule
about what a minifier may rename, and conflating the two renames something a watcher can see.

Applying the convention across `codec`, `core` and `dom` is a rename of internal properties in
three packages and is not part of this.

## Why

The strip is worth 2.8 KB of the 40.2 KB browser bundle today, measured, and needs nothing else
to land. The rename needs a pass over three packages, every internal property considered one at
a time, because the cost of getting one wrong is a property a wildcard observer stops seeing.

Shipping the configuration first means the rename, when it happens, is a rename and nothing
else: the build side is already in place and already tested against names that must and must not
match.

## What this costs

An export nothing uses yet. It is one object and one regular expression, so the cost is the
reader's question of why it is there, which this note answers.

## What would reverse this

Nothing about the strip. For the mangle configuration: a minifier whose property mangling cannot
be driven by a pattern, which would make the shipped shape useless to it and the export a
different one.
