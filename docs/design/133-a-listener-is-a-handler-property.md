# 133: What this package writes on an element goes through `dom`, so a hydration keeps it

## The defect

Every control on a page that came from a server was inert and unthemed.

`ui` claimed `onClick`, `onInput` and the four `is*` state props off an element and attached them
with `addEventListener` when the element mounted, on the element `h` had just made. Under a
hydration that element is not the element the page keeps: `dom` builds the client's tree, pairs
each fresh node with the server's, copies the fresh one's attributes and properties across, and
drops it. Listeners are neither an attribute nor a property, so they went into the bin with the
node they were on.

Measured in the light tree:

```
mounted: clicks = 1
hydrated: clicks = 0   class after hover = aw0     a Button: the click and the hover both dead
hydrated plain h: clicks = 0                       a bare themed <button> with onClick: dead too
```

A `$onclick` written by hand survived the same hydration, because `Hydration.pairElement` replays
`propertiesOf(fresh)` onto the server node (`packages/dom/src/hydration.ts:194`) and a `$name`
prop is a recorded property.

The class had the same shape of problem for the same reason. `applyClaimed` wrote it with
`setAttribute` on the fresh element, so the class the server sent was right and every change after
it went to the node nobody can see:

```
mounted:  class aw0 -> aw1   disabled attr = ""
hydrated: class aw0 -> aw0   disabled attr = ""
```

`disabled` moved because `dom` binds it as a reactive attribute and re-targets the binding onto the
paired node. That is the whole answer: what `dom` binds survives, what this package writes by hand
does not.

## Decision

**Nothing this package computes is written onto an element. It is handed to `dom` in the props, and
`dom` writes it.** One mechanism does the job, and everything `dom` binds is carried across a
hydration onto the node it adopted.

**Every handler `ui` owns is a `$on<type>` property.** Nothing in this package calls
`addEventListener` on an element it themed.

`splitProps` builds one property per event type, and that property fans out, in this order:

1. the caller's own `$on<type>`, if they passed one, because theirs is the one that may want to
   stop the event before this package's own reads it,
2. the `on<Type>` handlers this call claimed,
3. the writers for the `is*` state cells.

A caller's `$on<type>` that is not a function beside one of those is an assert, because one of the
two has to go.

**The class and the style are cells.** `splitProps` makes one `mutable` per element for each and
hands them to `dom` as the `class` and `style` attributes; the tracker in `applyClaimed` writes the
string it computes into the cell rather than onto the element. `Dress` still runs before the mount,
so each cell holds its string before `dom` binds it, the fresh element carries what the server sent
when the two are compared, and the binding is re-targeted with the rest. `Icon` does the same by
hand, because an `<svg>` has no `theme` prop to claim.

Two things fall out of that. `applyClaimed` no longer takes an element, because it no longer
touches one, so what `h` and the compiled template carry to the mount is a list of claims rather
than a list of element-and-claim pairs. And a claim that arrives without the cell its answer goes
into is an assert, because the alternative is a class that silently goes nowhere.

**Two substitutions**, because the platform keeps no property for the events the state props used
to listen for. In the gate's Chromium, `'on' + type in element` is true for `click`, `input`,
`keydown`, `mouseenter`, `mouseleave`, `mousedown`, `mouseup`, `focus`, `blur`, `pointerdown`,
`pointerup`, `pointercancel` and the rest of the pointer set, and false for `focusin`, `focusout`,
`touchstart`, `touchend` and `touchcancel`. An `onfocusin` expando never fires; `onfocus` does.

| prop | was | is |
|---|---|---|
| `isFocused` | `focusin`, `focusout` | `focus`, `blur` |
| `isTouched` | `touchstart`, `touchend`, `touchcancel` | `pointerdown`, `pointerup`, `pointercancel`, with `pointerType === 'touch'` on the way in |

`isHovered` and `isClicked` are unchanged.

## What this costs

`isFocused` is now the element's own focus rather than focus anywhere inside it. A block that
wants focus-within asks the theme for `:focus-within`, which is a selector the theme already
supports and costs no script at all.

`isTouched` reads the pointer type rather than the event name. A host with pointer events but no
pointer type reports no touch; every host in the support table has both.

A handler is a property, so it dies with its element rather than being taken off it. A caller who
hands in an `element` and keeps using it after the component unmounts keeps the handler property
on it. Nothing in this package reuses an element that way, and the old behaviour was not free: it
was the reason a server-rendered page was dead.

## What is true now

Measured the same way, after the change:

```
after the disabled cell flipped, class = aw1
after a hover,                   class = aw2
after leaving,                   class = aw0
themed style before: "width: 10px;"   after: "width: 30px;"
icon class after the theme cell moved: aw0 -> aw1
```

A hydrated page is a live page: the handlers, the state cells, the theme segments and an inline
style all reach the nodes the server sent.

A hydration still does not report a theme mismatch, which is what the README already said: a
reactive attribute the fresh element has not written yet is tolerated at pairing time, and that is
what lets the class arrive a moment later. If the client's theme registry disagrees with the
server's, the client's answer wins quietly.

## What would reverse this

`dom` replaying `addEventListener` calls onto the node it adopted. Then `ui` could go back to
listeners and keep `focusin` and `touchstart` for the two state props. That is a surface change in
`dom`.

## Evidence

`packages/ui/tests/h.test.ts`, `a themed element with a handler and a state cell still works after
a hydration`, in the light tree: the click, the state cell, the class the cell drives, and a theme
cell. `packages/ui/tests/browser.test.ts`, `a hydrated page is live: a real click, a real
keystroke, a real focus and a real hover`, which hydrates server markup in Chromium, then clicks,
types, focuses and hovers for real, and reads the hovered tint off the button the server sent. The
value, `checked` and text tests in `packages/ui/tests/controls.test.ts` dispatch on the server's
node and assert the cell moved. The suite pins each of these: going back to `addEventListener` for
the click path, dropping the fan-out to the caller's own `$onclick`, `isFocused` back on `focusin`,
`isTouched` ignoring the pointer type, and the class back on `setAttribute`. The hydration tests
alone pin the last one.
