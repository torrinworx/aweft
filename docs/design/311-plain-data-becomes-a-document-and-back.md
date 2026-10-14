# 311: Plain data becomes a document, and back

## Decision

`@aweftjs/core` exports two functions.

`fromPlain(value)` builds the observable tree a document holds from plain data. A plain object
becomes `createObject`, an array becomes `createArray`, and every value inside is converted the same
way. A key holding `undefined` is dropped, and an `undefined` or a hole in an array is `null`, which
is what `JSON.stringify` does with them. A key named `__proto__`, which `JSON.parse` makes an own
key, is a slot like any other, and sets no prototype in either direction. A primitive, bytes and an
observable are handed back as they are, so a tree that is already partly observable keeps the
observables it holds, and so is an `alias(x)` marker, so an alias stays an alias. Anything else, a
`Date`, a `Map`, a class instance, a function, is refused with `invalid-value`.

`toPlain(value)` copies a document, or any part of it, out as plain data. An object and a map become
plain objects, an array a plain array, bytes a copy of the bytes, and every slot is included. An
observable reached twice, through an alias, is copied at each place it is reached, and an `alias(x)`
marker in plain data is copied as what it names.

Both refuse a value reached again inside itself with `cycle`, because a plain copy cannot hold a
loop, and a value nested deeper than the runtime's stack with `too-deep`, rather than with a bare
`RangeError`.

## Why

Two applications wrote the first five times, under three names, and the second five times as
`JSON.parse(JSON.stringify(value))`. The copies already disagree. One wraps a `Uint8Array` into an
object of numbered keys, and one leaves a `Date` for core to refuse later with a message about a
slot. The round trip through JSON also turns bytes into an object of numbered keys.

A slot holds a primitive, bytes or an observable, and a plain object or array assigned into one is
refused (`inline-container`). That rule is right, and it makes converting plain data in, from a
request, a file or an import, a step every application takes.

## What this costs

Two exports. A map comes back out as a plain object, so `fromPlain(toPlain(map))` is an object and
not a map. An alias is copied out as a second copy, so the copy is larger than the document.

## Evidence

`packages/core/tests/plain.test.ts`: the conversion both ways over seeded random trees from
`@aweftjs/testing`, bytes in both directions, the `undefined` rules, a hole, a `__proto__` key from
`JSON.parse`, an observable kept by identity, an alias marker kept on the way in and copied on the
way out, an alias copied twice, a cycle refused both ways, a tree fifty thousand deep refused as
`too-deep` both ways, and each kind of value that is not plain refused.

## What would reverse this

A document format that holds a value JSON cannot, such as a date, which would give `fromPlain` a
rule for it.
