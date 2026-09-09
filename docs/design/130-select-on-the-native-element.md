# 130: `Select` on the native element, and what that costs

Reversed by design 224, which is where `Select` is described now. The element is no longer the
control: it is a `<button role="combobox">` over a drawn list, with a hidden `<select>` for the form
and for autofill. What survives is the items-not-text mapping below, which design 224 keeps word for
word; the two costs named here are what reversed it. Amended by design 195: the element wore
`appearance: none` before `base-select` and the component draws its own arrow in a wrapper, so the
closed control is the same on every host. Amended: the map between the element and the caller is the
element's own selection, not a string in the option's `value`. The section below is the amended
text, and the cost it used to carry is gone.

## Decision

`Select` is a `<select>` with `<option>` children, and nothing else.

**Options may be objects, and the element only takes text.** `options` is a list, or a cell of a
list, of anything. The component never asks an item for a string that stands for it. The row built
for an item says whether it is the chosen one, as the `selected` attribute a static render writes
and as the property a live element answers to, and a change is read back as the position it
happened at, less the placeholder's row. So `value` holds the item the caller put in the list, and
a list that grows, shrinks or reorders under a live choice leaves the choice on its item.

The option's `value` attribute is for the form the select is in and for anyone reading the markup.
An item that is a string or a number carries itself there; anything else carries nothing, because
an object has no text of its own and a position written into the markup would go stale the moment
the list moved. Nothing in the component reads it back.

What this rules out: an id field would be a name the caller has to have, `JSON.stringify` of an
object is neither short nor stable across key order, and a position baked into the row at the
moment it was built is wrong as soon as anything is inserted in front of it. That last one was
this component's bug: `options.unshift(x)` left two rows carrying `value="0"` and the wrong object
came back.

**`display` says what the person reads.** It is a function from an item to its text, or a list of
strings the same length as `options`, read by position. With neither, the item is read with
`String(item)`.

**`placeholder` is a disabled option, selected while the cell holds nothing.** It carries the
`disabled` and `hidden` attributes, so it shows before a choice is made and cannot be chosen back.
A `value` cell holding `null` or `undefined` is what "nothing" means. It is the row itself that is
selected, so an item that is the empty string is its own row and not the placeholder. A cell
holding something the list does not have selects nothing at all.

**`options` rendered through `each`.** The list goes to `dom`'s list mount, so adding one option
inserts one `<option>` and moves nothing else.

**The `select` entry carries `appearance: base-select`.** In Chromium 135 and later that puts the
element in the base appearance, and the open list, the option rows and the arrow are drawn from the
theme like anything else. Every other host ignores the declaration, keeps its own appearance, and
draws its own list. The entry styles the picker parts by name, so a host that has them uses them
and a host that does not is unaffected.

Amended by design 195: the entry says the appearance twice, `none` and then
`base-select`, and the component renders the element inside a `<span>` with its own `chevron-down`
placed at the right. So the arrow is this package's on every host, the host's own is gone, and
`base-select` still buys the themed open list where it is understood. The two costs below are
unchanged.

## Why

Native first. A select is the control where that rule costs the most and buys the most. What it
buys: the whole keyboard map including type-ahead, the platform's own list on a phone, form
participation, and a real `<select>` in the markup a static render writes.

Object options mapped inside the component rather than at the call site, because the alternative
is that every caller writes the same three lines of `find` to get its own object back out of a
change event, and gets it wrong for a list holding two equal strings.

Position as the string rather than an id or a hash: a caller that has an id does not have to tell
us about it, and a caller that has none is not asked to invent one. What position costs is written
below.

## What this costs

Two losses, both real, both measured across five applications, and neither has a fix inside this
component.

1. **Outside Chromium the open list is the host's.** It is not themed, and it will not match the
   page. That is the platform's list, drawn well, in the wrong colours.
2. **The open state cannot be observed or driven.** There is no event for a select opening and no
   way to open one from script. A component that has to know is not this component; the
   catalogue's answer for that is a `DropDown` built from a `Button` and a popup.

A third cost, from the mapping: **the chosen row is written on every option.** A cell that changes
touches one attribute and one property per option rather than one on the select, because each row
holds its own answer to "am I the chosen one". A select is a control with tens of options, not
thousands, and the alternative was the position bug above.

## Evidence

`packages/ui/tests/select.test.ts` asserts an object list round trips: the cell holds the object the
caller put in, a change event on the element writes the object and not the string, two options whose
`display` is the same text stay two different items, an option inserted in front of the choice
leaves the choice where it was, an item that is the empty string is not the placeholder, and a cell
holding an item the list does not have selects nothing. `packages/ui/tests/browser.test.ts` drives a
real `change` in Chromium and reads the cell.

## What would reverse this

An application that needs the open state. That is a `DropDown`, not a change to this component.
