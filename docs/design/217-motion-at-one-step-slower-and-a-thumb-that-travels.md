# 217: Motion one step slower, a curve that settles, and a thumb that travels

Amends design 118's motion paragraph (the durations, the curve and the property list) and design
192's overlay paragraph (what each overlay computes to). The state tints, the ring and the
reduced-motion rule are unchanged.

## Decision

**`$fast` is 150ms and `$ease` is `cubic-bezier(0.4, 0, 0.2, 1)`.** They were 120ms and
`cubic-bezier(0.2, 0, 0, 1)`.

**The root transition list gains `transform`.** It is now

```
transition-property: background-color, background-image, border-color, color, transform;
transition-duration: $fast;
transition-timing-function: $ease;
```

still the only transition the root declares, and still inside
`@media (prefers-reduced-motion: no-preference)`.

**`box-shadow` is not on that list.** The ring is drawn as a box shadow (design 192), so putting
`box-shadow` on the root list is the one thing design 118 refuses: a ring that fades in over 150ms
is a ring that is not there when the eye arrives at it. Transitioning every painted property and
keeping the focus ring untransitioned cannot both hold while the ring is a shadow, and the ring
wins. The day the ring goes back to an outline, `box-shadow` can join the list and this paragraph
is what says why it was not there.

Half the ring does still fade, and always has: `border-color` is on the list and the focus rule
takes the border to `$ring`. That is why design 192's own browser check waits for the border
colour instead of reading it. The halo, which is the part the eye lands on, arrives in the first
frame.

**The toggle's thumb travels over `$fast`.** The thumb is `::before` and moves with `left`, neither
of which the root rule reaches: the root's selector is `.awN`, not `.awN::before`, and `left` is
not on its list. So the entry declares its own, one level inside the reduced-motion query, which is
what design 190's amendment allows:

```
'_media_(prefers-reduced-motion: no-preference)': {
    _cssProp_before: { transition: 'left $fast $ease' },
}
```

**`$slow` and `$easeOut` stay at 240ms and `cubic-bezier(0, 0, 0.2, 1)`, and the default theme uses
neither.** Design 218 takes the pulse off `$slow`, which was its last reader; `$easeOut` has had no
reader since it was defined. They stay because they are the theme's vocabulary and an application
reaches for them the way it reaches for `$controlSm`, which also shipped before anything in this
package used it. Deleting a token an application may already name costs more than carrying two
strings.

**Every overlay re-checked at the new tokens.** Nothing about their shape moves; each is one step
slower on the new curve. What each entry compiles to, read out of the sheet by
`look.test.ts`:

| entry | the transition it declares |
|---|---|
| `popup` | `opacity 150ms cubic-bezier(0.4, 0, 0.2, 1), transform 150ms cubic-bezier(0.4, 0, 0.2, 1)` |
| `tooltip` | the same |
| `dialog` | that, plus `display 150ms allow-discrete, overlay 150ms allow-discrete` |
| `dialog`'s `::backdrop` | `opacity 150ms cubic-bezier(0.4, 0, 0.2, 1), display 150ms allow-discrete, overlay 150ms allow-discrete` |
| `dialog_sheet_*` | the four sides declare no transition of their own; they replace the base entry's `scale(0.96)` with a `translate` and travel on `dialog`'s list |

All four still start from `@starting-style` outside the query, so reduced motion draws each one
solid in its first frame.

## Why

At the old numbers the hover read as too snappy and instant, and the toggle had no motion at all.

120ms is under the threshold where a change reads as a movement rather than as a jump, and
`cubic-bezier(0.2, 0, 0, 1)` spends its whole budget decelerating: it leaves the start at full
speed, which is what "instant" means when the duration is already short. 150ms with a curve that
eases at both ends is a change the eye follows.

The toggle is the one control whose state is a position rather than a colour, and it was the one
control the root rule could not reach, because the root rule names properties and an element, and
the thumb is neither. Nothing was wrong with it; it had simply never been written.

`transform` on the root list is what a page's own entry needs to scale something on hover. Nothing
in the default theme reads it today: the overlays declare their own transitions and win with the
shorthand, and the slider's thumb is a vendor pseudo-element the root selector does not reach
either (design 220). It is on the list because the list is the contract, and design 118 already
says a component animating a property outside it has to declare its own.

## Evidence

`packages/ui/tests/look.test.ts`:

- "motion is declared only inside the query that asks whether the person wants any": the duration
  is 150ms, the curve is `cubic-bezier(0.4, 0, 0.2, 1)`, `transform` is on the property list,
  `box-shadow` is not, and nothing outside the query sets a transition.
- "the toggle's thumb travels, and only where motion is welcome": `left` transitions at 150ms on
  `::before` inside the query, and nothing outside it does.
- "every overlay arrives at the same duration and the same curve": the four rows of the table
  above, read out of the compiled sheet.

`packages/ui/tests/browser.test.ts`, measured in Chromium:

- "a hovered button transitions at the duration and the curve the theme says":
  `transition-duration` is `0.15s`, `transition-timing-function` is `cubic-bezier(0.4, 0, 0.2, 1)`
  and `transition-property` is the whole list above, read after a real hover that changed the
  button's background; the duration goes to `0s` under
  `page.emulateMedia({ reducedMotion: 'reduce' })`. It read `0.12s` at the old duration.
- "the toggle's thumb transitions its travel": `getComputedStyle(box, '::before')` reports
  `transition-property: left` at `0.15s` on `cubic-bezier(0.4, 0, 0.2, 1)`, the thumb's `left`
  moves off `4px` when the box is really clicked, and the duration is `0s` under reduced motion.
  Before the thumb declared its own transition the property read `all`, which is the host's own
  default and is what a thumb that jumps looks like.
- "a dialog is transitioned in from nothing" (design 192's, unchanged): opacity 0 in the frame
  after `showModal()`, part way two frames later, 1 once 300ms have passed.

`recipes/ui/main.ts` reads `0.15s` and `cubic-bezier(0.4, 0, 0.2, 1)` off the catalogue's own
button, and `0s` under reduced motion, which is the same claim on a real page rather than on a
fixture.

## What this costs

Every state change in the package is 30ms longer. On a page where a person is clicking through a
list, that is 30ms more before the row they landed on is settled. That is the trade, and the
number is at the low end of what reads as movement.

An application that pinned its own timings to `$fast` gets them one step slower with no change of
its own. Nothing stored or sent depends on either value.

The root list is longer by one property, so an element whose `transform` changes for a reason
nobody meant now animates instead of jumping. Nothing in the default theme has such a transform.

## What would reverse this

150ms reading as slow rather than smooth, which is one number in `motion.ts` and two tests. Or the
ring going back to an outline, at which point `box-shadow` joins the property list and the
paragraph above says why it could not before.
