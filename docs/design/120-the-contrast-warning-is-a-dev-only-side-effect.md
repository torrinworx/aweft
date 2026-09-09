# 120: The contrast warning is a dev-only side effect of an assert

## Decision

When the theme engine compiles a chain, it measures the pair that chain resolves and warns if the
pair is unreadable:

```
ui: theme chain "card" resolves color rgb(84, 90, 102) on background rgb(237, 239, 243) at
3.87:1, below the 4.5:1 WCAG 2 AA target for text. Use $mutedForeground, the foreground paired
with $muted.
```

**What is measured.** The last `color` and the last `background` or `backgroundColor` the chain
declares, at the top level of an entry. Declarations inside `_cssProp_`, `_media_` and the other
blocks are not measured.

**Theme-derived pairs only.** Both values have to have come through a `$name` or a `$fn()`. A pair
written as two literals is the page's own business and is not measured, which is what stops the
warning firing on a page that deliberately writes its own colours.

**The role suggested** comes from the pair table in `packages/ui/src/roles.ts`, which is the pair
convention of design 115 written down beside the roles it pairs. A background outside that table, a
scale step or a name this package does not ship, has no partner to name: the message measures the
foreground roles the theme defines against that background and names the ones that reach the target,
or says that none do. It never spells a role name out of a pattern, because
`$backgroundForeground` and `$neutral3Foreground` are names nothing defines.

**Alpha is composited before measuring.** `$alpha` is a theme function this package ships, so a
`color` can arrive translucent, and its opaque channels are not what a person reads.
`$alpha($foreground, 0.15)` on `$background` is 1.35:1, not the 15.94:1 the channels alone say. The
colour is mixed into the background, per channel, and the ratio taken of the mixture.

**A translucent background is not measured at all.** What is behind it is the page, which the engine
cannot see from a compiled chain, so any number would be a guess. The pair is skipped. That is the
one gap in this warning, and a page that paints text on a translucent panel gets no reading of it.

**Dev only.** The call is the whole of one statement inside `assert(...)`, which is the shape a
release build removes (design 097). There is no flag to set and nothing to switch off: the code is
not in the built file.

## Why

The design system holds to WCAG 2.2 AA, and a warning has to name the ratio, the target and the
role to use. The gate check of design 119 catches a component that wrote a literal; it cannot
catch a theme whose named values happen to be unreadable together, because both sides are named.
This catches that, at the moment the pair is first used, in the application's own console.

It sits in the engine rather than in the check because only the engine knows what a chain resolved
to. Two entries can each be fine and the chain they form can be unreadable.

## Evidence

`packages/ui/tests/contrast.test.ts` plants a theme whose named pair is 3.01:1, compiles a chain
through the public surface with `console.warn` stubbed, and asserts the message carries the measured
ratio, the 4.5 target and the paired role. The same test asserts nothing is warned for a literal
pair and nothing for a pair that passes, that `$alpha($foreground, 0.15)` on `$background` warns at
the composited ratio worked out in the test by hand, that the same colour at 0.9 does not warn, and
that a background named by a call is offered only foreground roles that exist and measure up. `packages/ui/tests/internal.contrast.test.ts` checks the
message builder alone. The release behaviour is checked by running this package's own transform over
the engine source with `release` set and asserting the call is gone.

## What this costs

Every chain a dev build compiles is walked once more and one ratio is computed. A chain is
compiled once per render per class, and the walk is over entries already in hand.

The measurement is 4.5:1 whatever the type size, so a heading at 3.2:1 that WCAG would pass as
large text is warned about. Overshooting a warning is the cheaper mistake.

## What would reverse this

The warning proving noisy on a real application's theme, at which point the large-text case learns
to read `$textXl` and up.
