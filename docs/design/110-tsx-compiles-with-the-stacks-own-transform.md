# 110: `.tsx` reaches the gate through `build`'s own transform

## Decision

`ui`'s source is `.tsx`. Node cannot load it: it strips types, and JSX is not a type.

`@aweftjs/build` gains one subpath export, `@aweftjs/build/loader`, a Node module-customisation
hook. Its `load` reads a `.tsx` file, runs `transform` over it, and hands the result back as
`module-typescript`, so Node strips the types afterwards. The gate registers it once, in
`packages/testing/scripts/run-tests.ts` and in each package's own `test` script, with
`--import`.

`tsconfig.base.json` gains `"jsx": "preserve"`, so `tsc --build` typechecks JSX and emits
nothing, which is what the rest of the toolchain already does. `packages/ui/src/jsx.d.ts`
declares the global `JSX` namespace the compiler resolves elements against.

Three gate scripts read `.tsx` as well as `.ts`, because each of them would otherwise have a
silent hole in a package whose source is `.tsx`: `check-boundaries.ts` (an unchecked import
edge), `check-errors.ts` (an unrecorded refusal) and `packages/testing/src/surface.ts` (which
needs `jsx` in its compiler options to parse the file at all).

## Why

The stack compiles itself with its own compiler, which is the strongest test the transform can
have: every `.tsx` file in the repo goes through it on every gate run, and a fault in the JSX
pass turns the build red rather than waiting for an application to find it.

`module-typescript` rather than emitting JavaScript, because the transform's whole point is that
it leaves untouched source byte for byte. Handing back the file with only its JSX rewritten, and
letting Node strip the types as it does for every other file in the repo, keeps one type stripper
rather than two.

A subpath export rather than a new package, because the loader is one entry point to a transform
`build` already owns, and a package whose whole content is fifteen lines of glue is not a package.

## What this costs

`build` grows a second public entry, so `surface.txt` records it under its subpath. The gate's
node invocation grows an `--import`, and a suite run by hand needs the same flag; the package's
`test` script carries it so `npm test -w @aweftjs/ui` is enough.

Node's `module-typescript` format is the mechanism `--experimental-strip-types` uses. It is what
this repo already depends on for every `.ts` file, so the loader adds no new dependency on it,
only a second caller.

## What would reverse this

Node loading `.tsx` on its own, which would delete the loader and leave the tsconfig entry.
