# 109: One object per render carries every `ui` system

Amended by design 257: the render's `<style>` is written whole once, and every class compiled after
that goes into an element of its own. One sheet and one class sequence per page are unchanged.

## Decision

`ui` holds no mutable state at module scope. Everything that would be a module singleton lives
on one object made per render:

```ts
interface Render {
	readonly theme: ThemeSink;   // the class cache and the <style> sink for this render
	readonly head: Registry;     // reserved
	readonly stage: Registry;    // reserved
	readonly ids: Ids;           // the counter behind an aria-labelledby and its friends
	readonly popups: Registry;   // where a popup mounts
}
```

`ui`'s `mount`, `render` and `hydrate` each make one and thread it through `dom`'s opaque
context. `context()` makes one for a caller that wants to hold it, and every entry point takes
one as an optional last argument.

`head` and `stage` are reserved and are `Registry`, which is what `popups` is: an observable array
plus `add`, returning the removal. Filling them with entries changes no caller.

`ids.next(prefix)` counts from zero per render, so a server and a browser walking the same item
mint the same ids and a hydration matches.

A `ui` system reached with no such object on the context asserts and names the fix: mount
through `ui`'s `mount`, `render` or `hydrate`, or pass a `context()` to `dom`'s.

### Amended: a default render is per document

`mount` and `hydrate` used to make a fresh render whenever the caller named none. Two widgets
mounted by two calls into one page therefore counted classes from zero twice: both got
`class="aw0"`, each mount appended its own `<style data-aweft>` defining `.aw0` differently, and
in Chromium both elements computed the second one's colour.

So the render a default mount gets is per document. `mount` and `hydrate` ask the target's
document for the one every default mount into it shares, and make it only the first time. One
sheet, one `<style>`, one class sequence per page. It lives on the document under a symbol rather
than in a table in `render.ts`, so this package still holds nothing mutable at module scope, and
two documents still cannot reach each other's classes.

The `<style>` is counted rather than owned by one mount: a second mount sharing a render adds no
element, and the first of them to go takes none away.

A render passed in by name is used as it is. That is what a static render needs (`render()` still
makes its own, having no document to ask) and it is how a caller takes the isolation into their
own hands. Two named renders in one page count classes from zero twice, as they did before, and
that is the caller's choice rather than the default.

Checked by `two default mounts into one page get different classes and share one stylesheet` and
`a mount given its own context is not adopted into the document's` in
`packages/ui/tests/render.test.ts`, and by `two mounts into one page compute the colour each of
them asked for` in `packages/ui/tests/browser.test.ts`, which reads the computed colour out of
Chromium.

## Why

A registry at module scope is a correctness bug the moment one process renders two pages. It is
not about request-time rendering, which is not planned. It is what lets a static build render
pages in parallel with no reset between them, and it is the difference between a `<style>`
element mounted at import and one owned by the render that filled it.

Theme *definitions* stay static at import: they are data, they are written once by a component
module, and nothing writes them per render. What is per render is what a definition compiled to
for this page, which is the class cache and the sheet.

`Registry` rather than three shapes because all three are the same job: a list a component pushes
into and splices itself out of, that something else renders.

## What this costs

Every public entry point of `ui` takes a context, and a component that reaches a `ui` system from
outside a mount gets an assert rather than working by accident.

## What would reverse this

Nothing available. A module singleton is the thing this rule exists to refuse, and the failure it
prevents is documented in the field twice over.
