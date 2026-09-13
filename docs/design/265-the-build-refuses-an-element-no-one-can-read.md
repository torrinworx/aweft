# 265: The build refuses an element no one can read

## Decision

The transform runs eight access rules over every element it reads, in whichever notation wrote
it, and refuses a fault the way it refuses an unclosed tag: a `TransformError` with a `reason`,
a `fix` and the offset in the source. The rules look at the tag, the literal attributes, the
children and the ancestors inside the same JSX, markup or `h` call tree, and nothing else.

| reason | what was written | the criterion |
|---|---|---|
| `image-needs-alt` | an `img` with no `alt` | 1.1.1 |
| `control-needs-label` | an `input`, `textarea` or `select` with no `id`, `aria-label` or `aria-labelledby` and no `label` around it; an `input` whose literal `type` is `hidden`, `submit`, `button`, `reset` or `image` is exempt | 1.3.1, 3.3.2, 4.1.2 |
| `click-needs-role` | a click listener (`$onclick`, `onclick`, `onClick`) on an element that is not natively interactive and carries no `role` and no `tabindex` | 2.1.1, 4.1.2 |
| `tabindex-positive` | a literal `tabindex` or `tabIndex` above zero | 2.4.3 |
| `link-needs-href` | an `a` with no `href` | 2.1.1, 4.1.2 |
| `button-needs-name` | a `button` with no children and no `aria-label`, `aria-labelledby` or `title` | 4.1.2 |
| `heading-needs-text` | an `h1` to `h6` with no children and no `aria-label` | 2.4.6 |
| `frame-needs-title` | an `iframe` with no `title` | 4.1.2 |

Natively interactive means `a`, `button`, `input`, `select`, `textarea`, `summary`, `details`,
`option`, `label`, `audio` and `video`.

**An attribute given as an expression counts as present.** `alt={caption}` satisfies
`image-needs-alt` whatever `caption` holds at run time, because the source said the image has
one. **A spread makes the element unknowable and it passes.** `<input {...props} />` may carry
its label in `props`, and which of the two the source means is not something the transform can
read. **Only a literal tag is read.** `h(tag, ...)` with `tag` a variable is not an element the
rules see.

The rules run once per element tree, at the top of it, so a control inside a `label` written in
the same expression is labelled however the tree is later split between a template and a call.
A control whose `label` is in another expression, or another component, needs an `id` or an
`aria-label` to pass, which is also what a screen reader needs to pair them.

## Why

The components of `ui` are accessible by construction, and nothing checks what an application
writes around them. The eight faults are the ones a page written by hand makes first and the
ones no later check catches as cheaply: an image with no alternative is silent to a screen
reader, an unlabelled field is a box with no name, a click on a `div` is unreachable from a
keyboard, and a positive `tabindex` reorders the page for everyone who tabs through it. Each is
decidable from the source alone, and the source is the one place a fault can be reported at the
line that wrote it.

The transform is where every element passes: JSX, markup in a template literal and a hand
written `h` call are all read into one `Element` model before anything is hoisted, so one pass
sees every notation, in a bundle and under the Node loader alike. A rule anywhere later sees an
element already split between a template and a call, and a rule anywhere earlier sees one
notation.

A refusal rather than a warning, because a warning at build time is a line in output nothing
reads, and a refusal carries its fix (design 101). The rules stop at what the source settles:
a criterion that needs the rendered page (contrast, focus order, a name that comes from an
`Icon` inside a button) is the audit's job at test time, and a criterion that needs judgment
(meaning by colour alone, timing, consistent navigation) is nobody's tool.

## What this costs

One walk over each element tree the transform reads, comparing tag names and attribute names.
No allocation beyond the ancestor list.

An element written with a spread is never refused, so a page that spreads everything gets no
help from this pass. An `id` proves a label could exist, not that one does. Both are caught by
`audit` from `@aweftjs/testing/browser` (design 267) over the rendered page.

A `.ts` file is read by the bundler plugin and not by the Node loader, which compiles only
`.tsx`, so an `h` call in a `.ts` file is refused in a bundle and not under `node --test`. That
is the loader's existing shape (design 110), not this pass's.

## Evidence

`packages/build/tests/access.test.ts`: each rule refused on its fault with the reason, the fix
and an offset at the element, and passed on the fix; the same fault as JSX, as markup and as an
`h` call; an expression on the attribute passes; a spread passes; a control inside a `label` in
the same tree passes and one in a sibling tree does not; a `.tsx` imported through the loader
throws with the reason. `packages/build/errors.txt` carries the eight reasons and their fixes.

## What would reverse this

A rule that refuses a page written correctly, for a shape the source cannot express otherwise.
Then that rule narrows or goes; the pass stays.
