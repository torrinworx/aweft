# 020: Trailing-underscore properties are kept and mangled

## Decision

An internal property carries a trailing underscore, `foo_`, and the release build mangles
every name matching that pattern.

Leading `_foo` is a different rule and the two must never be conflated. Leading is
*behavioral*: the property is runtime-private from wildcard observers. Trailing is a
*build* rule: the name is manglable internal surface and means nothing at runtime. Both are
documented at their definition sites.

An internal surface another package legitimately needs goes behind an exported Symbol or a
documented subpath export. Never behind a naming convention.

## Why

Unlike the alias convention (design 019), this one pays. Measured on the real build:
**3.70% smaller after gzip, 4.50% after brotli**. At the size a client bundle reaches that
is worth a naming rule.

The hazard a mangling convention carries is that something outside the build unit reaches a
name the build then renames, and breaks in release only. The `exports` map rule already
prevents it: a package declares its public surface, and a deep import into another package's
internals fails at import time. Nothing outside can reach a manglable name, so the hazard has
no path.

That is why this design and design 019 land differently despite looking like the same kind of
rule. One is measured to cost and has a live hazard; this one is measured to pay and its
hazard is closed by a rule already enforced.

## What was rejected

Mangling by a build-tool property list rather than a naming convention. It moves the same
information into a file nobody reads while writing code, so the call site stops saying
whether a property is internal. The convention is the documentation.

## What would reverse this

The saving dropping toward zero on a real bundle, which would mean the internal surface has
shrunk relative to everything else and the rule is no longer buying anything. Or the
`exports` map rule gaining an exception, which would reopen the hazard this design relies
on being closed.
