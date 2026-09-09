# 222: `ColorPicker` is a plane and two sliders

Reverses design 139's four sliders: the saturation and the brightness sliders are gone and a
square with a draggable thumb is in their place. Everything else design 139 decided still holds
and is repeated below where it matters.

## Decision

**A saturation and brightness square, and the hue and the alpha on the sliders they were on.**

| part | what it is |
|---|---|
| `colorpicker_swatch` | the colour as it stands, `aria-hidden`, unchanged |
| `colorpicker_plane` | the square. Saturation runs left to right and brightness bottom to top |
| `colorpicker_plane_thumb` | where in the square the colour is, painted that colour |
| `colorpicker_track` and its `hue` | the hue `Slider`, a real range input, unchanged |
| `colorpicker_track` | the opacity `Slider`, still only when `hasAlpha` is not false |

**The plane is three layers and the theme draws two of them.** The base is the current hue at full
saturation and full brightness, which only exists at run time, so it is the one thing the component
writes: `background-color` in the element's inline `style`, exactly the way design 139 already had
the component write its gradients. Over it the entry lays two gradients, both named on the entry
because that is where a literal belongs (design 111): `$planeTint`, white to transparent left to
right, and `$planeShade`, transparent to black top to bottom. Saturation is therefore how far the
white has thinned out and brightness is how far the black has, and the two gradients are a look an
application replaces the way it replaces any other entry.

The component writes a colour and the theme writes an image, so the two do not fight: an inline
`background-color` and a themed `background-image` are different properties and both land.

**The thumb is `role="slider"`, and it carries both axes in one string.** There is no two-axis role
in ARIA. `slider` is one value on one range, and the two candidates for a square are two nested
sliders, which reads as two controls a person has to find and switch between, or one that says both.
This is one that says both:

```
role="slider" tabindex="0" aria-label="Saturation and brightness"
aria-valuemin="0" aria-valuemax="100"
aria-valuenow="40" aria-valuetext="saturation 40%, brightness 80%"
```

`aria-valuenow` is the saturation, because a number has to be one number and saturation is the axis
the arrows reach first. `aria-valuetext` is what a screen reader actually reads, and it says both,
so what a person hears on arriving is "Saturation and brightness, slider, saturation 40%,
brightness 80%", and after each arrow the text again with the one number that moved. The hue and
the opacity are separate controls with their own labels and their own announced numbers, as before.

**The keyboard is the drag behaviour's** (design 221), on the thumb: left and right move
saturation, up and down move brightness, Home and End take saturation to its ends, and Shift makes
any of them coarse. One step is a hundredth of the range, which is one percent of saturation or
brightness, and a coarse step is ten. The pointer half is on the plane, so a press anywhere in the
square moves the thumb there and a drag that leaves the square keeps working.

**Size: the plane is `$planeSize` square and there is no `size` prop.** `$planeSize` is 160px, a
name in `sizes.ts` beside `$chevron` for the same reason: an application that wants a bigger square
moves one value in the theme it is already overriding. The size axis of design 194 is the eight
controls, and each of those is one native element whose height is the row it sits in.
`ColorPicker` is a composite of several elements with no single height, so a `size` on it would
have to mean the plane, the two sliders and the swatch all at once, and each of them is already
sized by an entry. That is three axes wearing one name, so the picker takes none of them.

**What does not change.** `value` is a cell of CSS colour text, anything `readColour` reads,
written back as `rgb()` or `rgba()`; text that is not a colour is an assert naming the text.
`hasAlpha` and `disabled` are what they were. Mounting a picker on a colour leaves that colour and
its notation alone: a drag, a key or a slider writes, and nothing else does. Writing the cell from
outside moves the thumb and the sliders. With `hasAlpha` false a write keeps the alpha the cell
arrived with. A colour with no hue of its own keeps the hue the person chose rather than snapping
to zero, for design 139's reason unchanged.

