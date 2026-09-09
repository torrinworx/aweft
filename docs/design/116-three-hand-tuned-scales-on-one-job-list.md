# 116: Three hand-tuned scales, twelve steps each, on one job list

## Decision

Three colour scales ship, `neutral`, `accent` and `danger`, twelve steps each, written out light
and dark. Every step is a named value: `$neutral1` to `$neutral12`, `$accent1` to `$accent12`,
`$danger1` to `$danger12`, in the same `$name` namespace as the roles.

**The job list is the same for all three.**

| steps | job |
|---|---|
| 1, 2 | backgrounds: the page, and a raised surface |
| 3, 4, 5 | component fills, at rest, hovered and pressed |
| 6, 7, 8 | lines: a block's border, a control's edge, the focus ring |
| 9, 10 | solids: a filled control, and the same filled control pressed |
| 11, 12 | text: the quiet one, and the high-contrast one |

A ramp descends from step 1 to step 10 in light mode and climbs in dark mode. Step 11 steps back
towards the middle on purpose: it is the quiet text colour, and a text colour is chosen for its
ratio against the backgrounds rather than for its place in the ramp.

**No generator.** The values are written down. This package gains no colour maths for them, and
`color.ts` is untouched.

## Why

Hand-tuned scales, three of them rather than five. Three is what the roles need: one neutral for
surface and text, one accent, one for danger. `success` and `warning` are out of scope.

A generator was measured and rejected: sweeping value through the HSV maths already in `color.ts`
cannot produce a compliant ramp. Step 12 of a swept `#02CA9F` ramp reached Lc 73.8 against a 90
target, and step 1 came out a saturated mint rather than a background. Hand-tuned values avoid the
problem and add nothing to the package.

## Evidence

The twenty-two pairs the roles form, measured from the WCAG 2 formula written out by hand in the
test, all pass in both modes. Lowest in each group:

| pair | light | dark | target |
|---|---|---|---|
| `foreground` on `background` | 15.94 | 16.31 | 4.5 |
| `mutedForeground` on `muted` | 6.02 | 7.24 | 4.5 |
| `accentForeground` on `accent` | 5.60 | 6.31 | 4.5 |
| `dangerForeground` on `danger` | 5.67 | 5.60 | 4.5 |
| `accentSubtleForeground` on `accentSubtle` | 7.09 | 8.45 | 4.5 |
| `dangerSubtleForeground` on `dangerSubtle` | 7.07 | 8.26 | 4.5 |
| `border` on `surface` | 3.21 | 3.65 | 3 |
| `border` on `muted` | 3.01 | 3.34 | 3 |
| `input` on `surface` | 4.23 | 5.09 | 3 |
| `ring` on `surface` | 3.90 | 4.88 | 3 |

`packages/ui/tests/contrast.test.ts` asserts every one of them. The ratio in that test is computed
from the formula in the test file, not read from `color.ts`, so a change to this package's own
luminance code cannot make a failing scale pass.

## What this costs

Six ramps of twelve values are hand maintenance. A step nobody uses still has to be a sensible
colour, because an application may reach for it. In exchange nothing has to be generated at import
and no colour maths can drift.

The light neutral ramp jumps hard from step 5 to step 6, because step 6 is the first step that has
to be visible against the page and 3:1 against near-white is a mid grey. That is the accessibility
target showing through the ramp, and it is deliberate.

`$border` on `$muted` is the tightest pair the theme ships, at 3.01:1 in light. It is what a
disabled control is: `$muted` fill, `$border` edge. Nothing is left over there, so a change to
light `$neutral3` or `$neutral6` moves it under the target, which is what the test is for.

## What would reverse this

A fourth or fifth scale arriving with the components, at which point writing five ramps by hand is
worse than a generator that can be shown to hit the targets.
