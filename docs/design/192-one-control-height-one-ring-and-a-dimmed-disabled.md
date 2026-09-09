# 192: One control height, a ring drawn as a halo, a disabled state that dims, and overlays that arrive

Amends design 118's focus, disabled and motion paragraphs, and design 115's size list. Amended:
the dialog's backdrop fades after all, and design 193 supersedes the rename under "Two chains that
were wrong". Amended by design 217: every overlay arrives over 150ms on `cubic-bezier(0.4, 0, 0.2,
1)`, and the ring's halo stays off the root's transition list, which is why `box-shadow` is not on
it.

## Decision

### The height

**A control's entry says what its box model is.** Nothing in this package set `box-sizing` before,
so a declared height was a content height on some hosts and a border-box height on others: measured
in Chromium, a `<button>` and a `<select>` are border-box and an `<input>`, a
`<textarea>` and an `<a>` are not, and the same `height: 36px` came out 36px on one and 54px on the
next. `button` and `input` declare `border-box`, so the height each of them names is the height it
is. `$space` of vertical padding on both leaves the line height room inside it.

`$control` is 36px and every control is that tall at rest: `button`, `input`, `select`, the
`slider` hit area, and the row a `field_inline` lays out, which is what a checkbox, a radio and a
toggle sit in. `$controlSm` is 32px and `$controlLg` is 40px, defined here for the size axis of a
later pass and used by nothing yet. `textarea` keeps its own minimum, because a text area is sized
by its content.

`$target` stays 24px and keeps its old job: the smallest a pointer target may be, for the things
that are not controls. It stopped being what a control's height is set from, which is what it was
doing before, and a 24px button next to a 36px field is most of why the gallery looked unfinished.

### The ring

The root's `:focus-visible` rule was `outline: $ringWidth solid $ring` with an offset. It is now

```
outline: none;
border-color: $ring;
box-shadow: 0 0 0 $ringWidth color-mix(in srgb, $ring 50%, transparent);
```

with `$ringWidth` at 3px. `$ringOffset` is gone, because a halo drawn as a box shadow starts at
the border box and needs no offset to sit clear of it.

Design 118 said no entry in this package writes `outline: none`. One does now, and it is the rule
that draws the ring: the halo replaces the outline rather than removing it. Design 119's gate
check already states the rule this has to meet, that an entry turning an outline off names `$ring`
in the same block, and this block names it twice.

The shadow is `.awN:focus-visible` and the hairline below is `.awN`, so the pseudo-class outranks
it and the ring is what a focused input shows. The hairline is not concatenated into the focus
rule: a 6% edge under a 3px halo is not visible, and putting it there would give every focused
element a shadow that only inputs and quiet buttons are meant to have.

### Disabled

```
background-image: none;
opacity: 0.5;
cursor: not-allowed;
```

It no longer repaints the control in `$muted` and `$mutedForeground`. A disabled danger button was
turning into a disabled default button, which loses what the control is; half opacity keeps it
recognisable. The tint stays off, as design 118 has it, so a disabled control does not light up
under the pointer.

### The hairline

`$shadowSm` is `0 1px 2px color-mix(in srgb, currentColor 6%, transparent)`, on `input` and on
`button_quiet`. It lives in `sizes.ts`, beside `$borderWidth` and `$ringWidth`: it is an edge, one
pixel of offset and two of blur, and the file that holds the widths of the lines a control is
drawn with is where a reader looks for it. `motion.ts` was the other candidate, because
`$hoverTint` and `$pressTint` are also `currentColor` at a fixed strength, but that file is about
time.

It is `currentColor` and not `$foreground` for a reason the value language forces: a `$name` holds
text and that text is not read again (design 111), so a `$shadowSm` holding `$foreground` would
put those eleven characters into the CSS. `currentColor` is what the two state tints already use,
for exactly this reason, and it is right in both modes with no second rule.

The look is drawn with borders and surface tint rather than blur shadows: this is an edge, not
elevation. Nothing in this package has a blurred shadow that lifts a block off the page.

### The overlays arrive

Design 118 said nothing in this package sets a transition of its own. Three entries do now, and
all three are overlays: `dialog`, `popup` and `tooltip`. Each takes, inside the reduced-motion
query design 118 already put every transition inside,

```
transition: opacity $fast $ease, transform $fast $ease;
```

and, at the top level of its entry, `_starting_: { opacity: 0, transform: 'scale(0.96)' }`. So an
overlay is drawn from nothing and 96% of its size to solid and full size over `$fast`, and under
`prefers-reduced-motion: reduce` it is solid in the frame it is rendered, because the starting
style is only ever read by a transition (design 190).

The dialog adds `display $fast allow-discrete, overlay $fast allow-discrete` to its list and
`opacity: 0` with the same transform on `:not([open])`, which is what makes it leave the same way
it arrived: a `<dialog>` that is not open is `display: none` and in no top layer, and both have to
be told to hold their old value for the length of the transition.

`popup` and `tooltip` animate in and not out, and the nesting design 190 gained does not change
that. What hides either is `display: none` written inline on the box the popup sink places
(`popup.tsx`, the `style` cell set in `apply`), which is an ancestor of the themed panel and
carries no theme at all: no entry reaches it, so no rule can give it a transition. Animating them
out is a change to how `Popup` hides, and that change is not made here. `Tooltip` renders its panel
inside that same box, so the same is true of it.

**The dialog's `::backdrop` fades, amended.** An earlier shape said it could not, because keeping
the backdrop's transition inside the reduced-motion query needed a `_cssProp_` inside a `_media_`.
Design 190's amendment allows exactly that, one level deep, so the entry now carries
`'_media_(prefers-reduced-motion: no-preference)': { '_cssProp_::backdrop': { transition: … } }`,
a `_starting_` inside the top-level `_cssProp_::backdrop`, and `opacity: 0` on
`:not([open])::backdrop`. Measured in Chromium: the backdrop's opacity is `0` in the frame after
`showModal()`, 0.31 two frames later and `1` once 300ms have passed, and `1` in the first frame
under `page.emulateMedia({ reducedMotion: 'reduce' })`, for the same reason the dialog is.

### Two chains that were wrong

**A field's label, description and error took the field's own layout, superseded.**
They were reached as `theme: ['field', 'label']`, and an entry matches when its segments are a
subsequence of the class list (design 111), so that list also matched the bare `field` entry and
the label became a flex column of `width: 100%`. Beside a checkbox it took the whole row and pushed
the box onto a line of its own. The fix here was to rename them `fieldlabel`, `fieldhint` and
`fielderror`, one segment each. Design 193 undid that rename and fixed the matching rule instead,
because four other parts had the same bug and none of them had had the same workaround. They are
`field_label`, `field_hint` and `field_error` again, reached as one class token each. `field_inline`
keeps the `min-height: $control` this note gave it, so the row a control sits in beside its words
is the same height as the control.

**A select lays its content out in a line.** `select` extends `input`, which is `display: block`,
and a `<select>` in the base appearance is a flex container that lays out its own button, its
selected value and the host's picker icon. As a block those stack: 58px tall against the field's
38px, measured in Chromium before anything else here changed.
It now declares `display: inline-flex`, `align-items: center` and the `width: 100%` that `display`
would otherwise have carried, and it measures 36px beside a 36px field.

## Why

The gallery's styling and interaction read as unfinished in three places, and each is one rule.

A page of controls at different heights has no baseline, and every control here was `min-height:
$target` with its padding deciding the rest, so a button and a field were different heights by
accident rather than by choice. One named height is what makes a row of controls a row.

An outline is drawn outside the border box and cannot be soft, so a 2px ring at a 2px offset reads
as a second border rather than as focus. A translucent halo reads as focus, and taking the border
to `$ring` at the same time means the control's own edge moves with it rather than being covered.

A disabled control that changes colour has changed what it is. Dimming says the same thing without
lying about the control.

## Evidence

`packages/ui/tests/look.test.ts` reads the compiled rules: the three heights and the height on each
control, the box model, the focus rule's three declarations with `$ring` resolved inside the
`color-mix`, the disabled rule, the hairline on `input` and on `button_quiet`, the three overlay
entries, and that a field's parts wear no column.

`packages/ui/tests/browser.test.ts` measures the rest in Chromium.

- "every control computes the one height, and a select lays its content out in a line": a button,
  a text field and a select are each 36px, the select's `display` is `inline-flex`, a checkbox's
  box is at 170px and its label at 172px so they are on one line, and the row they sit in is 36px.
  Before this change the label was 32px below the box and the row was 54px.
- "a real Tab draws the ring as a halo and takes the border to `$ring`": at rest the input's
  computed `box-shadow` is `0px 1px 2px`, the hairline. After a real Tab, `outline-style` is
  `none`, `border-top-color` is `rgb(90, 97, 110)` which is `$neutral8`, and the shadow is
  `0px 0px 0px 3px` of that colour at alpha 0.5, with no `1px 2px` left in it. That last assertion
  is what says the focus rule beat the hairline rather than joining it.
- "a dialog is transitioned in from nothing, and reduced motion shows it at once": opacity is `0`
  in the frame after `showModal()`, 0.31 two frames later, and `1` once 300ms have passed. Under
  `page.emulateMedia({ reducedMotion: 'reduce' })` it is `1` in the first frame.

The popup measures the same way, opacity 0 then 0.65 then 1, and the assertion for it is the
compiled rule rather than the frame, because `Popup` places its box and
this package has no recipe that opens one on a timer.

`recipes/ui/main.ts` asserts the preview page's button reports `min-height: 36px`, that a real Tab
gives it the halo and moves its border to `$ring`, and that the slider's hit area is 36px.

## What this costs

An application that was reading `$ringOffset` has to stop. Nothing outside this repo uses it yet;
inside it, the systems page in `recipes/ui/page.tsx` wrote its own focus rule with it and now
names its own offset.

A control cannot be shorter than 36px without an entry of its own, which is what `$controlSm` is
for once the size axis lands.

`opacity` on a disabled control makes its whole subtree translucent, an icon inside a button
included. That is what dimming means and it is the intended reading.

**The halo does not meet the 3:1 target on its own.** The border turning `$ring` is what meets it.
`$ring` on `$background` is 6.08:1 in light and 7.39:1 in dark; the halo as painted, `$ring` at 50%
over the same background, is 2.15:1 and 2.74:1. So a theme that keeps the halo and leaves the
border alone has a focus indicator that fails WCAG 2.2 non-text contrast, and nothing in this
package would say so. No theme change: the rule already sets both, and this is written down so the
half that carries the requirement is known. Measured with the package's own `luminance` and
`readColour`.

**`box-sizing: border-box` changed what an application's own padding does.** The declared height is
the height now, so padding fits inside it rather than adding to it. A `TextField` given
`padding: '12px'` through a theme override is 36px tall with a 10px content box, where before it
was 36 plus the padding; `padding: '20px'` is more than fits and the control grows to 42px.
Measured in Chromium. It is said in the README beside the heights.

**The root entry sets no `color` (design 198).** Removing it is what stopped an `Icon` inside a
filled `Button` taking the page's foreground; the cost is that a page's own root entry now has to
set the colour beside the background it already set.

## What would reverse this

A host where `color-mix()` is not available, on which the halo is no colour at all and focus is
invisible. The fallback would be the outline again, which is why design 119's check refuses an
`outline: none` that does not name `$ring` beside it: the day the halo goes, the check makes the
outline come back.
