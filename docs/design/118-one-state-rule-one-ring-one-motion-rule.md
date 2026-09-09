# 118: One state rule, one focus ring, one motion rule

Amended by design 192: the ring is a translucent halo drawn as a box shadow rather than an outline,
`disabled` dims rather than repaints, and three overlay entries declare a transition of their own.
Amended by design 217: `$fast` is 150ms, `$ease` is `cubic-bezier(0.4, 0, 0.2, 1)`, `transform`
joins the property list and `box-shadow` stays off it, and the toggle's thumb transitions its
travel. Amended by design 220: `slider` answers `hovered` and `pressed` with rules of its own
instead of taking the tint. The tint rules below are otherwise unchanged.

## Decision

**States.** Two entries, `hovered` and `pressed`, lay a translucent tint of the element's own
foreground over whatever background it has:

```
hovered: { backgroundImage: 'linear-gradient($hoverTint, $hoverTint)' }
pressed: { backgroundImage: 'linear-gradient($pressTint, $pressTint)' }
```

`$hoverTint` and `$pressTint` are the element's `currentColor` mixed to two fixed strengths, 8% and
16%. Because the tint is the foreground the element already has, one rule covers every component in
both modes, and no component names a hover colour. `pressed` wins over `hovered` when both segments
are on the element, because the entry whose segment appears later in the class list is later in the
chain. `disabled` clears the tint, so a disabled control does not light up.

There is no ripple, and nothing here animates a position.

**Focus.** The `*` entry carries `_cssProp_focusVisible: { outline: '$ringWidth solid $ring',
outlineOffset: '$ringOffset' }`. `*` matches every themed element, so every themed element has a
ring and no component writes one. `$ringWidth` is 2px and `$ring` is at least 3:1 against
`$background` and `$surface` in both modes (design 116). No entry in this package writes
`outline: none`, and `check-theme.ts` refuses one that does without a ring beside it (design 119).

**Motion.** Nothing in this package sets a transition of its own. The `*` entry sets one, inside
the query that asks whether the person wants motion:

```
'_media_(prefers-reduced-motion: no-preference)': {
    transitionProperty: 'background-color, background-image, border-color, color',
    transitionDuration: '$fast',
    transitionTimingFunction: '$ease',
}
```

The outline is not on that list, and it was: a ring that fades in over 120ms is a ring that is not
there when the person's eye arrives at it, and reading the computed colour one frame after a real
Tab is what showed it.

Written the other way round, as a `prefers-reduced-motion: reduce` override in `*`, the rule
loses: a media query adds no specificity, `*` is first in every chain, and the component's own
transition is emitted after it. Declaring motion only inside `no-preference` has no ordering to
lose, because nothing else declares any.

## Why

A translucent overlay of the foreground at two fixed opacities, one rule, no per-component hover
colours, and no ripples. The overlay is `currentColor` rather than a
role, so it needs no per-component variable and it is correct in dark mode with no second rule.

The ring at the root is the same shape of answer: a component that has to remember an
accessibility rule forgets it, so the rule is somewhere no component has to remember.

## Evidence

`packages/ui/tests/look.test.ts` reads the compiled rules, in "hover and press are one rule each,
and press is the stronger of the two", "the ring is set once at the root, so an element that asked
for no ring has one", "no entry in this package turns an outline off" and "motion is declared only
inside the query that asks whether the person wants any". `packages/ui/tests/browser.test.ts` and
`recipes/ui/main.ts` assert the rendered result: a real hover changes the computed background, a
real Tab shows a visible outline, and `page.emulateMedia({ reducedMotion: 'reduce' })` takes the
transition duration to zero.

## What this costs

`color-mix()` is what makes the tint follow the foreground. It needs a browser from 2023 or later.
The fallback where it is unsupported is no tint, which is a state that does not show rather than a
page that breaks.

The transition list is fixed, so a component animating some other property gets no transition from
the root and has to declare its own inside the same query.

## What would reverse this

A component whose state cannot be read at these two strengths, at which point the strengths are
named per component as `$hoverTint` in its own entry, which the value language already allows and
this rule already reads.
