# 201: The table and the two navigation pieces

## Decision

Three components that show a page's own structure: `Table`, `Breadcrumb` and `Pagination`. Each is
native elements the theme dresses (design 128), each part is one class token and each modifier is
a segment (design 193), and each entry that paints text on its own fill says so (design 198).

### `Table`

A `<table>` on `table`, inside a `<div>` on `table_scroll`. Fifteen entries and one component.

| element | entry |
|---|---|
| the scroll box | `table_scroll` |
| `<table>` | `table`, with `striped` |
| `<caption>` | `table_caption` |
| `<thead>` | `table_head` |
| `<tr>` | `table_line` |
| `<th scope="col">` | `table_heading`, with `right`, `center` and `tight` |
| `<td>` | `table_cell`, with `right`, `center` and `tight` |
| `<tfoot>` | `table_foot` |

`Table` takes `columns` (a list of `{ key, label, align, width }` or of strings, read once),
`rows` (a list or a cell of one), `cell` (`(row, column) => anything mountable`, defaulting to
`String(row[column.key])`), `caption`, `foot`, `striped`, `tight`, `label`, `type`, `element` and
`theme`. The look is `borderCollapse: collapse` at full width, `$textSm`, headings in
`$mutedForeground` at weight 500, and `$space2 $space3` of padding in every cell.

**The rows go through `each`, so a row pushed onto a cell list inserts one `<tr>`.** Every row
renders the same shape, which is what lets the list clone (`packages/dom/README.md`): the tags, the
prop keys and the child count are the same for every row, and only the values differ. A `cell`
function that returns a different shape for different rows is the caller stepping outside that rule,
and the cost is the list's, not this component's.

**The row's part is `table_line`, not `table_row`.** `row` is a top-level entry of this theme that
lays an element out, and design 193's rule refuses a key whose later segment names one: a class list
that reached `table_row` by segments would reach `row` too and compile `display: flex` onto a
`<tr>`. `alert_symbol` and `select_chevron` are the same rename. The word is the
only thing that moves; a row of a table is still what it is.

**The head draws the line under itself and each body row draws the line under itself.**
`table_head` carries `border-bottom` and `table_line` carries `border-bottom`, so a hand-written
table gets the same rules from the same names whichever of the two it themes. `Table` writes
`table_line` on the body and foot rows and not on the head row, because `table_head` has already
drawn that edge.

**A column's alignment is a modifier of each of the two elements it lines up.** `table_cell_right`
and `table_heading_right` say the same thing, because a class list holding `table_heading` reaches
no key that starts `table_cell`: a part token is all or nothing (design 193). Two lines rather than
one entry both elements reach, which the matching rule has no way to give.

