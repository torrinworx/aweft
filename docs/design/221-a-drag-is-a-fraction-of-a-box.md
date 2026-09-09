# 221: A drag is a fraction of a box, on the pointer and on the keyboard

Extends design 129: `drag.ts` is the fifth shared behaviour, internal like the other four and
tested once.

## Decision

**One internal function, `drag.ts`, turns a pointer or a key into a place in a box.** It is not
exported from `@aweftjs/ui`. The place is two numbers, `x` and `y`, each 0 at one edge of the box
and 1 at the other, clamped so nothing outside the box is outside the range. What the numbers mean
is the caller's: `ColorPicker` reads `x` as saturation and `1 - y` as brightness (design 222).

**It hands back handlers, not listeners.** A hydration adopts the server's nodes and drops the ones
a mount built (design 133), so a behaviour that held a node and called `addEventListener` on it
would be listening to an element no longer on the page. The other four behaviours in design 129
attach to the document or to nodes a caller keeps; this one attaches to the element a component
renders, so it gives that component five props to write instead:

```ts
const grip = drag({ axes: 'xy', at: () => place(), onMove: (to) => write(to) });
h('div', { ...grip.pointer, style: { … } }, h('span', { ...grip.keys, role: 'slider' }));
```

`grip.pointer` is `onPointerDown`, `onPointerMove`, `onPointerUp` and `onPointerCancel`.
`grip.keys` is `onKeyDown` alone. They are two objects rather than one because the box the pointer
is measured against and the element the keyboard lands on are not always the same element: the
picker's plane is the box and the thumb inside it is what takes focus. Written on one element, the
two spread onto it together and the behaviour is a pointer and a keyboard on the same element.

**The pointer.** `pointerdown` asks the element for pointer capture and moves at once, so a press
anywhere in the box jumps there rather than waiting for the first move. While captured, every
`pointermove` moves. `pointerup` and `pointercancel` release the capture and stop, and a
`pointermove` after either moves nothing: without the release a pointer merely passing over the box
would drag it.

Capture is what makes a drag that leaves the box keep working, and it is asked for on the element
rather than by listening on the document, so there is nothing to remove when the element goes.
A host with no `setPointerCapture` still drags, because the handlers are on the element and the
guard is the behaviour's own flag rather than the host's capture.

**A touch is a pointer.** A pointer event is a pointer event, so a finger and a stylus drag the
same way a mouse does with no second code path. The element the caller writes these on wants
`touch-action: none` in its theme entry, or the host scrolls the page instead of dragging, and
that is a theme rule rather than anything this file writes.

**The keyboard.** On the element the caller gave `grip.keys`:

| key | what it does |
|---|---|
| `ArrowLeft`, `ArrowRight` | one step along `x`, less and more |
| `ArrowUp`, `ArrowDown` | one step along `y`, less and more. `y` grows downward, because that is the direction a box is measured in, so `ArrowUp` is `y` minus a step |
| `Home` | the near end of the first axis in play |
| `End` | the far end of that axis |
| any of them with Shift | the coarse step instead |

The step is the caller's: `step` is one press as a fraction of the whole range, `0.01` when it is
not named, and `coarse` is Shift, ten steps when it is not named. An axis the caller left out does
not move, so a one-axis drag ignores the two keys that would move the other one. A key that moved
something calls `preventDefault`, so an arrow inside a box does not also scroll the page.

**Reduced motion changes nothing here**, because this file moves nothing. It reports a place and
the caller writes it; whether the thing that lands there travels or jumps is the theme's transition
and the theme's reduced-motion query.

## Why

Two axes at once has no native element. Design 128 says every control in this package is one
native element the theme dresses, and its own reversal clause is exactly this case: an application
needing a control the platform has no element for gets one built the other way, with a note of its
own. A saturation and brightness square is that control, so the geometry, the capture and the key
map have to be written, and they are written once rather than once per component.

Internal rather than exported, for design 129's reason unchanged: a behaviour layer is not a
component, and the exported surface does not grow. A function rather than a component, because it
renders nothing.

Fractions rather than pixels or a caller's own units, because the box is measured at the moment of
the event and a caller that stored pixels would be storing a number that a resize makes wrong. A
fraction survives a resize, and turning it into saturation, into degrees or into a scroll offset
is one multiplication at the call.

## Evidence

`packages/ui/tests/internal.drag.test.ts` drives the handlers against a fake element with a box of
its own: the fraction at each corner and at the middle, a press outside the box clamped to the
edge, a zero-width box answering 0 rather than a division by zero, an axis the caller left out
staying where it was, capture asked for on the way down and released on the way up, a move after
the release moving nothing, a `pointercancel` releasing the same way, the whole key map with and
without Shift, `Home` and `End` on a one-axis drag reaching the far axis rather than `x`, a
disabled drag ignoring both a press and a key, and `preventDefault` called on a key that moved and
not on one that did not.

`packages/ui/tests/browser.test.ts`, through the one component that calls this, drives a real
pointer down and across a real element in Chromium and reads back where the behaviour said the
press landed. That is the part no fake box can answer: a box measured by the host's own layout,
`setPointerCapture` as a real call on a real element, and the moves that follow arriving because
of it. `recipes/ui/main.ts` does the same on the catalogue's own page.

The suite above pins the clamp, the order of the two axes, and the release on `pointerup`.

## What this costs

A component using it writes five props rather than none, and has to put `touch-action: none` in
the entry for the box. Neither is hidden: both are in design 222's plane and in the example above.

A caller that wants a drag along a path that is not a box gets nothing from this file. That is the
whole of what it does and it is the shape the components that call it want.

## What would reverse this

An application needing a drag on an element of its own. Then this joins design 129's list of four
as a thing to export, and the shape does not change.
