# 216: A success tone

Amends design 191, which made the default theme monochrome apart from `$link`, and design 115's
role table.

## Decision

**Four roles arrive**: `$success`, `$successForeground`, `$successSubtle` and
`$successSubtleForeground`, light and dark, the same pair shape `$danger` has (design 115).

**A fourth scale arrives** to build them from, `$success1` to `$success12`, light and dark, on the
same job list as the other three (design 116): 1 and 2 backgrounds, 3 to 5 fills, 6 to 8 lines, 9
and 10 solids, 11 and 12 text. The roles take the same steps `$danger` takes: 9 for the solid, 3 for
the tinted fill, 11 for the text on it, and the page's own step 1 for the text on the solid.

```
light  1 #f6fdf8  2 #ebfaf0  3 #d8f4e2  4 #c0ebd0  5 #a2debb  6 #7aca9d
       7 #4bb17d  8 #1e9460  9 #0d7a4c 10 #076741 11 #04593a 12 #062d1f

dark   1 #0b1712  2 #0f1f18  3 #122b1f  4 #153726  5 #18442d  6 #1f603f
       7 #277a51  8 #2f9764  9 #35a870 10 #46bd82 11 #62d79b 12 #ccf6de
```

**Measured with this package's own `contrastRatio`**, against the 4.5:1 the theme's
warning asks of text, with the danger scale's numbers beside them:

| pair | success | danger |
|---|---|---|
| light, `$successForeground` on `$success` | 5.24 | 5.67 |
| light, `$successSubtleForeground` on `$successSubtle` | 7.20 | 7.07 |
| dark, `$successForeground` on `$success` | 6.25 | 5.60 |
| dark, `$successSubtleForeground` on `$successSubtle` | 8.42 | 8.26 |

**`type="success"` on `Alert` and on `Badge`.** An `Alert` of this type keeps `role="status"`, not
`role="alert"`: a thing that went right waits its turn, and interrupting a screen reader to say so
is what `danger` is for. The entries are `alert_success` and `badge_success`, each the mirror of the
danger one.

**The default theme stays monochrome otherwise.** No other entry takes a success colour, and the
neutral scale still paints every solid control, the checked box, the toggle and the ring (design
191).

## Why

A success tone belongs beside `$danger`. Without one, an application that wants to say something
went right has nowhere to go: `$danger` has no counterpart, and `Alert` and `Badge` have no
`success`.

A full twelve-step scale rather than three literal values: the roles are built from steps, one
line per role, and that is what stops a colour being written where it is used (design 115's own
rule, checked by `check-theme.ts`). The danger scale ships twelve steps and its roles use three of
them, for the same reason: an application reaching for a success border wants `$success7` to be
there.

Green rather than any other hue, and this green rather than a brighter one: the light solid has to
carry near-white text at 4.5:1, which rules out every green light enough to read as a highlight,
and the dark solid has to carry the near-black page colour, which rules out the dark ones. The two
ends are what fixed the middle, exactly as they did for danger.

## Evidence

`packages/ui/tests/contrast.test.ts`: the four pairs above measured through the package's own
`contrastRatio`, asserted at or above 4.5, with the expected values worked out from the WCAG 2
formula rather than read off the implementation.

`packages/ui/tests/look.test.ts`: `alert_success` and `badge_success` compile from names only in
both modes, and `checkTheme` over `defaults.ts` reports nothing.

`packages/ui/tests/display.test.ts`: an `Alert` of `type="success"` is `role="status"` and carries
the segment; a `Badge` of `type="success"` carries it.

`packages/ui/tokens.txt` gains the twenty-four step names and the four role names, which is the
committed list `npm run theme` regenerates.

`packages/ui/tests/browser.test.ts`, measured in Chromium: the success alert's computed `color` and
`background-color` in both modes, at the ratios above.

## What this costs

Twenty-four more named values in a theme an application may override, of which the default theme
uses six. That is the cost the danger scale already pays.

The theme is no longer monochrome plus one link colour; it is monochrome plus a link, a danger and
a success. Design 191's argument was that a solid control should not be coloured, and no control
here is: the two tones are for a message about what happened.

## What would reverse this

A default theme that has to be neutral throughout, which design 191 already turned down for
danger. Nothing about the wire or an application's stored state depends on either.
