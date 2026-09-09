# 163: Bytes in a slot survive every driver, and the suite says so

## Decision

A slot may hold bytes (`Primitive` in `core` includes `Uint8Array`), and a driver has to hand
them back as bytes. A driver that stores slots as JSON writes a byte value as an object with one
key, `bytes`, holding the base64 text, and turns that object back into a `Uint8Array` on read.
No reference carries that key (a reference is `ref`, `kind` and `edge`) and no primitive is an
object, so the shape is unambiguous.

`driverChecks` gains the check: a slot written as bytes reads back as bytes, equal byte for
byte, after a write that touched a different slot of the same observable. The file driver in
`recipes/store` is fixed to pass it.

## Why

**The file driver was losing them, quietly.** `JSON.stringify` writes a `Uint8Array` as an
object keyed by index, and reading it back gives that object, not bytes. Nothing in the suite
asked, so the driver that exists to prove the contract is implementable from outside passed
every check while corrupting a value the core allows. The Postgres driver keeps slots as jsonb
and would have made the same mistake in the same silence.

**The memory driver never had the problem**, because it holds the value itself, which is why
the suite never noticed: the suite was written against the driver that could not fail it.

**Base64 in a tagged object rather than a separate column.** A slot's value is one jsonb per
observable (design 161), and the merge that makes a write slot by slot works on that one
value. A bytes column beside it would need its own merge and its own unset, and every driver
that keeps JSON would need the same second path.

## What this costs

Bytes cost a third more in storage than they weigh. A driver author outside the package has to
know the shape, which the block comment on `Row` and the README's driver section state.

## What would reverse this

A driver whose storage holds bytes natively beside JSON at no cost to the slot merge, at which
point the tagged shape is that driver's business and the check still holds.
