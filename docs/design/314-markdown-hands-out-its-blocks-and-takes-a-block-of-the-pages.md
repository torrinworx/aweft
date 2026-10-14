# 314: Markdown hands out its blocks, and takes a block of the page's

Amends design 288 (Markdown) and design 296 (a figure, a nested list, the slugger).

## Decision

`@aweftjs/ui` exports `parseBlocks(source)`, the block reader `Markdown` renders from, and the types
of what it answers: `Block`, one type per kind of block (`HeadingBlock`, `ParagraphBlock`,
`CodeBlock`, `ListBlock`, `TableBlock`, `QuoteBlock`, `RuleBlock`, `FigureBlock`), `ListItem` and
`Align`.

`Markdown` takes `block`, a function of one block. What it returns is put in that block's place as
it is, with no element around it, and `null` draws nothing there. `undefined` keeps the block as
`Markdown` draws it, so a page draws the blocks it cares about and leaves the rest. `code` still
draws the body of a fenced block that `block` left alone, inside its `<pre>`.

## Why

Two sites copy the block grammar to read their own markdown: one to find its fenced blocks, its
image lines and its quotes, the other its headings, title, first paragraph and tables. The copies
already disagree with `Markdown` and with each other. A heading the parser folds into a list item
above it is a heading to one copy, and the id one copy gives a heading is not the one the page gives
it. Reading markdown with the reader the page renders with is the only way the two agree.

A page that draws one kind of block its own way, a fenced block holding a scene or a quote that
opens with `Note:`, had one hook, `code`, and whatever it returned was drawn inside a `<pre>`. One
site rewrote its markdown before rendering, turning an image line into a link and a quote's first
word into a mark a modifier could find, because a block was the one thing nothing could reach.

## What this costs

Two hooks reach a fenced block. They do two jobs: `code` draws the body and keeps the `<pre>` this
package gives every fenced block, focusable, scrolling sideways and labelled with its language, so a
highlighter writes only the text. `block` replaces the block and keeps none of that.

Twelve exports, eleven of them types. The block shapes are now surface: a field renamed is a change
an application sees. A `block` that draws a heading its own way gives it the id it chooses.

## Evidence

`packages/ui/tests/markdown.test.ts`: `parseBlocks` answers each kind with the fields the README
names, `block` replacing a fenced block with no `<pre>` around it, a quote replaced and a paragraph
left alone in one document, `undefined` keeping the default, `code` still reached for a fenced block
`block` declined, and the replaced block still inside `markdown`'s element and under its modifiers.

## What would reverse this

A second reader of the same grammar that the page does not render with, which would mean the grammar
wants a package of its own.
