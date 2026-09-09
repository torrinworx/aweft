# 107: `ui` ships its own `h`, and a wrapped element mounts through a mounter

Amended by design 133: a handler is a `$on<type>` property rather than an `addEventListener` call,
and two of the state props follow different events for the same reason.

## Decision

`@aweftjs/ui` exports `h`, `svg` and `html`. Each makes its nodes through `dom`'s
`createElement`, hands everything it does not claim to `dom`'s `h`, and claims eight prop
names for itself:

| prop | what `ui` does with it |
|---|---|
| `theme` | a string, an array, a cell, or arrays of those, flattened at mount into one class list |
| `class` | kept, and joined in front of the classes the theme generated |
| `style` | an object or a string, with numbers in `sizeProperties` given `px` and `$var` resolved |
| `isHovered`, `isFocused`, `isClicked`, `isTouched` | a cell `ui` writes from real events. `isFocused` follows `focus` and `blur`, `isTouched` the pointer events with `pointerType === 'touch'` (design 133) |
| `on` + an uppercase letter | a handler, handed to `dom` as a `$on<type>` property so a hydration replays it onto the node it adopted, and gone when its element goes (design 133) |
| `each:name` | on a component: the item arrives as `props.name` rather than `props.each` |

An element with none of those is `dom`'s `h` exactly, returned as `dom` returns it: the
element itself when nothing is reactive.

An element with any of them **returns a mounter**, not a node. The wrapper work has to run
where the mount context is in hand, and `dom` hands the context to a mounter and to nothing
else. So `ui.h('div', { theme: 'card' })` is a function to hand to `mount`, and
`ui.h('div', { class: 'card' })` is still an element.

`style` is written as one `style` attribute, not onto `element.style`. One write covers the
whole declaration, the light tree and a browser take the same path, and the value is in the
markup a hydration compares.

## Why

The theme a node gets is decided at mount time, not when `h` runs, because the theme depends
on the `ThemeContext` above the element and on the render's class cache. Both live on the
context `mount` threads. `dom` never reads that context and hands it to a mounter, so a
mounter is the only honest seam, and returning one is what `ui` costs.

Events go through `addEventListener` rather than `$onclick` so `ui`'s own `isHovered` wiring
and an application's `onMouseEnter` can both be on one element. The light tree has
`addEventListener`, so a static render takes the same path and fires nothing, which is what a
static render should do.

## What this costs

`const box = ui.h('div', { theme: 'card' })` is not a node, and an application that wants the
element writes `class` instead, or reaches the node with the `element` prop of whatever
component it is handing it to. `dom`'s `h` already returns a non-node when anything inside is
reactive, so this is a wider case of a rule callers already have.

One extra mount per wrapped element, which `bench/ui-hoist.ts` measures against the same page
written against `dom`.

## What would reverse this

`dom` growing a signal kind that is handed the mount context, which would let a wrapped
element stay a `Bound` and keep its node. That is a change to the mounting model, concept 9,
and would need a design note of its own.
