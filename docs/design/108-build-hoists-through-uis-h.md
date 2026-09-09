# 108: `build` hoists through `ui`'s `h`, into `ui`'s own template

## Decision

Design 092 hoists a static subtree only where `h` is provably `dom`'s in that file. A second
identity now qualifies: `h` imported from `@aweftjs/ui`, under the name `h` and bound nowhere
else in the file. `html` from `@aweftjs/ui` is read the same way.

In such a file the transform emits `template` from `@aweftjs/ui` rather than from
`@aweftjs/dom`, and it changes one rule: **no property goes into the prototype.** A `ui` file's
element carries every property as a per-instance edit, however literal it was in the source.

A file that binds no `h` at all is given one, and which package it comes from is the caller's to
say. `TransformOptions.defaultH` takes `@aweftjs/dom` or `@aweftjs/ui` and is `@aweftjs/dom` when
it is left off, so `build` still assumes nothing about `ui` and the gate's own loader compiles
this repo's `.tsx` exactly as it did. Without it, a page that imports `Theme` and
`mount` from `ui` and forgets `h` compiled to `dom`'s `h`, and its `theme` prop was written out as
a literal attribute nothing reads: no class, no error, no theme. Checked by `a file that binds no
h gets it from the package the caller named` in `packages/build/tests/ui-equivalence.test.ts`.

`@aweftjs/ui` exports `template(spec, edits)` with `dom`'s signature. It splits each properties
value into the part `dom` writes and the part `ui` claims (design 107), hands the first to
`dom`'s `template`, and applies the second per instance with the mount context in hand.

## Why

`build` cannot put `theme="card"` on a prototype element, because `theme` is not an attribute:
it is a class list `ui` resolves against the theme in effect. The same is true of `style`,
`class` and every `on*` name.

`build` could have been given `ui`'s list of claimed names, and that was rejected. It makes the
compiler track a vocabulary that lives in another package, and `ui` could not add a prop without
a matching change in `build`. Refusing the prototype to every property in a `ui` file needs one
fact: which package the file's `h` came from.

What is left in the prototype is the shape: element names, nesting and text. That is where the
saving is. `bench/ui-hoist.ts` measures it.

`ui`'s template reaches each element through `dom`'s own contract rather than by walking the
instance: it puts one extra `$` property in the properties it hands `dom`, whose value is a
source, so `dom` files it as a property signal carrying that element. `ui` takes those signals
back out of the instance before mounting it. Walking the instance instead would resolve paths
after `dom` had already inserted the varying children, and the indices no longer mean what the
edit paths meant.

## What it measures

`bench/ui-hoist.ts`, 10,000 rows of the benchmark row shape in Chromium, eight elements a row,
best of five invocations of best of seven, milliseconds:

```
  dom h calls            78.0
  dom template           42.4
  ui h, nothing claimed  82.7
  ui h, themed          104.8
  ui template, themed    92.6
```

Read it as two pairs, calls against calls and template against template:

- **Hoisting through `ui` is worth about 12 ms per 10,000 themed rows** (104.8 to 92.6). Less than
  hoisting through `dom` is worth on the same rows (78.0 to 42.4), because a `ui` file puts every
  property in the edits rather than in the prototype, which is the rule above.
- **The wrapping `h` costs about 5 ms per 10,000 rows over `dom`'s** when it claims nothing at all
  (78.0 against 82.7, eight elements a row). That is the extra call frame and its rest arguments.
- **A `theme` on the outer element costs about 22 ms per 10,000 rows** (82.7 to 104.8): the class
  cache lookup, the tracker and the class write, once a row.

An earlier version of this bench built the page through `aweft()`, which hoisted the `dom` rows
and left the `ui` rows as calls, so the two hand-written rows were not the same kind of thing and
the wrapper looked like it cost 40 ms. The plugin is off now and both compiled forms are handed
in by hand. A second run of the corrected bench gave 79.6, 46.3, 85.5, 112.4, 99.5.

## What this costs

A `ui` file's literal attributes are written per instance instead of cloned with the prototype.
Measured above.

`build` now names `@aweftjs/ui` in one constant, so the two packages are coupled by that name.
Design 092 said `build` knows nothing about `ui`; it now knows one specifier and nothing else
about it.

## What would reverse this

A third `h` wanting the same treatment, at which point the blessed identity becomes a list an
application configures rather than two constants, and the prototype rule becomes something the
`h` declares rather than something `build` assumes.
