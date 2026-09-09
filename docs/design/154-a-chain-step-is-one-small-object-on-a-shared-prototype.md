# 154: A chain step is one small object on a shared prototype

## Decision

A chain step (`chain` in `core/src/derived.ts`) and a scope step (`build` in
`core/src/observer.ts`) are instances of a class each, with every combinator on the
prototype. A step holds only its state: the source for a chain; the base, the keys, the
ignored keys, the shallow flag and the wildcard flag for a scope. A scope builds the Source
it needs for `map`, `bool`, `selector`, `setter`, `throttle`, `wait` and `isImmutable` on the
first call that asks for one, never on construction. `path`, `ignore`, `shallow`, `skip`,
`tree`, `get`, `set`, `watch` and `effect` never build one.

The public surface does not change: every method name, every type in `Derived` and
`Observer`, and the rule that a chain is immutable and each combinator returns a new one.
The class is not exported from the package index. `sourceOf` still finds a chain's source;
`[SOURCE]` is a prototype getter rather than an own property. A step's state lives in
private fields, and a scope reaches the chain's slot through a Symbol-keyed accessor on the
prototype, so a step has no own enumerable property and `JSON.stringify` of one is `{}` as
before (plain fields put `src`, `base` and the rest on `Object.keys`, against the rule
that an internal surface never rides a naming convention).
Measured against plain fields on `bench/derived.ts`: no difference on any shape.

Two things follow. Methods are shared, so a method
taken off its chain and called bare no longer works; nothing in the repo does that, and the
two places that take unbound methods (`cell.ts` `immutable`, `derived.ts` `gate`) take them
off Source literals, which stay literals. A scope's shallow flag is a field named `narrow`,
because `shallow()` is a method on the same object.

## Why

Every `observer(item).path('label')` and every `selector(item).bool(...)` built an object
literal of about nineteen closures per step, twice per row on the framework row table.
Measured: during create 10,000 rows those two factories allocated
29 MB of 114, and after 1,000 rows they were 26% of all live JS heap. Creating the chain
alone 10,000 times cost 4.2 ms and retained 2,219 KB per 1,000, against 0.9 ms and 112 KB for
a comparable chain measured beside it, whose steps carry two fields and three prototype methods.

Measured on a copy of e1c2fdd before the change: chain-only creation retained
316 KB per 1,000 rows; allocation during create 10,000 went from 112.9 to 85.5 MB and the
two factories from 29 MB to 1 MB; live heap after 1,000 rows from 4.14 to 2.94 MB; core,
dom and ui suites green with no test touched.

## What would reverse it

A consumer that needs a bare method to work, or a measurement showing the lazy Source
costs more on a chain-heavy shape than it saves. Neither exists today; `bench/derived.ts`
guards the derived shapes and must not regress.
