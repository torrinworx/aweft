# 194: The size axis is one theme segment after `type`

Amended: the square size puts the segment `square` in the class list rather than `icon`, because
`icon` is an entry of this theme and the bare segment compiled it onto the button. The public prop
is unchanged.

## Decision

`Button`, `TextField`, `TextArea`, `Select`, `Checkbox`, `Radio`, `Toggle` and `Slider` each take
a `size` prop: `'sm'`, `'lg'`, or nothing. A value or a cell, like every other display prop.

```tsx
<Button label="Save" size="sm" />
<TextField label="Email" size={compact.bool('sm', null)} />
```

It is one theme segment, placed right after `type`, so the entries are modifiers exactly as
`quiet` and `danger` are: `button_sm`, `button_lg`, `input_sm`, `input_lg`, `checkbox_sm`,
`checkbox_lg`, `radio_sm`, `radio_lg`, `select_sm`, `select_lg`, `toggle_sm`, `toggle_lg`,
`slider_sm`, `slider_lg`. No component grows a branch and no entry is generated: a size is a
segment in a class list and an entry in the default theme, and an application replaces one the way
it replaces any other.

**Three heights, and everything else follows from a name.** `$controlSm` 32px, `$control` 36px,
`$controlLg` 40px, all three already in `sizes.ts` from design 192. A small control takes `$textXs`
with its line height and `$space2` of horizontal padding; a large one keeps `$textSm` and takes
`$space4`. A large button's padding is already `$space4`, so `button_lg` is its height and nothing
else.

The three drawn controls scale by redefining their own `$name`s and nothing else, because a
`$name` is supplied by the most specific entry in the chain that defines it (design 111) and the
rules that read it are on the entry above:

| entry | what a size redefines |
|---|---|
| `checkbox` | `$box`: 16px, 14px small, 20px large |
| `radio` | `extends` the matching `checkbox` size, plus its own `$dot` |
| `toggle` | `$switchWidth`, `$switchHeight`, `$switchThumb` |
| `slider` | `$trackHeight`, `$thumbSize`, and the hit area's height |

**`Button` also takes `size="icon"`, `"icon-sm"` and `"icon-lg"`**: a square of the size's height
with no padding at all, for a button whose label is an icon. `round` is unchanged and composes with
it. A hyphen in the prop is what separates two segments, so `icon-sm` is two segments and reaches
`button_square` and `button_square_sm`. `sizeSegments` in `control.ts` is the one function that
does that, for every control, so a size is spelled once.

**The prop is `icon` and the segment is `square` (amended).** They differ because a
class list is matched segment by segment, so the bare `icon` in `['button', 'icon']` also reached
the top-level `icon` entry and compiled its `display: inline-block; width: 1em; height: 1em` onto
the button. Measured in Chromium on the catalogue before the fix: the 36px square computed
`display: block` and the svg inside it sat 12.25px from the top and 9.75px from the bottom instead
of centred; at `sm` it was 10.78 and 9.22 in a 32px box. `sizeSegments` maps the one public value
whose name is also an entry name, and the entries are `button_square`, `button_square_sm` and
`button_square_lg`.

The rule this closes is in design 193: a segment is never an entry name. `checkTheme` refuses one,
so the default theme cannot grow another. Two other entries were renamed to satisfy it,
`select_icon` to `select_chevron` and `filedrop_input` to `filedrop_picker`; neither was reachable
by segments today and both were the same latent bug.

**The tick scales with its box (amended).** `checkbox_sm` and `checkbox_lg` redefined
`$box` alone, so `$tickWidth`, `$tickHeight` and `$tickStroke` stayed at 4, 8 and 2px and one
11.31px mark was drawn in a 12px inner box, a 14px one and an 18px one. The three names are now
redefined per size the way `radio_sm` redefines `$dot`: 3, 6 and 2px small, 5, 10 and 3px large.
The mark is a rectangle turned 45 degrees, so what has to fit is
`(width + stroke + height + stroke) / root two`: 9.19, 11.31 and 14.85px in inner boxes of 12, 14
and 18.

**An icon inside a control tightens the padding on its side.** `button` carries two `:has()`
rules, `> svg:first-child` taking `padding-left` to `$space3` and `> svg:last-child` taking
`padding-right` there, one `$space` off the default. `pseudo()` in `sheet.ts` writes `has(` as
`:has(`, so the directive is `_cssProp_has(> svg:first-child)`. The gap beside the icon is the
`$space2` the entry already had, and the icon is `1em` from the `icon` entry.

`Icon` and `LoadingDots` keep their own `size`, which is a CSS length and not this axis.

## Three things this decides beyond the axis itself

