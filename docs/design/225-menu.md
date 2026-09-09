# 225: `Menu`, a button and the list of actions it opens

Amended: the focus moves onto the `role="menu"` element and the active row is named from there, an
entry with a heading is a group whether or not it has items, and a `Menu` needs no `PopupContext`
above it.

## Decision

`Menu` is a `Button` and a popup list of actions on the listbox behaviour of design 223.

```tsx
<Menu label="Quick Actions" items={[{
	heading: 'Conversation',
	items: [
		{ label: 'Mute Conversation', onSelect: mute },
		{ label: 'Mark as Read', onSelect: read },
		{ label: 'Block User', onSelect: block },
		{ label: 'Delete Conversation', type: 'danger', onSelect: remove },
	],
}]} />
```

**Props.** `label`, `icon`, `type`, `size` and `disabled` are the anchor button's, and mean what
they mean on `Button`. `items` is the actions. `open` is the open state, a cell or absent, like
every state prop. `locations` is the placements to try, defaulting to below the anchor and then
above it. `element` hands in the button, and `theme` appends segments to the list's own.

**An item is `{ label, icon?, type?, onSelect }`.** `type: 'danger'` puts the `danger` segment in
the row's class list and `menu_item_danger` draws it in `$danger`. `onSelect` is called with the
event that chose it, after the menu has closed.

**A group is `{ heading, items }`**, and draws a small muted heading over its own rows. A list may
mix the two, so a menu with one heading over four actions is one entry in `items`. **A heading is
what makes an entry a group**, whether or not it has any items yet: `{ heading: 'Empty' }` draws
the heading and no rows. It used to be read as an action, so a group whose items had not arrived
became a menuitem with nothing written on it, which is a row a person can land on and choose and
that does nothing at all.

**The anchor is a `Button` this component builds, and `children` are that button's contents.** A
caller who wants their own trigger writes it inside the tags rather than instead of them, or hands
the element in with `element`. The alternative was to take the children as the anchor whole and
write `aria-haspopup`, `aria-expanded`, `aria-controls` and `aria-activedescendant` onto nodes this
component does not own, the way `Tooltip` writes `aria-describedby` (design 135). Four attributes,
three of which change while the menu is open, is four effects on somebody else's element and a
static render that carries none of them. Owning the button puts all four in the markup, reactive,
on the first render, and it is one path rather than two.

**The roles are the ARIA menu pattern**: `role="menu"` on the list, `role="menuitem"` on the rows,
`role="group"` on a group with `aria-labelledby` naming its heading, and the list named by the
button. The key map is the listbox behaviour asked for `role="menuitem"`, which is design 223's
parameter and its reason: the menu pattern and the listbox pattern want the same keys, and what
differs is the role names and what picking does. Picking here closes the menu and calls
`onSelect`; picking in a `Select` writes a cell.

**The focus moves onto the `role="menu"` element as the menu opens**, which carries `tabindex="-1"`
for it, and `aria-activedescendant` names the row the keys are on from there. Amended: an earlier
shape put it on the anchor, and ARIA does not allow it on a `role="button"`. Measured on the
catalogue with axe-core, after opening the menu and pressing ArrowDown: `aria-allowed-attr`,
critical, on the anchor. The two shapes ARIA does allow are this one and a roving `tabindex` over
the rows; design 223's amendment says why this one, and it is that shape for both components with
one difference, which is which element ends up holding the focus.

**Escape and an outside click close it, and the focus goes back to the anchor.** Escape and the
outside click are the behaviour's; returning the focus is this component's, and it happens for
Escape and for a pick, not for Tab, where the person asked to move on.

**The look is a raised surface.** `menu` extends the `listbox` entry, so it is the popup's fill, its
border and its corner; a row is `$control` tall with a `$radiusSm` corner; a heading is `$textXs`
in `$mutedForeground`; the row the keyboard or the pointer is on takes the `$muted` fill. The
entries are `menu`, `menu_item`, `menu_item_danger`, `menu_heading` and `menu_group`, which are
parts and modifiers per design 193, plus `menu_item_sm` and `menu_item_lg` for the size axis of
design 194.

## Why

An application wants a menu that pops up from a button, with "Quick Actions" over Mute
Conversation, Mark as Read, Block User, and Delete Conversation in the danger colour. Nothing in
the package drew one. `DropDown` is a `<details>` in the page's flow (design 136) and is a
different thing: it pushes the page down rather than floating over it, and it has no keyboard map
of its own because the element brings one.

It is built beside the listbox behaviour rather than after it, because a behaviour with one caller
is a behaviour whose parameters are guesses. The menu is what proves `role` was worth being a
parameter.

## Evidence

`packages/ui/tests/menu.test.ts`, in the light tree: the list is a `role="menu"` of `role="menuitem"`
rows named by the button; a group renders its heading and names it with `aria-labelledby`; a danger
item puts `danger` in its class list; the arrows and Enter reach `onSelect` with the item that was
picked; Escape closes and the anchor is asked for the focus; and an `open` cell drives it both ways.

`packages/ui/tests/browser.test.ts`, measured in Chromium: a menu anchored near the bottom of the
viewport is placed above its anchor rather than below it, and the danger row computes `$danger`.
axe-core finds no violation with a menu open.

`recipes/ui/examples/menu.example.tsx` is that menu, and `recipes/ui/main.ts` opens it on the
catalogue and reads the danger row's colour there.

For the amendments: `menu.test.ts` asserts that after an open and an ArrowDown exactly one element
names the active row and it is the menu, that the anchor names none, and that opening asked the
menu for the focus; that `[{ heading: 'Empty' }, { label: 'only' }]` draws one heading and one row
and no blank one; and that the open cell is already false inside `onSelect`, which is the order
the props section states and nothing pinned before. `recipes/ui/main.ts` opens the catalogue's
menu by click and by ArrowDown and runs axe over both, and the axe run reports the violation on
the shape before the amendment. `browser.test.ts` opens a `Menu` inside a `Modal` through a stage
and asserts that `document.elementFromPoint` at the middle of a row answers with the row and that
a real click there runs that row's `onSelect`.

## What this costs

One more component, five theme entries and two size modifiers.

A `Menu` needs no `PopupContext` above it: a popup's sink is the nearest `<dialog>` above it, then
a `PopupContext`, then the element the page was mounted into (design 113, amended). A `Menu`
inside a `Modal` therefore draws its list inside that dialog, which is what makes its rows
clickable at all.

A caller whose trigger cannot be a `<button>` at all, an avatar that opens a menu say, puts the
avatar inside the button rather than instead of it. That is one more element in their markup, and
it is the element the keyboard and the ARIA hang off.

## What would reverse this

A trigger that genuinely cannot be a button, such as a table row that opens a context menu on a
right click. That is a second anchor mode with a note of its own, and the attributes would then be
written onto the caller's node the way `Tooltip` writes its own.
