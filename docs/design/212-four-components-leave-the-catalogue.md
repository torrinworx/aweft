# 212: Four components leave

Amends designs 199 (`Kbd`), 200 (`ButtonGroup`) and 202 (`Accordion`, `ToggleGroup`).

## Decision

**`Kbd`, `Accordion`, `ToggleGroup` and `ButtonGroup` go**, with their source files, their theme
entries, their catalogue examples, their tests and their README rows.

| gone | what it was | the entries that go with it |
|---|---|---|
| `Kbd` | a `<kbd>` on `kbd` | `kbd` |
| `Accordion` | a `<div>` of `DropDown`s sharing one `name` | `accordion`, `accordion_item` |
| `ToggleGroup` | a row of radios or checkboxes drawn as buttons | `togglegroup`, `togglegroup_item` and its four modifiers |
| `ButtonGroup` | a `<div role="group">` of buttons with the inner corners off | `buttongroup`, `buttongroup_vertical` |

**`DropDown` stays.** It is what an `Accordion` was built out of, pages reach for one, and the
catalogue's own sections are drop-downs.

**`Tabs`, `Tab`, `TabPanel` and the tablist behaviour stay** (design 203). Pages reach for `Tabs`,
and the behaviour is the reusable keyboard map the later menus take.

## Why

The measurement behind it: outside the catalogue nothing in this repo used any of the seventeen
components design 193 added, and no page written with the package reached for these four at all.
Three of the four are also a second way to do something the package already does: an accordion is
drop-downs a page can write, a toggle group is radios with a theme on them, and a button group is
a row with the inner corners off.

A surface that ships what nobody reaches for costs a reader's attention on every pass, and each of
these four carries entries, an example, a test file and a README row that go stale together.

## Evidence

`packages/ui/surface.txt` loses eight names, four components and four prop types.

`packages/ui/tests/look.test.ts` no longer compiles the nine entries and `checkTheme` over
`defaults.ts` still reports nothing, which is what says no other entry reached one of them through
`extends`.

`recipes/ui/main.ts` loses the assertions for the four and keeps every other one; the catalogue has
four fewer sections.

`npm run theme` regenerates `packages/ui/tokens.txt`, which is where a name that only these four
used shows up as removed.

## What this costs

A page that imported one of the four no longer compiles. There are none in this repo outside the
catalogue and the tests.

An accordion is now something a page writes: a run of `DropDown`s given the same `name`, which is
the platform's own one-open behaviour and was all the component did. The README says so where the
component's row was.

## What would reverse this

An application asking for one of them by name. `ToggleGroup` is the likeliest, because a segmented
control is a look a radio group does not have on its own; it would come back as a component over
the same native inputs rather than as a different design.
