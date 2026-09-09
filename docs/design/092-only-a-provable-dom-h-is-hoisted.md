# 092: Only a provable `dom` `h` is hoisted

## Decision

JSX compiles to a plain `h(...)` call resolved by ordinary lexical scope, whatever `h` that is.
The static hoisting pass is narrower: it replaces a subtree with a template only where the
transform can prove, in that file, that `h` came from `@aweftjs/dom`.

`h` is imported from `@aweftjs/dom` only when the file has no `h` of its own. A file that
declares its own `h`, or imports one from somewhere else, keeps it and its JSX compiles to it.

## Why

Hoisting assumes `h`'s semantics: which properties are attributes, which are properties, what a
reactive child does, what the return value is. A different `h` may mean something else by all of
them, and a template substituted into it would silently do a different thing.

`ui` and an application are meant to declare their own `h`, their own theming, and a wholly
separate definition if they want. `build` therefore knows nothing about `ui`, and does not have
to be told when a new one appears.

## What this costs

Named plainly: a component-heavy page gets less of the 74 ms per 10,000 rows that hoisting is
worth than the benchmark row does, and gets none of it in a file whose `h` is not `dom`'s, until
that `h` opts in. The saving reaches plain `dom` pages first.

## What would reverse this

A way for a custom `h` to declare that it keeps `dom`'s semantics, so the transform can hoist
into it without guessing. That is a surface question for whichever package grows the custom `h`,
not for `build`.
