# 191: The default theme is monochrome, and `$link` is the one coloured role

Amends design 115's role table. Amended by design 216: a success tone joins `$danger` and `$link`;
everything else stays monochrome.

## Decision

The default theme paints its solid controls in the neutral scale. Five roles move, one arrives,
and no scale value changes.

| role | was | is |
|---|---|---|
| `$accent` | `$accent9` | `$neutral12` |
| `$accentForeground` | `$neutral1` | `$neutral1` |
| `$accentSubtle` | `$accent3` | `$neutral3` |
| `$accentSubtleForeground` | `$accent11` | `$neutral12` |
| `$ring` | `$accent8` | `$neutral8` |
| `$link` | | `$accent11` |

`$accentForeground` did not have to move: step 1 of the neutral scale is the page in light mode
and the near-black in dark mode, and step 12 is the reverse, so one line is near-black on
near-white in light and near-white on near-black in dark. That is the whole of what "monochrome"
had to mean in two modes.

**`$link` is a text colour and has no foreground of its own.** Every other role that names a
colour a person reads is half of a pair: a fill and the text on it. A link is not a fill. It is
text on whatever background it landed on, so it is in `foregroundRoles`, which is the list the
contrast warning offers when a background has no partner in the pair table, and it is not a key of
`foregroundFor`. `button_inline`, the button that sits inside a line of text, is the one entry
that uses it.

**The accent and danger scales are unchanged**, all twelve steps of each, in both modes. They are
what an application reaches for when it wants colour: one `Theme` provider redefining `$accent`
and `$accentForeground` puts the blue back on every filled control on the page, because no
component names a scale step.

## Why

The excess colour was what threw the gallery off. A filled button, a checked box, a switch and the
focus ring were four different blues on a
page whose text was near-black, and none of them carried information: a primary button is primary
because it is filled, not because it is blue.

Monochrome by role rather than by scale, because the roles are the thing a component uses. Moving
`$accent` to a neutral step leaves every entry in `defaults.ts` written exactly as it was and
leaves an application one line from having its colour back.

## Evidence

Every pair, measured by hand from the WCAG 2 formula in
`packages/ui/tests/contrast.test.ts`, both modes, in this theme:

| pair | light | dark | target |
|---|---|---|---|
| `$accentForeground` on `$accent` | 15.94 | 16.31 | 4.5 |
| `$accentSubtleForeground` on `$accentSubtle` | 14.19 | 13.88 | 4.5 |
| `$accent` on `$background` | 15.94 | 16.31 | 3 |
| `$ring` on `$background` | 6.08 | 7.39 | 3 |
| `$ring` on `$surface` | 5.76 | 6.87 | 3 |
| `$link` on `$background` | 8.42 | 10.32 | 4.5 |
| `$link` on `$surface` | 7.99 | 9.60 | 4.5 |

Every one of them went up: the accent scale's step 9 was a blue chosen to be a fill, and step 12
of the neutral scale is the text colour, which is further from both backgrounds than any fill can
be.

`packages/ui/tests/look.test.ts` asserts each moved role holds the step this note names.
`recipes/ui/main.ts` reads the computed colours off the preview page in both panes.

## What this costs

The preview page's accent and danger swatches had no `color` of their own, so the `*` entry's
`$foreground` was the colour measured against them. Against a `$accent` that is now the foreground
itself that is 1:1, and the dev-mode contrast warning said so. Each swatch now names the
foreground it pairs with, which is the convention design 115 states and the swatches were the one
place not following it. The danger swatch was below the target before this change too.

A page that wanted the default theme to look like a brand now starts from grey. That is the
trade: the library ships a look nobody has to undo, and colour is a decision an application makes
rather than one it inherits.

## What would reverse this

An application whose primary action is not read as primary without colour. The fix is one entry:
`Theme.define` cannot replace a value the default already sets, so it is
`<Theme value={{ '*': { $accent: '#1c5fd6', $accentForeground: '#fcfcfd' } }}>` at the root, which
is what this note leaves the accent scale defined for.
