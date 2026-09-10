# 250: A component owns its dialog, and a searched list is one behaviour

## Decision

`Country` and `Region` are a button that opens a modal `<dialog>` of their own, holding a search
box over a list of options. Three things follow from that, and they are the design here.

### A component may own a `<dialog>`

`Modal` is a stage template: a page shows one with `stage.open({ template: Modal })`, and the act
inside it is the page's. That is right for a dialog the page navigates to, and it is wrong for a
control: a country field in a form has nothing to do with routing, and a form in a page with no
`Stage` above it would have no way to open one.

So `chooser.tsx` builds a `<dialog>` and drives it with `dialogControl`, the same internal control
`Modal` uses (design 129). Everything that control already does is unchanged: the rest of the page
goes `inert`, Escape arrives as the element's own `cancel` event, and the keyboard goes back to the
button that opened it. What the component adds over `Modal` is the backdrop mousedown and the close
button, both of which are eight lines, and what it does not add is a second dialog implementation.

**The dialog is mounted with the control, not when it opens.** It sits in the markup closed, which
is what makes the search box and the list part of the component's own tree: a popup at the sink
would need the sink, and a dialog is already in the top layer without one.

**The rows inside it are not.** The grid is drawn the first time the dialog opens and stays drawn
after that. A closed dialog is not something a person can read, so 249 rows in the markup of every
page holding one of these buy nothing, and on a static render they are 249 more strings for the two
ends to disagree about (design 251). What the first open costs is bounded by a check rather than
described: `packages/ui/tests/browser.test.ts` opens the longest list there is, 217 rows, filters it
in Chromium, and fails if either takes longer than a fifth of a second.

### A list a person types into is the listbox behaviour with two switches

`listBox` (design 223) is the keyboard, the pointer and the dismissal of a list of options, and a
searched list wants all of it except two things. So it grows two options, both defaulting to what
it does today:

- **`typeahead`**, off here. A printable character belongs to the search box, and the type-ahead
  swallows the key it lands on: `preventDefault` is how it stops the page scrolling under Home and
  End, and an input whose keydown was defaulted away never sees the character. One key cannot both
  filter the list and jump within it.
- **`inside`**, the extra nodes a mousedown inside does not dismiss. The dismissal reads the
  trigger and the list; inside a dialog the person can also press on the heading, the search box's
  own padding, or the dialog's edge, and every one of those is outside both. Handing it the dialog
  makes the whole dialog inside, and the backdrop press is the dialog's own handler, as it is for
  `Modal`.

`Select` and `Menu` pass neither and are unchanged.

### The names on the page

The entries are `chooser` and its parts: `chooser_wrap`, `chooser_chosen`, `chooser_panel`,
`chooser_head`, `chooser_search`, `chooser_grid`, `chooser_option` with `selected`, `active` and
`suggested`, `chooser_flag`, `chooser_lines`, `chooser_note` and `chooser_none`. Four named values
come with them: `$chooserWidth` (44rem, wide enough for three columns), `$chooserHeight` (80vh, so
the dialog never outgrows the screen), `$chooserColumn` (13rem, the narrowest a column of rows may
be before the grid drops one) and `$flagWidth` (1.5em, the column the flags sit in, so the names down
the grid start at the same place on a host that draws no flag).

The word is `chooser` and not `picker` because `picker` is taken twice over: `filedrop_picker` is the
button that opens a file dialog, and `ColorPicker` is a component. A part named for an entry is
refused by the theme check, and for the reason the check exists: a class list holding both reaches
both.

### The search box is the combobox, and the button is not

While it is closed there is one control: a `<button aria-haspopup="dialog">`. While it is open the
search box is the `<input role="combobox">` that `aria-controls` the list and names the active row
in `aria-activedescendant`, which is the pattern the listbox behaviour's `option` mode already
serves (the focus stays on the element it was installed on). The rows are
`<div role="option">` in a `<div role="listbox">`, so they are the same rows, with the same theme
entries, as the list a `Select` draws.

## Why

The point of the control is that a person can find a country by typing three letters of it and can
see fifteen of them at once, which a dropdown under a field cannot do at a phone's width. That
needs the screen, and on the platform the thing that takes the screen and the top layer is
`<dialog>`.

The alternative was a popup, as `Select` uses. A popup is placed against its control and sized to
it, and the two properties this control needs are exactly the ones a popup gives up: the whole
width on a small screen, and a scrim over the page behind it so a list of 249 rows is not read as
part of the form.

## What this costs

A second component in the package now opens a modal, so the dialog behaviour has two callers rather
than one. That is what made it worth having as `dialog.ts` rather than inside `Modal`, but it does
mean a change to it is felt in two places.

The dialog is in the component's own markup, so a static render emits it closed and a hydration
adopts it. `Modal` cannot be rendered on a server at all (design 153); this one can, because
nothing about it is mounted anywhere but where it was written.

The hidden `<select>` under the control carries one `<option>` per country, so a country field puts
249 elements in the page that nobody sees. That is what a form posting the value and autofill
finding the field cost `Select` too (design 224), and it is the same trade: a control nothing
renders is a control autofill cannot find.
