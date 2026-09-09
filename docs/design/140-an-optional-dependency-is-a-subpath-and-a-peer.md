# 140: An optional external dependency is a subpath and an optional peer

## Decision

This is the stack-wide rule for every optional external dependency, not a rule about icons.
Store drivers, email providers and file storage all reach this shape, and each one arriving with
its own answer is how a stack ends up with four of them.

**The adapter is a subpath on the package that owns the area.** `@aweftjs/icons/node` reads an
installed icon set. A separate `@aweftjs/icons-node` package would version apart from the package
it adapts, and a build-time detail would become an install-time decision.

**The third-party package is an optional peer, never a dependency.** It goes in
`peerDependencies` with `peerDependenciesMeta[name].optional === true`. npm 11 installs nothing
for an optional peer, so an application that does not want it does not get it, and one that does
gets the version it chose rather than a copy the stack pinned.

**The root entry never touches it.** Importing `@aweftjs/icons` loads no adapter, no set and no
`node:` module. The subpath is the only place the peer is named, and it reaches it when it is
called rather than when it is imported: a dynamic `import()`, or, here, a resolve from the
directory that asked. Either way the failure is catchable, which is what the refusal below needs.

**A missing peer refuses, with the install command in the message.** The refusal is the stack's
one shape (`codecError`): a reason a caller branches on, a detail saying what was actually seen,
and a fix saying what to do. Without the wrapper the reader gets `ERR_MODULE_NOT_FOUND` and no
remedy at all.

The install command is the detail, not the fix. `packages/testing/scripts/check-errors.ts`
refuses a fix built from a template, because a remedy assembled at run time cannot be written into
`errors.txt` and reviewed. The package name is only known at run time. So the message reads

```
set-not-installed: the icon set "lucide" is not installed; run: npm install @iconify-json/lucide.
Install the icon set the message names, or hand a pack of your own to Icons.
```

and `error.fix` carries the second sentence, which is true of every set.

**Types come from a types-only package or a declaration of our own**, never from installing the
peer as a dependency to get its `.d.ts`. Nothing here imports a set as a module: the set is read
as JSON with `node:fs`, and its shape is declared in `packages/icons/src/set.ts`, written from the
format. So the generator compiles with no set installed at all.

**The gate reads peers.** `packages/testing/src/manifests.ts` now walks `peerDependencies` as well
as `dependencies` and `devDependencies`. A third-party peer must be named in the allowlist and
must be marked optional; a peer that is not optional is a dependency wearing another name, and it
fails. The allowlist accepts a family as one pattern, `@iconify-json/*`, because a set per icon
family would otherwise be a policy change per set.

**Each real subpath is in `surface.txt`.** `check-surface.ts` reads every entry on the exports map,
so an adapter's surface is reviewed with everything else. A pattern the build generates is on no
exports map, and design 141 keeps it off on purpose, so no surface file can hold one; it is written
down in the owning package's README and in its own note instead.

**The suite proves the refusal.** `packages/icons/tests/node.test.ts` asks for a set that is not
installed and reads the message. `packages/testing/tests/manifests.test.ts` runs the allowlist
over a probe manifest whose peer is not optional and asserts the violation, so the paragraph above
is not the only thing saying the rule holds.

## Why

One shape for every optional external dependency, so the stack answers this question once rather
than once per package that grows one.

A hard dependency on an icon set would put 588 KB of Lucide, or 3.1 MB of mdi, into every install
of the stack for a page that may name three icons. A dependency on nothing at all leaves the
application to write the adapter, which is the work this package exists to do once.

Measured: npm 11 does not install an optional peer, the root entry imports and runs
with none installed, a subpath that wraps its dynamic import refuses with a fix, and one that does
not says `ERR_MODULE_NOT_FOUND` with no fix and no name a reader can act on.

## What this costs

An application that installs no set gets nothing from `@aweftjs/icons` until it does, and finds
that out from a refusal rather than from a type error. That is the trade the optional peer makes:
the install stays small and the mistake is caught one step later.

The allowlist grows a pattern rather than a name, so a new `@iconify-json/*` set needs no policy
change. Any other family does.

## What would reverse this

A package manager where an optional peer is installed by default, which would make the root
entry's promise (nothing loads unless you asked) untrue at install time rather than at import
time.
