# 200: The three grouping pieces

Amended by design 210 (`InputGroup` becomes `TextField`'s `leading` and `trailing`), design 211
(`Card` absorbs `Paper`) and design 212 (`ButtonGroup` goes).

## Decision

Three components whose job is what they put around other components: `Card`, `ButtonGroup` and
`InputGroup`.

### `Card`, and `Paper` unchanged

`Paper` keeps its job: the bare raised block, one `<div>` on the `card` entry, nothing inside it.

`Card` is the composition. It is also a `<div>` on `card`, plus the segment `stack`, and it takes
`title`, `description`, `foot`, `tight`, `type` and children, which go into the body. Five parts:
`card_head`, `card_title`, `card_description`, `card_body` and `card_foot`. The title is the
`text` family's `lg` step at weight 600, the description is `$mutedForeground`, the head, the body
and the foot are `$space4` apart, and the foot is a row.

**The column is a modifier, not a change to `card`.** `card_stack` is what carries
`display: flex`, the column and the `$space4` gap, so `Paper` renders exactly what it rendered
before this note. Putting the column on `card` itself would have relaid out every `Paper` on
every page for the benefit of the component that came after it.

### `ButtonGroup`

A `<div role="group">` on `buttongroup`, with `label` for its `aria-label` and `Button`s as its
children. `vertical` stacks them.

The corners and the shared borders are the entry's own work, through `_children_` rules on it:
every child loses its radius, the first and last child get theirs back on the outer corners only,
and every child after the first is pulled back by `-$borderWidth` so two adjacent borders are one
line. A child that has focus is lifted with `position: relative` and `z-index: 1`, because the
focus ring is a box shadow and the neighbour that overlaps it would otherwise cut it in half.

`buttongroup_vertical` says the same three things down the page instead of across it.

**No `size` on the group.** The question was whether a size given to the group could reach its
buttons through the theme alone. It cannot: a class list is written by the element that wears it,
and a group has no way to add a segment to its children's lists. The nearest thing the theme could
do is restate what `button_sm` says on `.awN > *`, which is the size axis written a second time,
in a second place, wrong the first time design 194's numbers move. So each button in a group
carries its own `size`, which is one word per button and is what a caller writing them out is
already doing.

### `InputGroup`

A `TextField` with addons. It takes `leading` and `trailing`, each anything mountable, plus every
`TextField` prop and nothing new: `value`, `label`, `description`, `error`, `placeholder`,
`password`, `size`, `disabled`, `onEnter`, `onKeyDown`, `type`, `element`.

**One box, three elements.** A `<div>` on `inputgroup` wraps the addons and the input as one
bordered control: `inputgroup` `extends: 'input'`, so the border, the radius, the fill, the
hairline and the `$control` height are the ones every text field has, and `inputgroup_sm` and
`inputgroup_lg` extend `input_sm` and `input_lg` for the same reason `select_sm` extends `input_sm`
(design 194). Each of the two restates its horizontal padding, because the `input_<size>` that
`extends` pulls into the chain sits after `inputgroup` and its `padding` shorthand would otherwise
take the box's own back.

The inner `<input>` wears `inputgroup_control`: no border, no radius, no padding, a transparent
fill, `flex: 1 1 auto` and `minWidth: 0`, so a long value shrinks rather than pushing the trailing
addon out of the box. A `leading` or `trailing` that is text is wrapped in a `<span>` on
`inputgroup_addon`; anything else is mounted as it is, which is what makes an `Icon` or a
`Button` of `size="icon"` work with nothing added here.

**The ring moves to the box.** `inputgroup_control` turns off the halo and the border colour the
root entry's `:focus-visible` rule gives every themed element (design 192), and `inputgroup` shows
them itself through `_cssProp_has(:focus-visible)`. So tabbing into the input rings the whole
control, which is what a person sees as one control.

**The wiring is `wireField`, called here.** `InputGroup` calls the same internal `wireField` that
`TextField` calls, so the label, the description, the error, the three ids, `aria-describedby` and
`aria-invalid` are one implementation and cannot disagree (designs 129 and 138), and a `Field` above
it is marked the same way (design 196).

The other two shapes do not work. Handing `TextField` an `<input>` node through
`element` and wrapping that node in a box fails because `TextField` mounts the node it was handed
where it was mounted: the box a caller built around it is not where the input ends up. Giving
`TextField` an internal option that says what to wrap the input in leaves the option out of
`TextFieldProps` and out of `surface.txt`, which is a second way to build a field that a reader of
the surface cannot see. Calling the shared wiring is neither: `text-field.tsx` is untouched,
its surface is unchanged, and the eleven lines `InputGroup` writes for its own element are the ones
that differ, because that element sits in a box.

## Why

These three are the components that need no new behaviour: their whole content is layout, so each
is an entry family and a small component, and each one removes a shape an application would
otherwise write with its own numbers in it: a card's heading row, a segmented control's shared
borders, a field with a currency sign in front of it.

## Evidence

`packages/ui/tests/display.test.ts`: `Card`'s five parts and the elements they land on, `Paper`
still rendering one `<div>` with no column, `ButtonGroup`'s role and label, and `InputGroup`'s
input carrying the field wiring, which is the `<label for>`, the `aria-describedby` naming the
description and then the error, and `aria-invalid` arriving with the error and going with it.

`packages/ui/tests/look.test.ts`: `card_stack` carries the column and `card` does not, the
`_children_` rules of `buttongroup` compile to `.awN > *` selectors with `-1px` between adjacent
children, `inputgroup` resolves the three heights through `extends`, and `inputgroup_control`
carries no border and no fill.

`packages/ui/tests/browser.test.ts`, measured in Chromium: a real Tab into an `InputGroup` puts
the ring on the box and not on the input, and two adjacent buttons in a `ButtonGroup` share one
border rather than two.

`recipes/ui/main.ts` reads the card's parts, the group's overlapping borders and the input
group's ring off the catalogue.

## What this costs

`Card` and `Paper` are two components on one entry. That is the point of both, and the README says
which is which in one line, but it is a question a reader will ask once.

`InputGroup` repeats the eleven lines that build a text input. The wiring is shared and the props
are the same, so what a change to either has to keep in step is the element's own props, which is
what a test asserts.

## Amended

**`tight` is read through `through` on both `Card` and `Paper`.** Both wrote `tight ? 'tight' : null`
against the prop itself. Every other look prop in this package takes a value or a cell, and a cell
is an object, so `tight={cell}` was tight whatever the cell held, false included. `Table` already
read its own `tight` through `through`; these two now do the same, and the block comments say the
prop takes a cell. `packages/ui/tests/display.test.ts` mounts both with a cell of false and then
sets it true.

## What would reverse this

A `ButtonGroup` whose buttons genuinely have to be sized together, which would mean the theme
gaining a way for an entry to add a segment to its children. That is a change to the matching
rule of design 193 and would need a design note of its own.
