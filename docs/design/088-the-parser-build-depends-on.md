# 088: The parser `build` depends on

## Decision

`@aweftjs/build` depends on `@babel/parser` and `magic-string`, and on nothing else. Both are
declared as dependencies of that package alone and are named in the allowlist inside
`packages/testing/scripts/check-dependencies.ts`, which is what refuses a third.

`@babel/parser` reads the source. `magic-string` edits the source in place and produces the
source map, so the parts of a file the transform does not touch come out byte for byte as they
went in.

## Why

The transform has to run in two places from one implementation: a bundler, and a browser
compiling source that did not exist at build time. That rules the candidates out one at a time.

Measured gzipped, on this machine: `typescript` 1,595 KB, `@babel/parser` 89 KB, `acorn` with
`acorn-jsx` 58 KB. `typescript` cannot ship to a browser at that size. `acorn` is the smallest
and cannot read TypeScript at all: it fails on `packages/dom/src/mount.ts` at line 9. Babel is
the only one that reads `.ts`, `.tsx`, `.js` and `.jsx` and still fits a page, and it parses a
24 KB TypeScript file in 1.8 ms.

`magic-string` is there because the alternative is printing an AST back out, which rewrites
every line of a file to change one of them and makes the source map a full mapping rather than
a handful of edits.

## What this costs

Two dependencies in a stack whose lower packages have none. They are development-time for an
application that only uses the bundler plugin: the parser reaches a browser bundle only when a
page actually compiles code, which is the runtime mode and the three consumers that need it
(validating stored module source, compiling inside the sandbox, the playground).

## What would reverse this

A parser that reads TypeScript and JSX in materially less than 89 KB gzipped, measured rather
than claimed. Or the runtime mode losing all three of its consumers, at which point the build
mode alone could take the 1,595 KB one and drop a dependency from the browser story entirely.
