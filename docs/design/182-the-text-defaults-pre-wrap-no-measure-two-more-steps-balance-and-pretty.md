# 182: the text defaults: `pre-wrap`, no measure, two more scale steps, balance and pretty

## Decision

**The `text` entry keeps `white-space: pre-wrap`.** A newline in a label is a line break on the
page. An application that wants collapsing writes `normal` on its own entry.

**No paragraph has a maximum width.** `text_p1` and `text_p2` set a size and a line height and
nothing else. A measure is the application's: `maxWidth` on `text_p1`.

**The scale gains `$text3xl` (1.875rem, line 2.25rem) and `$text4xl` (2.25rem, line 2.5rem)**,
fixed rem steps like the six before them, and the two size variants `text_3xl` and `text_4xl`
join `text_xs` to `text_2xl`, because every step of the scale has one and a step without one
would be the odd case. `text_h1` is 4xl, `text_h2` 3xl, `text_h3` 2xl,
`text_h4` xl, `text_h5` lg, `text_h6` md, every heading at weight 600. `text_p1` is md and
`text_p2` is sm. No `clamp()`: the settled look is in rem and the preview asserts it.

**Headings get `text-wrap: balance` and paragraphs `text-wrap: pretty`.** Balance evens the lines
of a short block and is capped by the browser at a handful of lines, so it suits a heading and does
nothing for body. Pretty avoids a lone last word. Both are hints a browser without them ignores.

## Why

Measured: about 47 labels across the four applications carry a template literal or a newline and 8
places set `pre-wrap` by hand; `normal` would break those on migration. One application's Markdown
component removes an 80ch cap and says why in a comment, that inside a column that already bounds
the width the cap leaves body text narrow and left-aligned. An `h1` at the scale's old top,
1.5rem, is a large paragraph, and the settled look is fixed rem with body at one rem, which the
preview asserts.

## What this costs

A newline in a label is a line break, so a label assembled from lines that were never meant
to break shows them broken; the JSX transform collapses formatting whitespace before `pre-wrap`
sees it, so ordinary multi-line markup is unaffected, and `label` is where 1040 of 1141 uses put
the text. Two more named
values in `tokens.txt`. A heading that wraps to many lines is left unbalanced by the browser's own
cap.

## What would reverse this

An application needing a fluid heading, which is a `clamp()` on its own `text_h1`. A page whose
labels turn out to rely on collapsed whitespace, which the migration will show.

## Evidence

`packages/ui/tests/look.test.ts` asserts the two steps and the heading weights in the generated
CSS and that `text_bold` after `text_h2` wins. `packages/ui/tests/browser.test.ts` reads the
computed weight and `text-wrap` off a rendered heading in Chromium. The preview page shows h1 to h6,
both paragraphs and the modifiers in both modes, and axe-core passes it, heading order included.