**Motion.** The thumb has no transition on its travel: it is placed with `left` and `top`, which are
on no transition list including the root's, so it arrives in the frame the pointer did rather than
easing after it. Its hover and press are design 220's slider thumb: `colorpicker_plane_thumb_hovered`
and its `pressed` turn the root tint off and scale the thumb. The scale needs no rule of its own,
because this thumb is a real element and the root's transition rule reaches it with `transform`
already on the list (design 217), which is what the slider's vendor pseudo-element could not have.
The scale goes on `transform` and the centring on `translate`, so the two do not overwrite each
other.

**The plane declares `touch-action: none`**, or a finger scrolls the page instead of dragging.

## Why

The picker is a composite component built out of what this stack already has: a square with a
draggable, keyboard-driven thumb, and the hue and the alpha on the existing `Slider`.

Design 139 chose four sliders because a square is geometry this package had decided not to write.
What has changed is that the geometry is written once now, in `drag.ts`, and is the same geometry
`Select`'s list and any later two-axis control want. Design 128's own reversal clause is this case
stated in advance: a control the platform has no element for is built the other way with a note of
its own, and the native ones stay where they are. The hue and the alpha stay native because they are
one axis each and a range input is exactly that.

Two sliders fewer is also two things fewer to find. Saturation and brightness are not two numbers
a person picks; they are one place in a colour, and a square is where that place is.

## Evidence

`packages/ui/tests/composites.test.ts`: the plane and its thumb are there with the hue slider and
without the two that went; a pointer press in the plane writes saturation and brightness into the
cell; an arrow on the thumb writes; the hue slider still writes; the cell written from outside
moves the thumb's inline position and its `aria-valuetext`; `hasAlpha` false takes the opacity
slider off and keeps the alpha; mounting on a colour writes nothing in any of three notations; and
text that is not a colour still asserts naming the text. Each of the first three describes
behaviour the component as design 139 left it did not have.

`packages/ui/tests/look.test.ts`, "the colour plane is a square the theme shades, and its thumb
answers its own states": the plane entry carries both gradients in that order, `touch-action: none`
and no background colour of its own, and is `$planeSize` square; the thumb is centred with
`translate` and named on no transition list, and its two state entries turn the root tint off and
scale it to 1.2 and 1.3.

`packages/ui/tests/browser.test.ts`, in Chromium: a real pointer drag across the plane moves the
thumb's inline position and writes the cell; a cell written from outside moves the thumb to where
that colour says; the plane measures 160 by 160; an arrow on the focused thumb writes; and axe-core
finds no WCAG 2.2 AA violation over the picker. The audit is scoped to the component, because the
page around it there is that file's blank harness and its missing title is not the picker's.
`recipes/ui/main.ts` is where axe reads a whole page.

`recipes/ui/main.ts` drives a real pointer across the catalogue's own plane and a key on its thumb.

The suite pins the plane's move writing the cell, the thumb's position following the cell, and the
hue slider's write.

## What this costs

**The one drawn control in the package.** Every other control is a native element (design 128) and
this is a `<span>` with a role on it, so its keyboard, its announced value and its focus are this
package's to get right rather than the platform's. That is the price of two axes and design 128
already named it.

**One announced number for two axes.** A person driving by keyboard hears both in the value text
and gets one in `aria-valuenow`. A screen reader that reads only `aria-valuenow` reads the
saturation and not the brightness. The alternative was two nested sliders, which is two controls to
tab between for one place, and it is worse.

Saturation and brightness are no longer separately typeable. Nothing typed them before either:
they were range inputs. A page that wants a number puts a `TextField` on the same cell, which
still works, because the cell is text.

## What would reverse this

The square proving harder to operate by keyboard than the two sliders were, or a real screen
reader reading the plane in a way the value text does not fix. Either is this component, not the
behaviour under it: `drag.ts` stays where it is and the plane goes back to two `Slider`s.
