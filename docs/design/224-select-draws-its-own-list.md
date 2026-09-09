# 224: `Select` draws its own list on every host

Amended: the list no longer needs a `PopupContext` above it, and a cell holding an item the list
does not have reads as the placeholder. Reverses design 130, which put the whole component on the
native element, and amends design 128's control table: `Select` is the one control that is not a
native element with a theme on it. Design 195's chevron is unchanged.

## Decision

`Select` is a button, a drawn list, and a hidden `<select>` that the form and autofill still see.

### The closed control

A `<button type="button">` on the `select` entry, with the chevron of design 195 beside it in the
same `select_wrap` span. It carries `role="combobox"`, `aria-haspopup="listbox"`, `aria-expanded`
following the `open` cell, `aria-controls` naming the list, and `aria-activedescendant` naming the
option the keyboard is on while it is open. Its content is the chosen item's text, or the
`placeholder` while nothing is chosen.

The label wiring is unchanged: `wireField` (design 129) mints the ids and writes `id`,
`aria-describedby` and `aria-invalid`, and a `<label for>` points at the button, which is a
labelable element.

`appearance: ['none', 'base-select']` on the `select` entry is now `appearance: none`, and the
`::picker-icon` and `::picker(select)` rules are gone. Nothing on the page is the host's list any
more, so there is nothing left to ask a host to theme. The `option` entry goes with them: it dressed
the rows of the host's picker, and the rows are `listbox_item` now. The entries that arrive are
`listbox`, `listbox_item` and its three modifiers, plus design 225's five for the menu.

### The open list

A `<div role="listbox">` of `<div role="option">` rows, in a themed popup placed under the control
at the control's width through `Detached` and `placement.ts`, with `locations` of `below-start`
and then `above-start` so it flips above when there is no room below. The box asks for the top
layer with the `popover` attribute, which is what `Popup` already does (design 113): a host with
no Popover API gets DOM order instead, and because the popup sink renders after the page, DOM
order puts the list over the page. There is no z-index in this, as there is none anywhere in the
package.

The chosen row carries `aria-selected="true"`, the row the keyboard is on wears an `active`
segment, and the keys are the listbox behaviour of design 223. Opening happens on a click, on
ArrowDown, ArrowUp, Enter and Space, and on a printable character, which opens and runs the
type-ahead in one press.

**The width is measured, not guessed.** The list's own `width` is set from the control's measured
box when the list opens, and again from `Detached`'s `onResize` while it is open. A `max-width` on
the popup box would let a long option make the list wider than the control, which reads as a
different control opening.

**The list keeps design 130's items-not-text rule.** `options` is a list of anything, `display`
says what a person reads, and the cell holds the item the caller put in the list. The rows are
mapped from the list rather than mounted through `each`, because each row carries an id that
`aria-activedescendant` names, and a row built by cloning the first one would carry the first
row's id. The hidden `<select>` below still mounts its `<option>`s through `each`, so design 130's
"adding one option adds one option and moves nothing else" is unchanged where the markup is.

### The hidden native `<select>`

A real `<select>` on the `offscreen` entry, `aria-hidden="true"` and `tabindex="-1"`, mirroring
the options and the choice, and taking the component's `name` and `autocomplete`. It keeps a
`change` handler, so anything that writes it writes the cell.

**What that buys.** A form the component sits in posts the value, because a `<select name>` in the
form is what the form serializes, and there is no hidden input to keep in step. A form reset puts
the element back to its starting option and the `change` handler follows. And autofill has a real
`<select>` to find, with a real `autocomplete` token on it: where a browser fills a form, it picks
an option and fires `change`, and the cell, the button's text and the drawn list all follow.

**What it does not buy.** Autofill's own UI is drawn on the element it filled, and that element is
one pixel square and clipped, so the person sees no highlight over the button they are looking at.
A browser whose autofill heuristics skip a field it cannot show a highlight on will skip this one,
and there is nothing this component can do about that from inside a page. It is `offscreen` rather
than `hidden` or `display: none` precisely because a display:none control is invisible to autofill
altogether, and this at least gives it something to find.

It is `aria-hidden` with `tabindex="-1"` together: the button beside it is what a screen reader
reads, two comboboxes for one control is the failure this avoids, and an `aria-hidden` element
that can still take the focus is an accessibility defect in its own right, which the `tabindex`
closes.