**`tight` is a segment on the cells, not on the table.** A class list is written by the element that
wears it, so a `tight` on the `<table>` cannot reach a `<td>` (design 200 settled the same question
for `ButtonGroup`'s `size`). `Table` therefore puts the segment on each `<th>` and `<td>` it writes,
which is what `table_heading_tight` and `table_cell_tight` are for. `striped` is the other way
round: it is a rule about which rows, so it is a `_children_` rule on `table_striped` reaching
`tbody > tr:nth-child(even)`, the way `buttongroup` joins its children.

**The scroll box is focusable.** A box that scrolls and cannot be focused is unreachable from a
keyboard, so the wrapper carries `tabindex="0"`. It is one tab stop per table and it is what makes a
wide table readable without a mouse.

**The entries are usable on their own.** An application that writes its own `<table theme="table">`
with `<tr theme="table_line">` inside it gets the whole look and never touches the component. That
is the point of keeping the parts as plain entries: `Table` is the common case, not the only way in.

### `Breadcrumb`

A `<nav aria-label>` on `breadcrumb` holding an `<ol>` on `breadcrumb_list`. Each item is an `<li>`
on `breadcrumb_item` holding, after the first, a `<span aria-hidden="true">` on
`breadcrumb_separator`, then either an `<a href>` on `breadcrumb_link` or, for the last item, a
`<span aria-current="page">` on `breadcrumb_current`. Props: `items` (`{ label, href }`, a list or a
cell of one), `label` (the nav's name, "Breadcrumb" by default), `element` and `theme`.

**The separator is drawn in CSS.** It is a `$chevron` box with two of its four sides drawn, turned a
quarter turn the other way from the select's arrow so the corner that is left points along the row.
This package ships no drawings (design 144), and a breadcrumb that needed an icon pack to render a
slash would be the failure design 195 already fixed once for `Select`.

**A breadcrumb does not go through `each`.** The last item is a different element from the ones
before it, and a component under `each` renders the same node shape on every call, so `each` cannot
render a breadcrumb at all. The list is read through its cell and mapped, so a new list re-renders
the row; a breadcrumb is a handful of items and there is nothing to save.

**A link is a plain `<a href>` with no `target`, which is what makes it route.** `createRouter`'s
`links(root)` takes over same-origin anchor clicks under an element and leaves alone any anchor
carrying `download`, an opt-out attribute, or a `target` that is not `_self`. So a breadcrumb inside
a routed page navigates with no reload and this component writes no click handler. `Button` with an
`href` cannot be used here for exactly that reason: it adds `target="_blank"` unless
`hrefNewTab={false}`, and an anchor with a target is one the router hands back to the browser.

### `Pagination`

A `<nav aria-label>` on `pagination` holding `Button`s of `type="quiet"`, with a
`<span aria-hidden="true">` on `pagination_gap` where pages were left out. The button for the page
showing now carries `aria-current="page"` and the segment `current`. Props: `page` (a cell, 1
based), `count` (a number or a cell), `onChange`, `siblings` (default 1), `size`, `label`, `element`
and `theme`.

**The window is first, last, and `siblings` each side of the current page**, with a gap wherever a
run was left out:

```
count 10, siblings 1, page 1   ->  1 2 … 10
                      page 5   ->  1 … 4 5 6 … 10
                      page 10  ->  1 … 9 10
```

Previous is disabled on page 1 and next on the last page, and a count of 1 is one button. The
keyboard is the buttons' own.

**The current page is `button_current`, a modifier of the button.** It is the same element as every
other page button, so design 193 makes it a modifier and not a part, and it goes in through
`Button`'s `theme` prop rather than through a new prop on `Button`. `current` is not the name of any
entry, which is what design 193's amended rule requires of a segment.

**Pagination does not go through `each` either**, for the same reason as the breadcrumb: a gap is a
different element from a page button.

## Why

These three are components that need no new behaviour, and each of them shows where a person is in
a set of things: which row, which page, which level. Each is elements and an entry family, and
each removes a shape an application would otherwise write with its own numbers in it: a table's
hairlines, a chevron between two links, an ellipsis rule.

`Table` is the one of the three that is worth a component rather than only entries, because the rows
are data and the cells are a function of it. The entries stay usable alone so that the component is
a convenience rather than a gate.

## Evidence

`packages/ui/tests/navigation.test.ts`, in the light tree: `Table` renders one `<th>` per column and
one `<tr>` per row, a row pushed onto a cell list inserts one `<tr>` and moves nothing else, `cell`
overrides the text, `striped` and `tight` land as segments, and the caption and the foot render only
where they were given something; `Breadcrumb`'s last item is `aria-current="page"` and the rest are
links, the separator count is one less than the item count, and `label` names the nav;
`Pagination`'s window at the first, a middle and the last page, previous and next disabled at the
ends, `onChange` called with the number, and the `page` cell round trip.

`packages/ui/tests/look.test.ts`: every new entry resolves its sizes and roles from names alone, the
striped rule compiles to `.awN > tbody > tr:nth-child(even)`, the separator is a `$chevron` box with
two borders and a turn, and `checkTheme` over `defaults.ts` still reports nothing, which is what
says no segment here names an entry.

`packages/ui/tests/browser.test.ts`, measured in Chromium: a table wider than its box scrolls inside
the wrapper and the page does not, and a breadcrumb link inside a page with `router.links` attached
moves the router's URL cell with no navigation at all.

`recipes/ui/main.ts` reads the row count and the scroll off the catalogue, the breadcrumb's current
item, and the pagination window at three pages.

## What this costs

Twenty-four more entries in the default theme and three more components, fifteen of the entries
for the table alone. `Table` is the largest component in this package that is not a control,
because it is the only one that renders a shape per row.

A reader who expected `table_row` finds `table_line`. That is design 193's rule showing through
the naming for the third time, and the rule is worth more than the word.

## Amended

**A `rows` cell holding anything but a list reads as no rows.** The cell went straight to `each`,
which asserts on anything it cannot iterate, so a table whose rows arrive from a fetch took the page
down on its first render: a cell holds `null` before the first answer and holds `null` again when
the answer fails. The list is now read through `through`, the way `Breadcrumb` and `ToggleGroup`
read theirs, so a non-list is an empty table. A plain array and a document array pass through
untouched, so `each` still inserts one `<tr>` for one push.

**A `Pagination` clamps its page into the count, and writes the cell.** `page` past `count`, which is
what a filter that cut the list down leaves behind, rendered a window with no `aria-current`, a
disabled Next and a Previous that walked back one page at a time: a dead end reached by doing the
ordinary thing. The page is now clamped to `count` (and to 1 below it), and `count` of 0 renders no
page buttons with both arrows off.

**The clamp writes the cell and calls `onChange`, rather than drawing a page the cell disagrees
with.** The cell is the one source of truth, the way it is in `Tabs` (design 203); a component that
draws page 3 while the cell says 9 has a second opinion about which page is showing, and the caller
loading rows for the cell's page would load nothing. `onChange` is what a caller uses to fetch, so
it has to hear that the page moved; its event argument is null, because nobody pressed anything.
With `count` of 0 nothing is written: there is no page to be on. The cost is a component that writes
a cell without being clicked, which a caller who wanted to hold a page number past the end cannot
now do; the answer for them is to hold that number themselves and pass the clamped one in.

`packages/ui/tests/navigation.test.ts` pins all of it: the rows cell of null at mount and set to
null again, the page cell set past the count, the count cell shrinking under the page, and count 0.

## What would reverse this

A table that has to sort, select or resize its columns. That is behaviour, and it belongs in a
design note of its own saying what it answers to, the way `Tabs` does for its keyboard.
