# 220: The slider's hover is on its thumb, not on its box

Amends design 118: `hovered` and `pressed` are still one rule for everything, and `slider` is the
first entry to answer them with rules of its own instead of taking the tint.

## Decision

**`slider` opts out of the root tint.** Two entries do it, and they are ordinary theme entries:

```
slider_hovered: { backgroundImage: 'none', … }
slider_pressed: { backgroundImage: 'none', … }
```

A class list of `['slider', 'hovered']` reaches both `hovered` and `slider_hovered`, and the chain
is sorted by where an entry's last segment matched and then by how many segments it has (design
111), so the two-segment entry is later in the chain and its `background-image: none` is what
lands. `Slider` is unchanged: it still puts the same three state segments in its class list that
every other control does, and `disabled` still dims it.

**Hover and press are drawn on the vendor pseudo-elements.** Each of the two entries tints the
track with the state tint the root already defines and scales the thumb:

```
'_cssProp_::-webkit-slider-runnable-track': { backgroundImage: 'linear-gradient($hoverTint, $hoverTint)' },
'_cssProp_::-webkit-slider-thumb': { transform: '$thumbHover' },
```

and the same pair on `::-moz-range-track` and `::-moz-range-thumb`, which is how the base entry
already writes every rule it has. `$thumbHover` is `scale(1.2)` and `$thumbPress` is `scale(1.3)`,
named on the `slider` entry beside `$thumbSize` and `$trackHeight`.

**The thumb's scale transitions at `$fast`**, declared on the two thumb pseudo-elements inside the
reduced-motion query, because the root's transition rule is written against `.awN` and does not
reach `.awN::-webkit-slider-thumb` (design 217).

**The control has `$space` of room at each end.** `slider` declares `box-sizing: border-box` and
`padding: 0 $space`, so the track is inset by 4px at both ends and a thumb scaled to 1.3 has 2.4px
of growth to put somewhere at either extreme of its travel. Without the `border-box` the padding
would be added to the `width: 100%` and the control would overflow its row.

## Why

The slider's hover was drawn as a square around a round control, and the control had no padding at
the left or the right.

Both halves of that are the same cause. The root `hovered` entry paints
`linear-gradient($hoverTint, $hoverTint)` over the element's whole background, and the element is
the `<input type="range">`, which is a full-width 36px box. The thing a person is pointing at is a
16px circle inside it, so the state was drawn as a rectangle the width of the row, running edge to
edge because the input had no padding, around a thumb that never lit up at all.

The fix is not to stop showing hover. It is to show it where the control is: the thumb, which is
what the pointer is over and what the drag will move, and the track, which is what the thumb runs
on. Scaling the thumb is the one state change in this package that is a size rather than a colour,
and it is right here because the thumb is round and small: a tint at 8% on a 16px circle is not
visible, and a 20% larger circle is.

Written as two theme entries rather than as a change to `Slider`: the state is a look and the look
lives in the theme, `Slider` keeps the same class list as every other control, and an application
that wants the tint back writes `slider_hovered` of its own the way it overrides any other entry.
The alternative was a `:hover` selector inside the entry, which would have worked in CSS alone and
would have made the slider the one control whose state comes from somewhere other than the cell
the rest of the package uses.

## Evidence

`packages/ui/tests/look.test.ts`, "the slider draws its states on the thumb and the track, not over
its own box":

- `slider_hovered` and `slider_pressed` each set `background-image: none` on the element and a
  tint on both vendor track pseudo-elements, with `$hoverTint` and `$pressTint` resolved.
- both thumb pseudo-elements take `transform: scale(1.2)` on hover and `scale(1.3)` on press.
- the base entry transitions `transform` on both thumbs at 150ms, inside the reduced-motion query
  and nowhere outside it.
- `slider` declares `box-sizing: border-box` and `padding: 0 4px`.

`packages/ui/tests/browser.test.ts`, "the slider's hover is on its thumb and not over its box",
measured in Chromium:

- the input's own computed `background-image` is `none` at rest and still `none` once a real
  hover has swapped the element's class. An earlier shape read
  `linear-gradient(color(srgb 0.615686 0.588235 0.556863 / 0.08), …)` over the whole 36px box,
  which is `$hoverTint` on the page's own foreground.
- `padding-left` and `padding-right` are `4px`, and `box-sizing` is `border-box`, so the width the
  row gave it is the width it takes.
- the thumb really does grow: a 24 by 4 pixel band immediately above the resting thumb is blank at
  rest and painted once the segment lands. Chromium reports no computed style of its own for
  `::-webkit-slider-thumb`, so this is measured off the painted pixels rather than off a style
  read, and the compiled rule above is what says by how much.

`recipes/ui/main.ts` says the same thing about the catalogue's own slider: its `background-image`
is `none` at rest and still `none` after a real hover, its padding is `4px` at each end, and the
sheet the hover compiled carries `transform: scale(1.2)` on the thumb. It keeps its existing reads
of the height, the appearance and the thumb colour.

## What this costs

Two more entries in the default theme, and two values, `$thumbHover` and `$thumbPress`.

The track is 8px shorter than the row it sits in, so a slider beside a text field no longer starts
at exactly the same x as the field's text does. That is the room the thumb needs.

A host that draws a range input with neither vendor pseudo-element gets a slider with no hover
state at all, where before it got the rectangle. Every host in the support set has one of the two.

`transform` on a vendor thumb is checked in Chromium only. The Firefox pair is written the way the
base entry writes every rule and is not measured here, because the gate runs one browser.

## What would reverse this

A second control whose state cannot be drawn on its own box either, at which point the pattern is
worth a name rather than two entries. Nothing stored or sent depends on any of it.