### The props

`value`, `options`, `display`, `placeholder`, `label`, `description`, `error`, `disabled`,
`onChange`, `size`, `type`, `element` and `theme` are unchanged in meaning. `element` now hands in
the `<button>`, because the button is the control. `open` is added: a cell or absent, like every
state prop in this package, so a plain value is a loud assert rather than a silent fallback.
`name` and `autocomplete` are read by name and go to the hidden element; everything else still goes
to the button.

**`placeholder` shows while nothing is chosen and while the cell holds an item the list does not
have.** Amended: an earlier shape had the second half written down and not built, so the button
read the held value back while no row was selected and the hidden element sat on its blank option.
Three parts of one control said two different things and no click could put it right. The button's text follows the options as well as the cell now, so an item a list gains later
reads as itself from the moment its row exists.

### The list is a popup, and a popup goes where design 113 says

Amended. This section used to say a `Select` needs a
`PopupContext` above it, because `Popup` asserted when there was none. It does not any more: a
popup's sink is the nearest `<dialog>` above it, then a `PopupContext`, then the element the page
was mounted into (design 113, amended). So a `Select` still mounts anywhere at all, a `Select`
inside a `Modal` draws its list inside that dialog where it can be clicked, and a `PopupContext` is
what a page writes to choose a sink on purpose rather than what it writes to be allowed to render.

## Why

A select is worth more than what the host's own picker will let a page dress.

What design 130 chose bought the platform's keyboard map, its form participation and its list on a
phone, and cost the open list on every host but one. Measured: in Chromium the picker paints the
theme's colours from its first frame but is placed over the control rather than under it; in
Firefox there is no `base-select` at all, so the open list is the host's, unthemed, beside a page
of components this package drew.

So the one thing `base-select` was bought for does not happen on every host, and the thing it did
buy on Chromium is placed wrong. The list is now this package's on every host,
which is the point: one control, one look, one keyboard map, everywhere.

The keyboard map is not given up with the element. It is design 223, written once and tested once,
and it is the same map on the menu.

## Evidence

`packages/ui/tests/select.test.ts`, in the light tree: the open list is a `role="listbox"` of
`role="option"` rows; the button says `role="combobox"` and its `aria-expanded` follows the cell; a
key on the button moves the active option and `aria-activedescendant` names it; Enter writes the
cell with the item and not the text; the hidden `<select>` carries the same options, the same
choice and the component's `name`; a change on the hidden element writes the cell, which is the
autofill path; and design 130's own assertions about objects, `display`, the placeholder, a list
that reorders and an item that is the empty string all still pass, because none of that changed.

Each of the four new ones was seen red first against the component as design 130 left it: no
`role="listbox"` on the page at all, no `aria-expanded`, no active option under a key, and no
hidden element to read.

`packages/ui/tests/browser.test.ts`, measured in Chromium: the open list's box sits below the
control's box and matches its width, in light and dark; ArrowDown then Enter picks the second item;
typing a letter moves the active option to the first item starting with it; Escape closes the list
and leaves the focus on the button; and the control still computes `appearance: none` with the 8px
chevron inside it, which is design 195 unchanged.

`recipes/ui/main.ts` reads the same list off the catalogue's own select section, and axe-core finds
no WCAG 2.2 AA violation on that page with a select open.

For the two amendments: `select.test.ts` asserts the button reads the placeholder with the cell
holding `zzz` and a list of `a` and `b`, and reads the item once the list gains it, both seen red
against the shape before the amendment. `popup.test.ts` mounts a `Select` and a `Menu` with no
`PopupContext` above either and finds the list each of them drew.

## What this costs

**The platform's list on a phone is gone.** A native `<select>` on a phone opens the operating
system's own wheel or sheet, which is a better control than any page can draw, and the hidden
element does not get to open it. That is the loss the drawn list accepts, and it is the strongest
piece of evidence that would reverse this.

**`Select` is now the one control that is not one native element.** Design 128's table has an
exception in it, and every other row still holds.

**More markup, and more of it live.** A select was one element and its options; it is now a button,
a chevron, a hidden element with its options, and a list of drawn rows with an id each.

## What would reverse this

Measurements from a phone showing that the drawn list is materially worse to use than the platform
sheet, or a host family adopting a themeable native picker that Firefox also ships. Either would
be a change to this component and to nothing else: nothing here is stored or sent.
