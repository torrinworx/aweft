# 257: The sheet emits deltas, and each one gets a `<style>` of its own

Amends design 109. One sheet and one class sequence per page still hold. What changes is that a
render owns one `<style>` for the page it loaded with, plus one for each class compiled after that,
and no element is written twice once it holds CSS. Supersedes design 255, which was written for the
same defect, reached the same element shape, and was never built.

## Decision

`Sheet` holds its emissions as one append-only `mutableArray` of pieces, `{ kind, css }` with `kind`
one of `import`, `at` and `rule`, in the order they were emitted. Any run of pieces writes out the
same way: the imports first, because a parser accepts one only at the top of a sheet, then the
`@layer aweft` block with the at-rules ahead of the style rules. `markup()` is every piece written
out, byte for byte what it was before. `text` is that same string as a cell over the list.

`Sheet.watch(fn)` hands a watcher the CSS one compile added, written so it stands alone, and returns
the unsubscribe. It is `mutableArray.watch` with the adds mapped through the same writer, so one
compile is one delivery in the same task.

`attachSheet` gives the element it creates the whole of `markup()` before that element enters the
head. Every delivery after that goes into a `<style>` of its own, written the same way, and all of
them come out when the mount does. No element the document already holds is ever written, including
the empty one an unthemed page leaves behind: an empty stylesheet is a stylesheet, and writing into
it drops the page's faces exactly as a rewrite does.

The one element written in place is the one a hydration adopts when the client's theme disagrees
with the server's. That is the mismatch the README already documents, it happens once, and the
alternative is a page styled by two disagreeing sheets at once.

A grown element carries `data-aweft` as well as `data-aweft-grown`. The first is how the rest of this
stack tells its own style elements from a page's head tags, and the second is beside it so
`existingSheet`, which takes the first `data-aweft` in the head, still takes the element the page
loaded with. What this asks of a reader is the one thing that changed: the whole sheet is every
`style[data-aweft]`, not the first.

## Why

The sheet was the one `ui` system off core's model. Core is an observable and its deltas, `dom`
renders a list from `mutableArray.watch(changes)`, and `ui`'s popup and head registries are the same
shape. The sheet kept three arrays and published a `mutable<string>` of the whole stylesheet, so the
only thing the DOM side could do with a change was replace the element's text. That element holds
the application's `@font-face` rules.

A browser registers a face by name when it parses the sheet that declares it. Change that sheet
afterwards and every face it registered is dropped and registered again with no data behind it,
so the page has no webfont until the data is back. Measured on the first application on the stack
with webfonts, the sheet grew 44,814 to 52,198 characters across six hovers, and each of those
writes re-registered all six faces.

## What a browser does with a stylesheet that changes

Measured in Chromium 142 and Firefox 149 on a page with one loaded face, reading
`document.fonts.check` and the face object in the same task as the write. "kept" means the check
still answers true and the face is the same object.

| what the write does | Chromium | Firefox |
| --- | --- | --- |
| replace an existing sheet's text | dropped | dropped |
| append a text node to an existing sheet | dropped | kept |
| `insertRule` a plain style rule | kept | kept |
| `insertRule` a rule wrapped in `@media`, `@container` or `@starting-style` | dropped | kept |
| `insertRule` an `@font-face` or `@import` | dropped | kept |
| `replaceSync` a constructed sheet already adopted | dropped | kept |
| remove a sheet from the document | dropped | kept |
| write text into an empty sheet the document has held | dropped | dropped |
| **a sheet that is new to the document, element or constructed** | **kept** | **kept** |

The face need not be in the sheet being changed. A face declared in the page's own `<style>` is
dropped by a write to this package's element, so keeping the faces in a sheet of their own is no
escape, and neither is writing only into an element that holds nothing.

That table is what rules out every shape but this one. In particular it rules out growing one
element through the CSSOM, which is where this note started: the theme wraps a rule in `@media` for
every class it compiles, because the base entry carries a `prefers-reduced-motion` block, so a
growth that is only plain rules does not occur in practice.

A sheet that is new to the document also applies in the same task it is appended: the padding a
class compiled at that moment asks for reads back immediately, so nothing that measures itself,
a popup choosing a side or a list sizing to its control, measures before the rules are there.

End to end, the same application built both ways and driven the same way, hovering all 36 controls
on its landing page, counting the frames whose text measures as the fallback face rather than the
one the page asked for:

| the page's sheet | fonts served | frames in the fallback face | font requests |
| --- | --- | --- | --- |
| rewritten | `no-cache` | 15 in Chromium, 18 in Firefox | 42 |
| a `<style>` per growth | `no-cache` | 0 in both | 0 |
| rewritten | cached | 0 in Chromium | 0 |
| a `<style>` per growth | cached | 0 in both | 0 |

The fallback counts are a timing measurement and move a few frames run to run; the zeros do not.

Seven classes compiled at run time, so seven writes either way. The third row is why this was hard
to see: a browser holding the font data recovers before it paints, and the application that found
this was serving its faces `no-cache`, which is a bug of its own and fixed in that application.
Firefox under the test driver keeps no HTTP cache between visits, so it has no cached row; a real
Firefox 149 asked for no font at all on a second visit.

## What this costs

- The head gains one element per class compiled after the mount: seven on the landing page of the
  first application on the stack, hovering every control it has.
- A reader that wants the whole sheet out of the DOM reads every `style[data-aweft]` and joins them.
  `recipes/ui/main.ts` did four such reads and now joins.
- Cascade order is unchanged. New rules already landed last inside `@layer aweft` and still do, now
  at the end of the last element rather than the end of the only one. Layers of the same name merge,
  and document order breaks ties inside one.
- `markup()` is still the whole sheet, so a static render and the SSG path are untouched.

## What would reverse this

A browser that registers a face per sheet, so changing one sheet leaves another's faces alone. The
table above is the check; re-run it and read the last row against the others. The other cure would
also reverse this: a sheet that emitted every interaction variant during the render that produced
the markup would compile nothing at run time and would need no second element. That is a change to
the theme engine and a much larger one.