**A modifier of `select` does not extend the modifier of `input`.** `select` extends `input`, and
`extends` is per entry. So `select_sm` says `extends: 'input_sm'`. That pulls `input_sm` into the
chain after `select`, and `input_sm`'s `padding` shorthand then outranks `select`'s
`padding-right`, which is the room the arrow sits in. `select_sm` and `select_lg` therefore say
`paddingRight: '$space8'` again. The alternative was to make `extends` follow into modifiers
automatically, which would mean an entry's chain depends on entries nobody named and is a change
to design 111's matching for one caller's convenience.

**`textarea` sits after the size segment in the class list `TextArea` writes**, so the list is
`['input', type, size, 'textarea', ...]` rather than `['input', 'textarea', type, ...]`.
`input_sm` sets a fixed height and `textarea` takes it back off; whichever matches later in the
list wins, and the shape rule has to be the last word. Nothing shipped changes, because
`input_invalid` is the only `input_<segment>` entry there is and it sets a border colour.

**The square button says its zero padding three times.** `button_icon` sets `padding: 0` and two
`:has()` rules setting `padding-left` and `padding-right` to zero. Each of those is a rule the
plain button would otherwise win: `button_sm` matches later in the class list than `button_icon`,
so its `padding` shorthand outranks it, and the two `:has()` rules on `button` outrank both by
specificity whatever the order, because `:has()` takes the specificity of its argument. Measured
in Chromium before the two zeroing rules were added, a `size="icon"` button computed `0px 12px`.

## Why

Three sizes plus a square icon button, not five with a 24px extra-small. Every real form has a
dense row somewhere, and a library with one height makes an application write its own, which is
where a second set of values starts.

As a segment rather than a prop the component branches on, because that is how `type` already
works and because it puts the sizes in the theme, where an application replaces them. A component
that computed a height would put the number back inside the component, which design 119 exists to
stop.

## Evidence

`packages/ui/tests/look.test.ts`, "the size axis is one segment, and each entry resolves its own
height", "an icon button is a square, and the size keeps it one", and "a text area is the shape
rule, and a size does not give it a fixed height": the compiled rules for each of the fourteen
class lists.

`packages/ui/tests/browser.test.ts`, "every control has three heights, and an icon button is a
square at each of them", measured in Chromium: button, text field, select and slider are 36, 32
and 40 px tall at the three sizes; the tick box is 16, 14 and 20 px square and the radio the same
through `extends`; the switch is 40 by 24, 32 by 20 and 48 by 28; the square button is 36, 32 and
40 px in both directions with computed `padding: 0px`, against `4px 16px` on a plain one.

`recipes/ui/main.ts` reads the same three heights and the two squares off the catalogue page (the
controls page is gone, design 197), and axe-core finds no WCAG 2.2 AA violation on
that page with the 14px box on it.

For the amendment: `packages/ui/tests/look.test.ts`, "the square button keeps its own box, because
no entry is named by its segment", asserts the compiled rules are `inline-flex` with no `1em`
anywhere and runs `checkTheme` over `defaults.ts` expecting nothing; and "the drawn tick follows
the size axis, so the mark fits every box" asserts each size's own three numbers and that the
turned mark fits inside the box. `packages/ui/tests/browser.test.ts`, "a square button centres its
icon, and the icon takes the button's own colour", measures the svg's four gaps inside the 36px
square in both modes, and "the drawn mark fits its box at every size" measures 9.19, 11.31 and
14.85px in Chromium. `packages/testing/tests/theme.test.ts`, "a segment of an entry may not be the
name of an entry that lays an element out", states the rule itself. Each of the five fails without
the rule it pins: with the entry named `button_icon` again, with the three tick names taken back
out of the size entries, and with the rule's own line disabled.

## What this costs

**A button holding one icon and a plain text label tightens both sides, not one.** Measured in
Chromium: `padding: 4px 12px` where the icon is on the left and the label is a text node. A
label is a text node, and `:first-child` and `:last-child` count element siblings only, so the
`<svg>` is both. The two rules are right whenever the DOM can tell the sides apart, which is a
button with an icon at each end or with element children, and they agree with each other when it
cannot. Four pixels, symmetric. The fix would be to wrap the label in a `<span>`, which changes
what every button renders for a padding rule.

Fourteen more entries in the default theme, and a `size` prop on eight components. That is the
size of the axis and it does not grow: a fourth size would be a fourth set of the same.

`$target` is now used by nothing in the default theme. It stays defined: it is the number an
application reaches for and the one `check-theme.ts` names as the fix for a bare `min-width`.

## What would reverse this

An application that needs a size the three do not cover. That is a `Theme` provider redefining
`button_sm` and its siblings, which is what the axis being entries is for, and it needs no change
here.
