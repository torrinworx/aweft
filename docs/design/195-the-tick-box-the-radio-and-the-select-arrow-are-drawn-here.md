# 195: The tick box, the radio and the select's arrow are drawn here

Amended: the arrow's entry is `select_chevron`, because `select_icon` put the segment `icon`
beside `select` and `icon` is an entry (design 193); the tick scales with the box at every size;
and the arrow is drawn in CSS rather than asked for by name. Amends design 130.

## Decision

Three things the host used to draw are drawn by this package now. Design 128 is unchanged: each of
the three is still one native element with a theme on it, and nothing here draws a control out of
`div`s.

### The tick box

`checkbox` sets `appearance: none` and draws the box:

```
$box: 16px; $tickWidth: 4px; $tickHeight: 8px; $tickStroke: 2px;
appearance: none; box-sizing: border-box;
display: inline-grid; place-content: center;
width: $box; height: $box; margin: 0; flex-shrink: 0;
border: $borderWidth solid $input; border-radius: $radiusSm; background: $background;
cursor: pointer;
```

`:checked` takes the background and the border to `$accent`. The tick is `:checked::before`: an
empty content box `$tickWidth` by `$tickHeight` with a `$tickStroke` border on its right and its
bottom in `$accentForeground`, turned 45 degrees, so the corner that is left is a tick. It is
nudged up by the stroke, because turning a rectangle about its centre leaves the long arm's end
lower than the eye reads as centred. `:indeterminate::before` is one bar across the middle. The box
is a centring grid, so the mark is its one child and neither rule needs an offset.

`accent-color` is gone. So is `$target` as this entry's size.

`radio` extends `checkbox` with `border-radius: 50%` and its own `$dot`, and its
`:checked::before` takes the tick's two borders and its turn back off by name, because `extends`
merges declarations rather than replacing a block.

Focus, hover, press and disabled all reach both through the root rules of designs 118 and 192 and
neither entry says a word about any of them.

### The select's arrow

The `select` entry declares `appearance: ['none', 'base-select']`, which is the list value design
190 added. `none` first, so every host stops drawing an arrow; `base-select` second, which Chromium
135 and later takes and which is what lets the open list, the option rows and the picker be themed.
A host that does not know the second keyword drops that declaration and keeps the first.
`::picker-icon` is `display: none`, so the host's icon is gone on a host that has one.

`Select` renders the element inside a `<span>` on the `select_wrap` part (`position: relative`,
`display: block`, `width: 100%`) with an empty `<span>` after it on the `select_chevron` part. The
`select` entry's `padding-right: $space8` is the room it sits in.

**Amended.** The arrow was an `Icon` asking the `Icons` stack for
`chevron-down`. It is now the tick's trick again: `select_chevron` is an empty content box `$chevron`
square (8px, named in `sizes.ts`) with a `$borderWidth` border on its right and its bottom in
`$mutedForeground`, `position: absolute`, `right: $space3`, `top: 50%`, turned up half its height
and then 45 degrees, so the corner that is left points down. `pointer-events: none`, and the span
is `aria-hidden`. No `Icon` import in `select.tsx`, and the entry names below are the two
already documented.

The reason is the cost this note used to name and now does not. `Icons` starts empty (design
144), so a page holding a select and no pack got the assert: `Select` was the first control that
needed one, and a control that cannot render without a dependency the stack does not ship is a
different kind of control from the other nine. The tick box and the radio dot are already drawn
this way in this same note, so drawing the arrow the same way is the shape this note already
chose, applied once more. What it gives up is an application replacing the arrow through its own
icon pack; what it gains is `select_chevron`, which an application overrides the way it overrides
every other entry, and one fewer thing a page has to have.

Nothing else about the component moves: `element` still names the `<select>`, the props are the
same, the field wiring and the ARIA are still on the select, and the arrow is `aria-hidden` with
no pointer events, so a screen reader reads the combobox and a click reaches the element under it.

## Why

The styling and the interaction are what a set of controls is read by. A tick box was the one
control whose look the theme could not reach. `accent-color` is one line and it hands the whole
box to the host: the size, the corner radius, the border, the tick's shape and its weight are the
platform's, and they are different on every one. Beside a set of controls that agree on a height,
a corner and an edge, three different tick boxes are the thing that reads as unfinished.

