# 296: `Markdown` renders a figure, nests a list, and hands out its slugger

Amends design 288, which named this as what would reverse it: a consumer that needs nested lists
or images. A blog post has pictures in it and its lists nest; a README has neither.

## Decision

**A figure block.** A paragraph that is one line, and that line is only an image, `![alt](src)`,
with an optional title after the source and an optional `=WxH` suffix after that, is a `figure`
block: a `<figure>` on `markdown_figure` holding an `<img>` on `markdown_image` with the alt text
on `alt` (its marks dropped, as the box of a task item drops them), or a `<video controls>` on
`markdown_video` when the source's path ends in `.mp4`, `.webm` or `.mov`; and, when the alt
text is not empty, a `<figcaption>` holding a `Typography` `p2` on `markdown_caption` over the
alt text, so a caption runs the modifiers as a paragraph does and a link in one is a link. The
`=WxH` suffix puts `width` and `height` on the element, both numbers or neither. The title is
read and dropped, as a link's is.

The source passes the check a link's `href` passes (design 288): a scheme other than `http`,
`https`, `mailto` or `tel` leaves the line a paragraph, and a path with no scheme, relative or
root-relative, passes, which is what a site's own media is. A `data:` source is a paragraph too,
by the same rule.

What stays text: an image inside a sentence, an image line that shares its paragraph with
another line (two image lines in a row are one paragraph; two figures have a blank line between
them), and an image in a list item or a quote. Each is the characters written, as before.

**A nested list.** An item indented to the content column of the item above it, or further, starts
a child list of that item. The content column is where the item's text begins: after the marker
and the spaces that follow it, so two spaces nest under `- a` and three under `1. a`, and a
leading tab counts as four columns. That is CommonMark's rule, and the second implementation the
corpus test compares against reads it the same way. `ListItem` gains `children`, a list of
`ListBlock`, each rendered as a `<ul>` or `<ol>` on `markdown_list` with the `nested` segment
inside the `<li>`, after the item's text, and after the box of a task item. A task item nests as a
plain one does, and the toggle still rewrites the line the item started on.

`children` is a list because a bullet list and a numbered list can both sit under one item: a
change of kind ends the child list, and the next item at that indent starts another. Three levels
are read. An item that would start a fourth joins the item above it as text, on its own line,
which is what every indented item did before this note.

**`slugger` exported.** `slugger()` answers a function from heading text to the id the heading
carries, GitHub's scheme, unique over the calls of that one function: a repeat is suffixed `-1`,
the next `-2`. A site builds a table of contents by calling it over the same headings in the same
order the parser saw them, and gets the ids the page has.

## Why

A figure is a block and not a modifier because a `<figure>` cannot sit inside a `<p>`: the browser
closes the paragraph before it, so a page rendered on the server and the same page hydrated would
hold different trees, and hydration adopts nothing it does not recognise. An `<img>` alone would
sit in a paragraph, but a caption and a video would not.

A figure is one line standing alone in its paragraph, rather than any line that is only an image,
because that is the rule the prior art uses (Pandoc renders an image alone in a paragraph as a
figure with its alt as the caption) and because the second implementation agrees with it: its
paragraph token holds one image token and nothing else, so the corpus test can read a figure from
its stream and no expected value here comes from the parser under test. A rule that ended the
paragraph at an image line would give one figure and one paragraph where the oracle gives one
paragraph, and would have to be asserted by hand.

`=WxH` is the size syntax because it is the extension most renderers that read a size read, and
the other, an attribute block in braces, uses a character nothing in the subset uses. The
attributes are written on the element because a browser lays the page out from them before the
bytes arrive, which is the whole point of writing a size.

The caption's entry is on its `Typography` rather than on the `<figcaption>` because the `text`
entry names a colour, and a colour on an element around a `Typography` never reaches the text
inside it: an application that overrode an entry on the wrapper would see nothing change. On the
text, `markdown_caption` overrides `text` as a later segment does, and an application's override
of it takes.

Nesting follows the content column because that is the rule every reader of markdown applies,
and a one-space indent under `- a` is a sibling everywhere else. Three levels because the posts
measured go to three, and a bound keeps the recursion finite for a document that indents every
line further than the last.

`slugger` is exported because a table of contents needs the ids the headings carry, and the one
site that built one kept a copy of the function to get them. An export is not a new concept; it
is a surface line, and this note is where it is written down.

## What this costs

An image line in a paragraph of two or more lines is text, which a writer who stacks images
notices; the fix is a blank line between them. `=WxH` is not CommonMark, and a reader that knows
only CommonMark shows the suffix as text. A `<video>` here is `controls` and a source and nothing
more: a poster, a captions track, a preload rule and lazy loading are not written, and a site
that needs one has no hook for it yet. A site whose modifiers matched an image line as text, to
embed a video from its URL, does not see the line any more, because it is a figure: the site
rewrites that line before the render, or waits on the hook below.

A nested list under a task item sits under the box, not under the text: the item is a wrapping
row and the child list is its last line. A fourth level is text. `children` is one more field on
`ListItem` for every reader of the blocks, empty on most items.

## What would reverse this

A consumer that stacks image lines and wants a figure from each, which would make an image line
end the paragraph above it as a heading does. A consumer that needs a fourth level, which is one
number. A site that needs a poster, a track or an embed, which brings a `figure` hook beside
`code`, handed the source, the alt text and the size, with the default rendering as its fallback.
A site whose captions need their own element entry, which would put a second entry on the
`<figcaption>`.

## Evidence

`packages/ui/tests/markdown.test.ts`: a figure with a caption and without one, with a size and
without one, a video figure, a title read and dropped; an image inside a sentence and an image
line sharing its paragraph as text; a figure with a scheme that runs something as text; the figure
cases the second implementation agrees on, compared against it; a three-level list rendered as
nested elements, a fourth level as text, a kind change under one item as two child lists, a task
item with a task child that still writes its source back; the slugger's collision rule through
the export; a page holding a figure and a nested list rendered on a server and taken over in place
with nothing replaced; and the corpus, unchanged, still read block for block as the second
implementation reads it. `recipes/ui/examples/markdown.example.tsx` shows a figure and a nested
list in both modes, so axe reads them.
