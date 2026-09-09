# 125: What an act change does to the page

Amended by design 213: a stage calls its template as `h(template, props, act)` rather than
`h(template, {}, act)`.

## Decision

A single page that swaps its content has to do by hand the three things a document load does for
free. `Stage` does all three, every time `current` changes, once the new act is actually in the
document.

1. **Focus moves to the act's root element**, the first element the act's template put in the
   document. An element that cannot take focus is given `tabindex="-1"` first. Without this, the
   keyboard is still where the link was, which on a page that has just replaced everything below
   that link means nowhere useful.
2. **The new title is announced.** The root stage renders one visually hidden `aria-live="polite"`
   region and every stage below it announces through that one, so a page has one region however
   many stages are nested in it. The text is the title the render's head list resolved (design
   127), falling back to `document.title`. Nothing else in the page is read out, because the act
   is about to be read out anyway by the focus move.
3. **Scroll.** If the router has a position saved for the entry showing now, it is restored.
   Otherwise, the element the URL's hash names is scrolled to, and with no hash the page goes to
   the top.

All three are browser work and all three are no-ops with no `window`. The live region element is
still rendered in a static render, empty, so the markup a hydration adopts is the markup the
client builds.

**When.** The act's content reports that it has mounted, and the three run then, synchronously,
inside the same delivery that swapped the content. So a restored scroll position is in place
before the browser paints, and the page does not flash at the top of the document on the way back.
A lazy act reports when the loaded act mounts, not when its loading fallback does, so focus lands
on the real page.

## Why

Each of the three is a known accessibility defect of routed pages, and each is invisible to the
person who wrote the page because none of them is visible to a mouse. Putting them in the router
would be wrong: the router does not know what an act is or which element is its root. Putting them
in the application means every application has to know all three exist.

The live region carries the title rather than the act name, because the title is the sentence
someone wrote for a person to read, and the act name is a key in a table.

Restoring before paint rather than after, because after is a visible jump. The requirement drives
the ordering: the effects wait for the content to be in the document, and the content mounting is
synchronous, so the whole sequence lands inside one delivery.

## What this costs

`Stage` writes `tabindex="-1"` onto an element the application rendered, which shows up in the
DOM and in any snapshot of it. The alternative is a wrapper element around every act, which shows
up in the layout.

An application that wants none of this has no switch for it. That is deliberate: an opt-out for
accessibility work is an opt-out everybody takes.

## What would reverse this

The platform growing a way to move focus and announce a view change from the history API itself,
which is what the Navigation API's precursors have gestured at and none of them has landed.
