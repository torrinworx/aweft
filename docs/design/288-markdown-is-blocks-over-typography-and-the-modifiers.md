# 288: `Markdown` is blocks over `Typography`, with the inline syntax as modifiers

Amended by design 296: a paragraph that is one image line is a `figure` block, an indented item is
a child list three levels deep, and `slugger` is exported. The nested list and the image on a
line of its own leave the text paragraph below.

## Decision

`@aweftjs/ui` exports `Markdown`: `<Markdown source modifiers code />` renders a markdown
string, or a cell holding one, as themed blocks whose text runs are `Typography`, with the
inline syntax as entries in the render's `TextModifiers` list. One parser of its own, line
based for blocks, for the subset the documentation corpus uses. No dependency: `marked` is a
development dependency of this package's suite, the second implementation the corpus test
compares against, and nothing else.

**The blocks.** A heading `#` to `######` is `Typography` `h1` to `h6` on the `markdown_heading`
segment, with an `id` in GitHub's scheme (lowercased, marks and punctuation dropped, spaces to
hyphens, a repeat suffixed `-1`), so a page can link to a section the way GitHub does. A
paragraph is `p1`, its lines joined by a space and a hard break (two trailing spaces) a newline.
A fenced block is a `<pre>` on `markdown_code` with the language on `data-language`, holding
whatever `code(text, language)` answers, by default a `<code>` holding the text; it is focusable,
as the table's scroll box is, because a block that scrolls sideways and cannot be focused is
unreachable from a keyboard. A bullet or
numbered list is a `<ul>` or `<ol>` on `markdown_list` (`ordered` for the second, with `start`
where the first number is not 1), each item an `<li>` on `markdown_item`; a task item takes the
`task` segment and a `Checkbox` that follows the source. A table is a `<table>` on
`markdown_tabular`, inside the `table_scroll` box, with the `table_head`, `table_line`,
`table_heading` and `table_cell` parts the default theme already defines, so a hand-written
table and a markdown table are one look and the data grid `Table` is not involved. A blockquote
is a `<blockquote>` on `markdown_quote`, its lines one paragraph. A rule is an `<hr>` on
`markdown_rule`, which extends `divider`.

**The inline syntax** is five modifiers, each in `TextModifiers`' `{ check, return }` shape: a
code span (one or two backticks) as `<code>` on `markdown_inline`; bold italic, bold and italic
(asterisks or underscores) as `<strong>` on `markdown_bold`, `<em>` on `markdown_italic`, and
the two nested; a link `[text](href)` as `<a>` on `markdown_link` with the `href` as written,
unless its scheme is one that runs something (anything but `http`, `https`, `mailto`, `tel`),
in which case the link stays text, as design 274 refuses `javascript:` in a fetched drawing. A
modifier's own text runs the list again below it, because a bold lead sentence with a code span
in it is the commonest line in this repository's READMEs, and `TextModifiers` renders what a
modifier returns with no modifiers below (design 181). The application's `modifiers` go in front
of these five, so a mention or a wiki link runs inside markdown with nothing wired.

**What is text.** A nested list (an indented item joins the item above it, as written), an
image, a footnote, an HTML tag, an autolink, a reference link, a setext heading, an indented
code block, an escape: each stays in the paragraph as the characters written. Raw HTML is never
markup, because a paragraph is a text node and nothing here sets `innerHTML`.

**A cell source re-renders.** The whole block list is built again when the cell changes; there
is no diff. A task item's `Checkbox` is disabled unless the source is writable, and then a
toggle rewrites that item's `[ ]` or `[x]` in the source and sets the cell, so the document a
page shares is what moved and every reader of it follows.

**The theme.** Every entry above is a `markdown_*` name in the default theme, every value a
`$name` (design 119), and an application overrides one the way it overrides `button`. Nothing
here names a colour: the code block is `$surface` on `$surfaceForeground`, the link `$link`,
the quote's bar `$border`, so both modes are the same entries.

## Why

The documentation site (aweft.dev) is markdown end to end, and a component that renders the
same string on the server and in the browser makes every page an ordinary aweft page with no
rendered HTML carried between the two. The block set is what the corpus uses, measured over
7,066 lines of READMEs, `docs/security.md` and the spec: 360 headings, 257 fences, 419 table
rows, 143 flat bullets, 25 numbered items, 92 links, one blockquote, eight rules, no image, no
footnote, nothing nested. It is the predecessor application's markdown component ported (623
lines, the block pass by line and the inline pass through the modifiers, measured in design
181), with what the corpus does not use left as text rather than carried.

`marked` is the oracle and never the renderer: the corpus test compares this parser's blocks
against its token stream, so the expected values come from a second implementation and never
from the code under test. It is a development dependency of this package alone, and the
dependency allowlist says so.

## What this costs

A cell source rebuilds every block on every change, so a long document edited live pays the
whole parse and mount each time; an editor is a different component (the rich text editor stays
deferred). A construct outside the subset shows its characters, which a reader of a README that
uses one will notice; bringing it in is one block or one modifier. Inline nesting runs the
modifier list once per level, so a paragraph of nested emphasis costs one pass per nesting.
The `id` on a heading is GitHub's scheme and not CommonMark's, which has none. Emphasis of
mixed length opening inside another (`***a** b*`) is read outermost first, not as CommonMark
reads it; the corpus never writes it.

## What would reverse this

A consumer that needs nested lists or images, which brings them in as blocks and a modifier. A
second implementation whose token stream the corpus test cannot be reconciled with, which would
say the subset is not the corpus. A page that needs a diffing re-render, which would make the
block list an `each` over a list of blocks.

## Evidence

`packages/ui/tests/markdown.test.ts`: every README, `docs/security.md` and the spec files
rendered on the light tree and compared block by block against `marked`'s lexer (kind, depth,
text); one README rendered by `render`, parsed back and hydrated with the same source with no
element replaced; a cell source whose blocks follow it, with the element count asserted; a task
toggle writing the source; the `code` hook called with the text and the language; an
application modifier running inside a paragraph and inside bold; every inline form, and each
construct left as text. `recipes/ui/examples/markdown.example.tsx` shows every block and inline
form in both modes, so the catalogue drives it and axe reads it.
