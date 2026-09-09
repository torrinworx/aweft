# 115: The named values a component may use, and the rule that there are no others

Amended by designs 191 and 192: `$link` is an eighteenth role, the five roles the monochrome
default moves take other steps, `$controlSm`, `$control`, `$controlLg`, `$radiusSm` and
`$shadowSm` are new, and `$ringOffset` is gone. Amended by design 216: a fourth scale and four
`$success` roles.

## Decision

`@aweftjs/ui` ships one contract of named values. A component of this library styles itself out of
that contract and out of nothing else: no colour, size or duration is written where it is used.

**Seventeen colour roles**, each holding the value of one scale step (design 116):

| role | step | what it is for |
|---|---|---|
| `$background` / `$foreground` | neutral 1 / neutral 12 | the page and its text |
| `$surface` / `$surfaceForeground` | neutral 2 / neutral 12 | a raised block and its text |
| `$muted` / `$mutedForeground` | neutral 3 / neutral 11 | a quiet fill, and quiet text on any of the three backgrounds |
| `$accent` / `$accentForeground` | accent 9 / neutral 1 | the solid accent and the text on it |
| `$accentSubtle` / `$accentSubtleForeground` | accent 3 / accent 11 | a tinted accent fill and the text on it |
| `$danger` / `$dangerForeground` | danger 9 / neutral 1 | the solid danger and the text on it |
| `$dangerSubtle` / `$dangerSubtleForeground` | danger 3 / danger 11 | a tinted danger fill and the text on it |
| `$border` | neutral 6 | the line around a block |
| `$input` | neutral 7 | the edge of a control |
| `$ring` | accent 8 | the focus ring |

The two `Subtle` pairs are the ones added past the first list. Steps 3 to 5 of the accent and
danger scales are the component fills, and with no role over them a quiet button, a highlighted
option in a select and a danger message have no fill with readable text on it. Each is a pair, so
the rule that a fill and its text are named together still holds.

**A role holds a colour, not the name of a step.** The value language resolves a `$name` to the
text it holds and does not read that text again, so `$background: '$neutral1'` would put the four
characters `$neu` and the rest into the CSS. `roles.ts` reads the step out of `scales.ts` where the
theme is built. The mapping is one line per role, the table above is that file, and `check-theme.ts`
proves every role's value is some step's value.

**Type.** `$textXs`, `$textSm`, `$textMd`, `$textLg`, `$textXl`, `$text2xl`, each in `rem`, each
with its line height beside it as `$textXsLine` and so on. `$font` and `$fontMono` are the two
families.

**Space and shape.** `$space` is 4px and `$space2`, `$space3`, `$space4`, `$space6`, `$space8` and
`$space12` are its multiples: seven names, and no step between them. `$radius` and
`$radiusLg` are the two corner sizes. `$target` is 24px, the smallest a pointer target may be.
`$borderWidth`, `$ringWidth` and `$ringOffset` are the three line widths, named so no entry writes
one.

**Motion.** `$fast` and `$slow` are the two durations, `$ease` and `$easeOut` the two easings.

**Where they live.** One file per concept: `scales.ts`, `roles.ts`, `type-scale.ts`, `sizes.ts`,
`motion.ts`, and `modes.ts` for the two partial themes (design 117). `defaults.ts` spreads them into
the `*` entry and writes the component entries against them.

**What is gone.** `$primary`, `$surface` as a hex literal, `$ink`, `$muted` as a colour, `$radius`
as a bare number, `$gap` and `$speed` were the whole of the old default theme. `$surface`, `$muted`
and `$radius` keep their names with new meanings and the rest are replaced. The old `panel` entry is
now `card`.

## Why

Five variables and a radius is a contract narrow enough that every page built on it looks the same
and anything past the accent colour has to be written by hand. Widening it to a named set gives
the library a look of its own and gives an application somewhere to put its own, and naming
everything is what lets the gate check that a component stayed inside it (design 119).

Seventeen roles rather than a value per component is the trade the pair convention buys: a
component says which surface it sits on, and the theme says what that surface is.

## Evidence

Every pair meets WCAG 2 AA in both modes, measured from the formula rather than from this package:
`packages/ui/tests/contrast.test.ts` computes the ratio itself and asserts all twenty-two pairs at
their target. The numbers are in design 116.

## What this costs

**A wider default theme claims more entry names.** The default now writes `button`, `input`,
`select`, `card`, `popup`, `text`, `hovered`, `pressed`, `disabled` and `muted`, where it used to
write four. `defineTheme` refuses one property of one entry given two different values (design 111),
so an application cannot replace what the default already says by calling `Theme.define` again; it
puts a `<Theme value={...}>` provider on the page, which is also what scopes an override to part of
it. That was already true of the four old entries and is now true of ten. The README says so where
it used to say the opposite. What would change it is teaching `defineTheme` a replace, which
belongs to design 111 and not here.

An application that overrides a scale step does not move the roles, because a role holds a colour
rather than a reference to the step. Overriding the look means overriding the roles, which is one
entry either way. The alternative, teaching the value language to resolve a variable to another
variable, is a change to the engine of design 111 with a cycle to guard, and nothing needs it.

## What would reverse this

A component that cannot be built out of these seventeen roles without adding a colour of its own.
Then the missing role is named here and the table grows, rather than the component holding a
literal.
