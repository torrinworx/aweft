# 315: A saved colour mode

Builds on design 117 (the two modes are themes a page swaps at its root).

## Decision

`@aweftjs/ui` exports `savedMode(options?)`, a cell holding one of two themes, `light` and `dark`,
which default to the two this package ships. It is the value a page hands its root `Theme`.

- **It starts in `light`,** the mode a server renders, and moves to the visitor's mode on
  `restore()`: what they chose last, or `fallback` when they never chose. `fallback` is `'light'`,
  `'dark'` or `'system'`, which reads `prefers-color-scheme`, and is `'light'` unless set. A page
  that hydrates calls `restore()` once `attach` has taken the server's markup over. A page that
  mounts calls it before `mount`.
- **A set is the visitor's choice, and is saved** in `localStorage` under `key`, `'mode'` unless
  set, as `light` or `dark`. `restore()` saves nothing, so a visitor who never chose has nothing
  saved, and a later change of `fallback` reaches them.
- **It paints what no theme entry reaches.** On every value, from the first: the root element's
  `color-scheme` and `background-color`, from the mode's `$background`, and the `content` of the
  head's `<meta name="theme-color">`, which it adds when the head has none.
- Setting it to anything but its two themes is a loud assert, and so is a second one made on a page
  that has one, because both would paint the root. Where there is no `document`, a render on a
  server, it is a plain cell and paints and saves nothing. A storage that throws, as a private
  window's can, saves nothing and reads nothing saved.

## Why

Five applications write this in their page entry, each a little differently: a key of their own,
light or the system as the fallback, the root painted, and in one the bar a phone draws. Two of them
wrote the first visit's default into storage, so it later read as a choice, and one moved to a new
key to get away from that. The parts that differ are the options here. The part every copy has,
saving only a choice and painting the root, is the behaviour.

**Light until `restore()`,** because of when a page moves. A hydrated page that starts in the
visitor's dark mode rewrites the stylesheet the server sent, the one change design 257 allows, and
Chromium then drops every web font on the page until it has them again. Moving after the hydration
compiles the dark classes into a sheet of their own and drops nothing. A page that mounts has no
server sheet, and calling `restore()` first paints it in the visitor's mode at once. Three of the
five applications move after the hydration and two before, so the one moment is the application's.

## What this costs

One export. A page that hydrates is painted light by the server and moves on `restore()`, so a
visitor who chose dark sees light first. Hiding that is the page's HTML's job, an inline script in
its head, before any of this package runs. A page whose theme names its page colour something other
than `$background` gets no root background and no `theme-color`.

## Evidence

`packages/ui/tests/mode.test.ts`, over a page object of the test's own: light at first, `restore()`
reading a saved choice, the fallback in all three spellings, nothing saved by `restore()` and the
choice saved by a set, the root painted and the meta written and added, a storage that throws, a
third theme refused, and no document leaving it a cell. `packages/ui/tests/browser.test.ts` mounts a
page in Chromium, restores a saved dark, and reads the root's computed background and the meta.

## What would reverse this

An application that needs the mode to follow the system live, which would make `'system'` a
listener.
