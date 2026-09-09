# 202: The sheet, the accordion and the toggle group

Amended by design 212: `Accordion` and `ToggleGroup` go; the sheet stays.

## Decision

Three things built out of components that already exist: a `Modal` type, a prop on `DropDown` and
the component that groups them, and a group of native inputs drawn as buttons.

### `Sheet` is a `Modal` type, not a component

`Modal` gains one prop, `side` (`right` by default, or `left`, `top`, `bottom`), read only when
`type` is `sheet`. There is no `Sheet` export: it is the same stage template, the same
`dialogControl`, the same close behaviour and the same backdrop, with the dialog anchored to an edge
instead of centred (design 134).

The entries are `dialog_sheet` and `dialog_sheet_left`, `_right`, `_top` and `_bottom`. `Modal`
writes `['dialog', type, side, theme]`, so `type="sheet" side="left"` is the class list
`dialog sheet left` and reaches all three of `dialog`, `dialog_sheet` and `dialog_sheet_left`. The
theme list took the second segment cleanly, so nothing had to be spelled another way.

**A sheet is anchored with margins, not with a transform.** A modal `<dialog>` is centred by the
host with `margin: auto`, so `margin: 0` with one side left as `auto` puts it against the opposite
edge, and the transform stays free for the motion. Left and right are `$sheetWidth` wide (24rem, a
new size in `sizes.ts`) and full height; top and bottom are full width and as tall as their content.
`$radiusLg` stays on the inner edge only, and the one border is the inner edge too.

The entry says `box-sizing: border-box`, which a plain dialog does not need. Without it the host's
content box made the sheet 417px wide, `$sheetWidth` plus the dialog's own padding and border, and
the slide is `translateX(100%)`, so it moved by that rather than by 24rem. Measured in Chromium
before the line was added.

**It slides in rather than growing.** Each side entry says a translate off its own edge in its own
`_starting_`, and says the same translate again under `:not([open])` so it slides back out. The base
dialog's `scale(0.96)` is still emitted; what makes the translate the one that lands is that the
side entry is later in the chain, so its rule is written after it in the same layer and the same
selector. The `opacity: 0` the base starts from is kept, so a sheet fades as well as slides. The transition itself is the one
`dialog` already declares inside `prefers-reduced-motion: no-preference`, and it already names
`transform`, which is why the motion is written as a `transform: translateX(100%)` rather than as
the standalone `translate` property: a second property would have to be added to that transition
list for the benefit of one type. The starting style stays outside the query for the reason design
190 gives: a starting style is only ever read by a transition, so with no transition there is
nothing to start from and a sheet under reduced motion is in place in its first frame.

### `Accordion`, on the platform's own exclusive disclosure

`DropDown` gains `name`, written to the `<details>` `name` attribute. A group of `<details>` sharing
one name is an exclusive accordion in the platform: opening one closes the others, and the one that
closes fires its own `toggle`, so the `open` cell of every drop-down follows with nothing written
here.

`Accordion` is a `<div>` on `accordion` whose children are `DropDown`s. Props: `name`, `items`
(optional, a list of `{ label, content }` rendered as `DropDown`s for the common case), `element`,
`theme`, and children for everything else. Each `DropDown` it renders wears `accordion_item` through
its `theme` prop, which is what draws the `$border` line between one item and the next.

**The name is minted off the render's id counter when it was not given one**, which is what
`wireField` does for a control's ids and `Radio` does for a group's name (designs 109 and 129). So a
server render and the hydration that adopts it mint the same name and the group is still one group
after the page comes alive.

**Children keep the caller's own `DropDown`s.** An `Accordion` given children does not wrap them or
rewrite them; the caller passes `name={the same name}` and `theme="accordion_item"` themselves, or
uses `items` and the component does it. The alternative, walking the children and editing their
props, means a component reading another component's props, which nothing in this package does.

### `ToggleGroup`, native inputs drawn as buttons

A `<div role="group">` on `togglegroup` holding one `<label>` per option on `togglegroup_item`, each
wrapping a visually hidden `<input>` on `offscreen` and the option's text. Single choice is
`type="radio"`; `multiple` makes them `type="checkbox"` and the value cell a list. Props: `value`,
`options`, `display` (a function or a list of strings, read by position, exactly as `Select` reads
it), `multiple`, `size`, `type` (nothing or `quiet`), `disabled`, `label`, `element` and `theme`.

**The look is the button's, through `extends`.** `togglegroup_item` says
`extends: ['button', 'button_quiet']`, so the height, the padding, the radius and the border are the
button's own and a change to the size axis moves them both. `togglegroup_item_sm` and `_lg` extend
`button_sm` and `button_lg` for the same reason `select_sm` extends `input_sm` (design 194). The
checked look comes through `_cssProp_has(:checked)` on the label, and the focus ring through
`_cssProp_has(:focus-visible)`, which is where `InputGroup` already puts a ring that belongs to a
box rather than to the element inside it (design 200). The halo the root entry gives every themed
element is taken back off the input by a `_children_input:focus-visible` rule, which is where
`inputgroup_control` puts the same rule; it is written as a rule about children because the input
wears `offscreen`, an entry every other hidden control shares. The corners are joined by
`_children_` rules on `togglegroup`, as `buttongroup` joins its buttons.

