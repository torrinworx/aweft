# 180: `Typography` is the `text` family, with the `type` grammar the applications write

## Decision

`Typography` renders one run of text as one element, themed on the `text` entry this package
already has. It adds no second family: `text_h1` to `text_h6`, `text_p1` and `text_p2` join
`text_xs` to `text_2xl` and `text_mono`, and the modifiers `text_bold`, `text_italic`,
`text_regular`, `text_center` and `text_inline` sit beside them. `muted` composes as it does on any
element.

**`type` is split on `_` into theme segments.** `h2_bold` themes the element as `text h2 bold`,
so `text_h2` and `text_bold` both match and, by the theme's own ordering rule, the later segment
wins where they disagree. A word this package does not define is a segment like any other, so an
application's `text_eyebrow` needs nothing from the library. `type` is a value or a cell; a cell
re-splits on change and moves the theme. The element is picked once, when the component mounts,
and lasts as long as it does, as `Icon`'s does: a cell whose first segment changes from `p1` to
`h2` restyles the `<p>` and does not remount it. A page that needs the tag to follow writes a
`Switch`.

**The first segment picks the element.** `h1` to `h6` give that heading, `p`, `p1` and `p2` give
`<p>`, anything else gives `<span>`. Nothing else in `type` reaches the element. `element` hands in
a node to decorate instead, per the contract (design 109), which is how a heading's look goes on a
different level when the document outline needs it.

**It is built on plain `h`, like every other component here.** `ThemeContext.use` is an
application's tool for a subtree of its own and no library component goes through it, so neither
does this one.

**`label` and `children` both render, label first.** The same rule as `Button`. `label` is a value
or a cell. Neither is required: an empty `Typography` is an empty element.

**There is no editable branch.** A mutable cell as `label` renders the text and follows the cell.
Nothing swaps an input in on click and nothing measures text with a span appended to the body.
Editing is `TextField`'s job, and an application that wants inline editing composes the two.

## Why

The outline is plain themed text: `type` for the tag and the entry, no click-to-edit, no display
map. The existing family wins over a second one because the `text` entry, its sizes and `text_mono`
are already what the preview, the modal heading and the file drop list use; two families would be
two ways to size text. The grammar is what the applications write: measured across four
applications, `p2` 480 uses, `p1` 346, `h1` to `h6` 260, `_bold` 126, and `eyebrow` 54 as an
application-defined word. `label` carries the text in 1040 uses against 101 with children, and
`type` is a cell once. There is no text field inside this component.

## What this costs

An application's `typography_*` entries migrate by rename to `text_*`. A `type` such as `p3` or
`body` stays a `<span>`; an application that wants a `<p>` for it passes `element`. A word in `type` that no entry defines is silent, as it is on any
themed element: the theme check (design 119) is what reports an entry nothing matches.

## What would reverse this

An application needing the element chosen by something other than the first segment, which is a
`tag` prop; none of the four asks for one today. Or a second use of `type` on a cell beyond the one
measured, which would argue for a cheaper path than re-splitting.

## Evidence

`packages/ui/tests/typography.test.ts` runs every distinct `type` string the four applications use
through the component and asserts the element and the class segments each gets, renders a cell
label and a cell type and asserts both follow, and renders to markup and hydrates through the
existing harness. `packages/ui/tests/browser.test.ts` asserts in Chromium that `h2_bold` computes
weight 600 over the heading's own weight.
