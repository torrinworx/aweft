# 139: `ColorPicker` is four `Slider`s over the colour functions

Reversed in part by design 222: the saturation and brightness sliders are a drawn square with a
draggable, keyboard-driven thumb. The hue and the opacity are still `Slider`s, and everything here
about `value`, `hasAlpha`, both directions and the kept alpha still holds.

## Decision

`ColorPicker` is four range inputs and a swatch. It draws no gradient square, tracks no pointer and
measures no box: every control on it is a `Slider`, which is a native range input (design 128).

**`value` is CSS colour text.** Anything `readColour` reads goes in: a hex, `rgb()`, `rgba()`,
`hsl()`, `hsla()`, one of the sixteen CSS names, or `transparent`. Text it cannot read is an assert,
loud in development and stripped in a release build, naming the text. The component writes the cell
back as `rgb()` or `rgba()` through `writeColour`, which is the one spelling this package writes
anywhere.

**Four sliders.** Hue 0 to 360, saturation 0 to 100, brightness 0 to 100, and opacity 0 to 100, the
last shown only when `hasAlpha` is not false. Each carries a label, so each is found by name and each
announces its number. The swatch sits beside them, `aria-hidden`, because it says the same thing the
four sliders already say.

**Both directions.** Moving a slider writes the cell, and nothing else does. Mounting a picker on a
colour leaves that colour and its notation alone, so a page that stored `#1b6ef3` still has
`#1b6ef3` after the picker has drawn. Writing the cell from outside moves the sliders. The component
does not re-read the cell after writing it, so a colour whose hue is undefined (a grey, a black)
keeps the hue the person chose rather than snapping to zero.

**A hidden opacity slider keeps the alpha it was given.** With `hasAlpha` false there is no control
on the screen for the alpha, so a write carries over the alpha the cell arrived with rather than
making the colour opaque. Both measured uses pass `hasAlpha: false`, so this is the path both of
them take.

**HSV, not HSL.** The colour functions this package already has work in HSV, because that is the
space in which brightness means what a person means by it. `color.ts` gains two internal exports for
it, `hsvOf` and `fromHsv`, which were already there and private; nothing new is computed.

**No literal colour anywhere.** The hue track is a gradient of six hues, named `$hue0` to `$hue300`
in the picker's own theme entry, which is where the theme check allows a literal to be written
(design 111).

The other three tracks show the range at the colour that is chosen now, which only exists at run
time. There is no theme name for it, so the component builds the text itself: it reads the cell,
works out the two end colours with `fromHsv` and `writeColour`, joins them into a
`linear-gradient(to right, ..., ...)` string and puts that string in the element's inline `style`.
The theme check scans source text for values written where they stand, and this gradient is
arithmetic on what the caller put in `value` rather than anything anybody typed, so there is nothing
in the source for the check to see. That is the whole reason it passes: not an exemption, an absence.

**The tracks are the element's own background.** A range input draws its track on a vendor
pseudo-element, and an inline style cannot reach one. So the picker's slider variant makes those
pseudo-elements transparent and the gradient goes on the input itself. It is the same bar in the same
place; what changes is which box paints it.

## Why

`ColorPicker` is four sliders over the colour functions because both uses need alpha. Measured
across the five applications: two uses, both
`value={picked} hasAlpha={false}`, each converting what the cell holds to CSS text on every change.
The native colour input has no alpha at all, which is why this is the one control in the catalogue
that is not one native element.

Four native range inputs rather than a drawn saturation square: the keyboard, the announced value
and the pointer handling come with the element, and a square would be geometry this package has
decided not to write.

## What this costs

There is no eyedropper, no palette of recent colours, and no hex field. A page that wants a hex
field puts a `TextField` on the same cell, which works because the cell is text.

A colour with no hue of its own, a grey or a black, has a hue slider whose position is arbitrary
until it is moved. That is what HSV is, not a defect, and keeping the chosen hue rather than
re-reading it is what stops the slider jumping to red the moment brightness reaches zero.

## What would reverse this

An application needing a colour in a space this package does not read, `oklch()` for instance.
That is `readColour` and `writeColour` growing a notation, not a change here.

## Evidence

`packages/ui/tests/composites.test.ts` finds all four sliders by their labels, drives the cell from
outside and reads the slider values, fires an `input` on a slider and reads the cell, asserts
`hasAlpha: false` hides the fourth, counts the writes to prove that mounting on a colour writes
nothing, checks that a hidden opacity slider keeps the alpha the cell had, and asserts that text
`readColour` cannot read is an assert naming the text. `packages/ui/tests/browser.test.ts` presses End on a real slider in Chromium and
reads the cell.
