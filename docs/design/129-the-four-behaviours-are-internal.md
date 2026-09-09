# 129: The seven shared behaviours are internal functions, tested once

Amended: the file is `tooltip-trigger.ts`, renamed so the component `Tooltip` can be `tooltip.tsx`.
Extended: `drag.ts` (design 221) and `listbox.ts` (design 223) join `tablist.ts` (design 203) on
these same terms, internal and tested once, so the rule covers seven files now rather than four.
`drag.ts` hands back handlers rather than installing listeners, because the element it works on is
one a component renders and a hydration replaces.

## Decision

Seven jobs are shared by more than one component, and each is one internal function in its own
file. None of the seven is exported from `@aweftjs/ui`. Four are decided here; the last three
arrived with the designs named beside them and are on these same terms.

| file | what it does | who calls it |
|---|---|---|
| `field.ts` | mints the label, description and error ids off the render's `ids`, and hands back the `id`, `aria-labelledby`, `aria-describedby` and `aria-invalid` a control writes. `aria-invalid` follows the `error` cell | `TextField`, `TextArea`, `Select`, `Checkbox`, `Radio`, `Toggle`, `Slider` |
| `dismiss.ts` | closes something on a mousedown outside a set of nodes, and on Escape when the caller asks for Escape | `Popup`, the tooltip trigger, and the listbox behaviour |
| `dialog.ts` | opens a native `<dialog>` with `showModal`, marks the page's other top-level children `inert`, returns focus to the element that was focused when it opened, and closes on the element's own `cancel` event | `Modal`, and its own test directly |
| `tooltip-trigger.ts` | shows on hover and on focus after a delay, hides on leave, blur and Escape, and asks for the top layer with `popover="hint"` where the host has it | `Tooltip`, and its own test directly |
| `tablist.ts` (design 203) | the keys of a strip of tabs, on a roving `tabindex`: the arrows move and wrap, Home and End go to the ends, and a disabled tab is stepped over | `Tabs` |
| `drag.ts` (design 221) | turns a pointer drag over a box into a fraction of that box, and hands back handlers rather than installing listeners, because a hydration replaces the element they go on | `Slider`, `ColorPicker` |
| `listbox.ts` (design 223) | the keys and the focus map of a popup list of options, with `role` saying both which elements are the options and where the focus and the active id live | `Select`, `Menu` |

`ids.next(prefix)` counts from zero per render (design 109), so the ids a server mints and the ids
the hydration mints are the same ids, and a `aria-labelledby` written on the server still points at
something after the page comes alive.

`Popup` now calls `dismiss` rather than keeping its own copy of the outside-click walk. It asks for
the mousedown half only, so a `Popup` behaves exactly as it did with its own copy: Escape is an
option the caller turns on, and nothing in this package turns it on for `Popup`.

## Why

The component catalogue holds what an application needs and nothing beside it. A behaviour layer
is not a component, so exporting one would grow the surface past that, and each of the seven is a
thing an application gets for free by using the component rather than a thing it assembles for
itself.

Keeping them as functions rather than as components: five of the seven attach listeners to nodes a
component already has, and have nothing to render. A component that renders nothing is a mounter
whose only job is a side effect, which is harder to test than a function and harder to read.

Tested once, not once per component: `internal.field.test.ts`, `internal.dismiss.test.ts`,
`internal.dialog.test.ts`, `internal.tooltip.test.ts`, `internal.tablist.test.ts`,
`internal.drag.test.ts` and `internal.listbox.test.ts` cover the behaviour, and each component's own
test asserts that it wired the behaviour up, not that the behaviour works. The white-box name is
what the test policy in `AGENTS.md` requires of a test that imports something the package does not
export.

## Evidence

Each behaviour's own suite pins a removed listener, a flipped condition and a skipped cleanup. A
behaviour tested through seven components would take seven runs to say the same thing.

## What this costs

An application that wants Escape-and-outside-click on something of its own writes it itself. That
is the price of a catalogue that holds components and nothing beside them, and the day something
asks for it, `dismiss` is one export away.

## What would reverse this

An application needing one of the seven on its own element. Then that one is exported and the
other six stay internal.
