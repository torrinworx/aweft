# 199: The seven display pieces

Amended by design 207 (the `[hidden]` rule moves to the root entry), design 212 (`Kbd` goes),
design 215 (`Avatar`'s `size` takes a length and its letters scale with the box) and design 218
(the skeleton and the dots stop sharing one keyframes block: a skeleton breathes over 2s and the
dots are a 1s wave).

## Decision

Seven components that show something and answer to nothing: `Badge`, `Alert`, `Avatar`,
`Skeleton`, `Kbd`, `Progress` and `Empty`. Each is a native element the theme dresses (design
128), each part is one class token and each modifier is a segment (design 193), each size is one
segment after `type` (design 194), and each entry that paints text on its own fill says so
(design 198). None of them is interactive: a caller who wants a control writes one.

**`Badge`.** A `<span>` on `badge`, with `label` (or children) and an `icon` before it. `type` is
nothing (the `$accent` fill and `$accentForeground` on it), `quiet` (`$muted` and
`$mutedForeground`), `danger` (`$danger` and `$dangerForeground`) or `outline` (no fill, a
`$border` line, `$foreground` text). `$textXs`, weight 500, the `$radius` corner and
`$space $space2` of padding.

Its `size` axis is padding and text, not a height: `badge_sm` tightens the padding to `0 $space`
and `badge_lg` widens it to `$space $space3` and takes `$textSm`. A badge is not a control, so
`$control` is the wrong number for it: three badges on a row of a table would be three 36px
blocks. The name is the same axis every control has, because a caller asking for a small badge
beside a small button means the same word.

It never takes a handler, a `disabled` or a `href`. A badge that can be pressed is a `Button`
with `size="sm"`.

**`Alert`.** A `<div>` on `alert`, `role="alert"` when `type` is `danger` and `role="status"`
otherwise, so a message that matters interrupts and a message that does not waits its turn. It
takes `title`, `icon` and children as the body, and `type` is nothing (the `$surface` fill and a
`$border` line) or `danger` (`$dangerSubtle`, `$dangerSubtleForeground` and a `$danger` line).

Three parts: `alert_symbol`, `alert_title` and `alert_body`. The box is a grid of one column, and
an alert given an icon puts the segment `lead` in its class list, which reaches `alert_lead` and
makes the grid two columns. The icon is placed at the first column spanning both rows and the
other two place themselves, so a title, a body, either alone, or neither all lay out with no
second modifier. The alternative was one grid of two columns always; an empty first track is zero
wide but the column gap beside it is not, so every alert with no icon carried a `$space3` indent.

**The part is `alert_symbol`, not `alert_icon`.** `icon` is a top-level entry of this theme that
lays an element out, and design 193's rule refuses a key whose later segment names one, because a
class list that reaches the key by segments reaches that entry too. `select_icon` became
`select_chevron` for the same reason (design 194, amended). `Empty`'s part is
`empty_symbol` for the same reason.

The icon itself is the caller's. This package ships no drawings (design 144), so an `Icon` by name
needs an `Icons` provider above it, and `Alert` has no default icon of its own to fall back to.

**`Avatar`.** A `<span>` on `avatar` holding an `<img>` on `avatar_image` and a `<span>` on
`avatar_fallback`. It takes `src`, `alt`, `fallback`, `size` (`sm` is `$controlSm`, nothing is
`$control`, `lg` is `$controlLg`) and `round`, which is true unless it is set false and is what
picks between a circle and the `$radius` corner.

**Both children stay in the tree and one of them carries `hidden`.** The fallback shows until the
image loads and shows again if it fails, driven by a cell the image's `load` and `error` events
write through `h`'s event props, the way `Button` takes `onClick`. With no `src` the cell starts
false and the fallback is what renders first, with no image element at all. `hidden` rather than a
theme segment because `hidden` also takes the element out of the accessibility tree: an avatar
showing a photograph must not also read out the two letters behind it. Both parts therefore carry
`_cssProp_:is([hidden]) { display: none }`, because each declares a `display` of its own and the
host's own `[hidden]` rule is not an author rule and loses to it.

**`Skeleton`.** A `<div aria-hidden="true">` on `skeleton`. `width` and `height` are CSS lengths
or numbers, and go through `style`, where a bare number in a size property gets `px`. `round`
turns the corner into a circle. It never announces itself: a screen reader saying "loading" three
times because three boxes are grey is worse than silence, and the thing that is loading says so.

**One `pulse` definition, shared.** The keyframes and the animation move out of `dot` into an
entry named `pulse`, and `dot` and `skeleton` both `extends` it. The keyframes block is named
after the entry that owns it (design 111), so one definition means one `@keyframes` in the sheet
whichever of the two reached it, and the animation stays inside
`prefers-reduced-motion: no-preference`, as design 118 requires. This is the one earlier entry
this note touches, and it changes what `dot` renders in no way: the same rules reach the same
class through the chain.

**`Kbd`.** A `<kbd>` on `kbd`, with children. `$fontMono`, `$textXs`, the `$muted` fill with
`$mutedForeground` on it, a `$border` line, the `$radiusSm` corner, `$space $space2` of padding
and `minWidth: $target`, so a single letter is still the width a finger could hit.

**`Progress`.** A `<progress>` on `progress`. `value` is a number from 0 to 1 or a cell of one,
and `null` or `undefined` is indeterminate. `max` is fixed at 1 on the element, so the cell is a
fraction and nothing has to divide. `label` becomes `aria-label`. The bar is drawn with
`appearance: none`, `$space2` of height, a `$muted` track and an `$accent` bar through the three
vendor pseudo-elements, the way `slider` draws its track and thumb. `progress_sm` is `$space`
tall and `progress_lg` is `$space3`.

**The value is written as the attribute, not as `$value`.** `Slider` writes `$value`, a DOM
property, because a person types into an input and the attribute there is only the starting value.
Nobody types into a `<progress>`, and the platform has no way to make one indeterminate through
the property: the IDL setter writes the content attribute, so there is no value that unsets it. An
attribute following a cell is removed when the cell answers null, which `wireField` already relies
on for `aria-invalid`, and removing the attribute is exactly what indeterminate is.

**`Empty`.** A `<div>` on `empty`, taking `icon`, `title`, `description` and children as the
action row. Four parts: `empty_symbol`, `empty_title`, `empty_description` and `empty_actions`. A
centred column with `$space6` of padding; the description is `$mutedForeground`.

## Why

Every one of these is a shape an application writes by hand today, and every hand-written one
picks its own padding, its own text step and its own grey. That is what this set exists to stop,
and it is why the list is the components that need no new behaviour: each is an element and
a theme entry family, so what lands is names, not machinery.

They are display pieces rather than controls because none of them takes a value or an event.
That is what lets each one be a single element with no state, and it is why `size` on a badge
means padding rather than a height.

## Evidence

`packages/ui/tests/display.test.ts` covers each one in the light tree: its element, its role, the
class list it writes, `Progress` following a value cell and going indeterminate on null, the
`Avatar` fallback showing on `error` and hiding on `load` with both events dispatched at the
image, `Badge` and `Alert` resolving each `type`, and `Skeleton` announcing nothing.

`packages/ui/tests/look.test.ts` reads the compiled rules: every new entry resolves its heights,
fills and roles from names alone, `checkTheme` over `defaults.ts` still reports nothing, and the
pulse keyframes are defined once and reached by both `dot` and `skeleton`.

`packages/ui/tests/browser.test.ts` measures in Chromium what a light tree cannot answer: the
avatar's fallback replaced by a real image from a data URL, and the progress element's position at
a value of 0.5.

`recipes/ui/main.ts` reads one thing per component off the catalogue in both modes.

## What this costs

Seven more components and around thirty more entries in the default theme. The theme is the size
of the vocabulary it covers, and this is the part of that vocabulary a page shows rather than
operates.

Two parts are named `symbol` where a reader would have written `icon`. That is design 193's rule
showing through the naming, and the rule is worth more than the word.

## Amended

**A `Progress` clamps its value and refuses an element that is not a `<progress>`.** Passing 1.5,
-0.2, `NaN` and `'lots'` used to reach the attribute exactly as written. A number outside 0 to 1 is
now clamped to it, and anything that is not a finite number is indeterminate, which is the attribute
left off: this component says the value is a fraction of 1, and a component that says so is the
thing that has to make it true. A host draws 1.5 as a bar past its own track and draws `lots` as
nothing, so passing them through is two different bugs on two different browsers. The other seven
components resolve `element` with `elementFor`; this one used `element ?? 'progress'` and so
decorated a `<span>` with a bar the platform never fills. It calls `elementFor` now, with the same
message every other refusal here has.

`packages/ui/tests/display.test.ts` pins both: the four values above through one cell, and the
refusal named with the tag it was handed.

## What would reverse this

A component here growing behaviour. A `Badge` that can be dismissed, or an `Alert` that closes
itself, is a control and belongs with the controls, with a design note of its own saying what it
answers to.