The same argument, twice over, for the arrow. Every host draws a different one, none of them can
be reached from a theme, and `base-select` moves it on exactly one browser family, so the closed
control looked different everywhere. Telling every host to draw none and drawing one gives one
control on every host, and `base-select` still buys the themed open list where it is understood.

Drawn on the native input rather than in a wrapper, because the input is what the keyboard, the
form and the label are attached to and design 128 is what says so. `appearance: none` takes the
drawing and leaves all of that.

## Evidence

`packages/ui/tests/look.test.ts`, "a tick box and a radio are drawn here, out of named values
only" and "a select says the appearance twice and draws its own arrow": the compiled rules, and
that the entries carry no `accent-color` and exactly one `:focus-visible` rule, which is the root's.

`packages/ui/tests/browser.test.ts`, measured in Chromium:

- "a tick box and a radio are drawn by the theme, in both modes": computed `appearance` is `none`;
  a ticked box is `rgb(28, 32, 39)` in light and `rgb(237, 239, 243)` in dark, which are `$accent`
  in each mode; a clear one is `rgb(252, 252, 253)`; `::before` is 4px by 8px with a
  `rgb(252, 252, 253)` right border and a 45 degree matrix when checked, and `content: none` when
  not; the indeterminate bar is 8px by 2px; a picked radio's dot is 8px square at `border-radius:
  50%`.
- "a tick box takes the root focus ring, which is the only ring it has": after a real Tab,
  `outline-style` is `none`, the border is `rgb(90, 97, 110)` which is `$ring`, and the shadow is
  the `0px 0px 0px 3px` halo.
- "a select carries its own arrow inside its box, and the host draws none": the wrapper is a
  `<span>` and is 36px tall, the select is 36px tall with the arrow in it, the arrow is an 8px
  border box with `1px 1px` on two sides and `none none` on the other two, `rgb(84, 90, 102)`
  which is `$mutedForeground`, `right: 12px`, `transform` is
  `matrix(0.707107, 0.707107, -0.707107, 0.707107, 0, -4)`, it is on the middle line,
  `pointer-events` is `none`, it is `aria-hidden`, it has no child nodes, `appearance` computes to
  `base-select`, and there is no `<svg>` in the wrapper at all.

`packages/ui/tests/select.test.ts`, "a select renders with no Icons above it, and the arrow is a
part of the theme": the same page that used to raise the missing-name assert now mounts, and the
arrow is an empty span.

`recipes/ui/main.ts` reads the arrow's inset, its side and the select's height off the catalogue's
select section (the controls page is gone, design 197), and axe-core finds no WCAG
2.2 AA violation on that page.

## What this costs

**The arrow is the one mark in this package an application cannot replace with a drawing of its
own.** It is a theme entry, so `select_chevron` can be given any rules at all, including a background
image; what it cannot be given is a name in an icon pack. Nothing else in the package works that
way, and it is the price of a `Select` that renders on a page with no pack.

**One more `$name` a reader has to know**, `$chevron`, and it sits in `sizes.ts` rather than on the
entry, unlike `$box` and `$tickStroke`. It is a size of the theme, beside `$control` and `$radius`,
so an application moves it where it already moves those.

**Design 130 said a select was the element and nothing else.** It is now one `<span>` holding the
element and the arrow. There is still no button, no drawn list, and no second keyboard map: the
`<select>` is the combobox and everything a person does with it is the platform's.

**A drawn tick box is 16px where the host's was 24px.** WCAG 2.2's target size is met through the
spacing exception, and axe-core with the `wcag22aa` tag finds nothing on the catalogue. An
application that wants a bigger target uses `size="lg"` or its own `$box`.

**Two more values a reader has to know**, `$tickWidth` and `$tickHeight`, plus `$tickStroke`,
`$box` and the radio's `$dot`. All five are `$name`s in the entries that use them, which is the
pattern `toggle`'s `$switchThumb` already set. Amended: the first three are redefined in
`checkbox_sm` and `checkbox_lg` as well, so the mark follows the box. `$box` alone left one 11.31px
mark in a 12px inner box and an 18px one; the three sizes now measure 9.19, 11.31 and 14.85px, in
Chromium.

## What would reverse this

A host where `appearance: none` on a checkbox leaves it undrawn rather than blank, on which the
box would be invisible. Every host in the support set draws nothing and lets the border and the
background through, which is what the box is made of.
