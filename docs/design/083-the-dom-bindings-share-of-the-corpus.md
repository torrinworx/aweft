# 083: The DOM binding's share of the corpus

## Decision

The behavioral corpus for `dom` lands as `packages/dom/tests/behavior.dom.test.ts`, each case
stated as a requirement this binding meets. Two classes of the curated requirements do not
carry over, and this note is why:

- **A compiled path behaving as the runtime path.** Nine requirements say a compiled fast
  path must behave exactly as the runtime path. No compiled path exists here; `build` is a
  later package and states its own requirements against this binding when it arrives.
- **Build-only internals.** Requirements about locals being rewritten into parameters by a
  release transform, about clearing markers by assignment rather than deletion, and about
  expando properties written onto link objects describe one implementation's
  internals. The behaviours they protected (no per-binding state written onto core
  structures, hot-path bookkeeping that does not leak) are met by construction: this binding
  keeps its state in its own records and WeakMaps, and a test pins that core objects gain no
  properties.

- **Mechanics of one implementation with no behaviour of their own.** A queue that needs a
  tail pointer, a drain that re-reads its head, wrappers that carry a length, null checks
  that tell "no value" from "value removed", a sentinel an anchor callback receives, a purity
  annotation a bundler misread. Each served a behaviour the suite pins directly: a nested
  batch runs after the current one, an edit made during a drain is not lost, any iterable
  mounts, a removed mount is never asked for its first node.

Every other requirement is in the suite: teardown order, reentrancy, list reconciliation and
anchors, idempotent removal and a hostile DOM, the fast clear, values and props, state
pollution, context threading, error attribution, and the template parser.

## Why

The corpus is append-only and removing a case needs a design note. These cases are not removed;
they never applied, and saying so here keeps the next reader from hunting for the missing
tests.

## What would reverse this

`build` shipping a compiled path. Its own requirements then land with it.
