# 198: The root entry sets no colour, and the page's own entry does

## Decision

**The `*` entry of the default theme no longer writes `color`.** It still carries the scales, the
roles, the type scale, the sizes, the motion, the theme functions, `font-family`, the one focus
rule and the one transition. The page's colour is written by the page's own root entry, beside the
background that entry already had to set:

```ts
Theme.define({ page: { background: '$background', color: '$foreground' } });
```

Every element under it inherits, which is what `color` does. A themed element with no page entry
above it reads in the host's own default colours.

**A component entry that paints text keeps saying so.** `button` writes `$accentForeground`,
`input` writes `$foreground`, `muted` writes `$mutedForeground`, `tooltip` writes the page's
colours the other way up. None of that moves.

## Why

`*` matches every themed element, so a colour written there lands on the elements inside a control
as well as on the control. An `Icon` is themed `icon`, so an icon inside a filled `Button` took the
page's foreground rather than inheriting the button's: measured in Chromium on the catalogue, the
svg inside `#button-icon-light` computed `color: rgb(28, 32, 39)` on a
`rgb(28, 32, 39)` fill, 14 by 14 pixels and invisible. Blue on dark hid it until the theme went
monochrome (design 191) and the two colours became the same one.

It is a class of bug rather than one entry. `dots` and `dot` paint from `currentColor`, so a
`LoadingDots` inside a filled button was the same failure; so is any `text` span a caller puts in
one. The other fix considered was `color: inherit` on `icon` and on every entry meant to sit
inside a control, which is the same rule written once per entry and one entry away from wrong
again the next time one is added.

The asymmetry was already there and this removes it: `*` never wrote `background`, so a page in
dark mode already had to paint its own background. Now the page paints both, in one entry, and the
two halves cannot disagree.

## Evidence

`packages/ui/tests/browser.test.ts`, "a square button centres its icon, and the icon takes the
button's own colour": a filled `Button` holding an `Icon`, in light and in dark, with the svg's
computed `color` read off the page. It is `rgb(252, 252, 253)` on the light button's
`rgb(28, 32, 39)` fill and `rgb(15, 18, 22)` on the dark button's `rgb(237, 239, 243)`, which are
`$accentForeground` in each mode. With `color: '$foreground'` put back in `*` the icon reads
`rgb(28, 32, 39)` on the same colour, which is what the test refuses.

`recipes/ui/main.ts` drives the catalogue, the preview and the systems pages in both modes with
axe-core over each, and all three set `background` and `color` on their own page entries, so what
the change asks of an application is what those three already did.

## What this costs

**An element whose entries name no colour reads in the host's default.** Measured in Chromium
against the running catalogue: a themed element appended outside the page entry computes
`rgb(0, 0, 0)` where nothing in its chain writes `color`, and `rgb(28, 32, 39)` where its chain
holds `text`, which writes `$foreground` itself. So body copy, controls and messages still read
with no page entry above them; what changes is the bare element a caller themed with layout alone.
Black is right in light and wrong in dark, and the README says so where dark mode is explained and
shows the entry. An application that wraps its page in `<Theme value={dark}>` and writes no entry of
its own has a background it has to paint anyway, so the two arrive together rather than one at a
time.

That dark mode still colours through the page entry was measured the same way: the catalogue's dark
pane computes `rgb(237, 239, 243)` and the muted line inside it `rgb(168, 175, 187)`, which are
`$foreground` and `$mutedForeground` in dark.

**One more thing an application has to write.** One entry, two declarations, and every page in this
repo already had it.

## What would reverse this

A way for an entry to say "this colour is inherited by elements that name no colour of their own",
which CSS does not have: `inherit` on the child is the nearest thing and it is per entry, which is
the option this note turned down.