**A group can take a `size` where a `ButtonGroup` cannot**, because this one renders its own items
and can therefore put the segment in their class lists. Design 200's finding stands: a group cannot
reach children it did not render.

**The options are mapped rather than run through `each`.** Each option carries a `change` handler
that has to know which option it is, and what a list clones per row is values: text, attribute and
property values, not the functions a row was built with (`packages/dom/README.md`). Measured: under
`each`, ticking the first box of a three-option group wrote the last option's item into the cell. `Select` avoids the same trap the other way, by putting one handler on the
`<select>` and reading the position back off the event; a toggle group has no one element to put it
on, so it maps. A group of choices is short, and there is nothing to save.

**The keyboard is the platform's.** Arrows move between radios sharing a name, and Space toggles a
checkbox. Nothing here writes a key handler, a `tabindex` or a roving focus.

**The group name is minted by the same helper `Radio` uses.** It moved from `radio.tsx` to
`control.ts`, unchanged: one name per render per value cell, held in a `WeakMap` keyed on objects
the caller already holds. Both components import it, so two radios and a toggle group pointed at one
cell are one group. Duplicating it would have been a second counter minting a second name for the
same cell.

## Why

All three of these need no new behaviour, because they are cases where the platform already has it
and only the drawing was missing: an exclusive accordion is one attribute, a segmented control is
a fieldset of radios, and a sheet is a dialog against an edge. Building any of them as new
machinery would have added a keyboard map, a name registry or a focus trap that the host already
ships.

A sheet as a `Modal` type rather than a component is what keeps one way to open an act. Two
components would mean two paths through the stage and two things to keep in step when `close()`
changes.

## Evidence

`packages/ui/tests/navigation.test.ts`: `Modal` with `type="sheet"` writes the sheet and side
segments and a `Modal` without one writes neither; `Accordion` mints one `name` and writes it on
every `DropDown`, and a given `name` is used as it is; `ToggleGroup`'s single value round trip
through a real `change`, its multiple value adding and removing from the list, `display` as a
function and as a list, and the `<input>` type it picks.

`packages/ui/tests/look.test.ts`: the four side entries each carry their own margin, radius and
starting translate; `accordion_item` draws a line on every item but the first; `togglegroup_item`
resolves the button's height through `extends` and takes the accent fill under `:has(:checked)`;
`checkTheme` over `defaults.ts` reports nothing.

`packages/ui/tests/browser.test.ts`, measured in Chromium: a sheet's first frame is translated off
its edge and its resting position is against the right edge of the viewport at 24rem wide; opening
the second drop-down of an accordion closes the first, with no script of ours; and the arrow keys
move the checked radio of a toggle group while the ring lands on the label rather than on the input
inside it.

`recipes/ui/main.ts` opens a sheet through the stage the way the modal example does, reads the
accordion's one-open rule, and reads the toggle group's value off the catalogue.

## What this costs

`Modal` has a prop that does nothing for three of its four types. The alternative was a second
component with the same body, which is worse: `side` is one line in the props table and it is
where a reader looks for it.

An `Accordion` given children rather than `items` has to repeat the name on each child. That is
one prop per item, and it is what keeps this component from reading another component's props.

`ToggleGroup`'s label wraps an input that is off the screen, so a caller who wants a real
`<fieldset>` around the group has to write one. `role="group"` and `label` are what this ships.

## Amended

**A `multiple` group's cell is rebuilt from `options` on every change, and a held value the options
do not have is dropped.** That was already what the code did and it was written down nowhere, so it
read as a value silently disappearing. It is the rule, not an accident: the list has to come out in
the order the options were declared, and the only way to say that order is to walk the options. So a
cell seeded with a value that is not an option shows nothing ticked for it and loses it the first
time anybody ticks anything. The README says so now. What would change it is an application that
needs a group to carry choices it cannot draw, which is a different component.

**An `Accordion` cannot render without an icon pack.** It is a stack of `DropDown`s and a `DropDown`
mounts `chevron-down` by name, so the README's list of the components that ask for an icon by name
(`DropDown`, `FileDrop`, `Modal`, `Validate`) was missing it, and a page with an accordion and no
`Icons` provider asserted on a name the caller never wrote. The behaviour is right and design 144
stands: this package ships no drawings. The list now names `Accordion` too.

## What would reverse this

A host that stops treating a named `<details>` group as exclusive. Then `Accordion` needs a cell
and a handler of its own, which is a behaviour and a design note of its own.
