# 223: The listbox behaviour, the seventh internal one

Extends design 129: there are seven shared behaviours now, not four (`field`, `dismiss`, `dialog`,
`tooltip-trigger`, `tablist`, `drag` and this one). Amended: `role` also says where the focus and
the active id live, below.

## Decision

`packages/ui/src/listbox.ts` holds the keyboard and focus map of a popup list of options, written
once. `listBox(element, options)` takes the element the keys arrive on, returns the teardown, and
is not exported, which is the shape the other five behaviours have (design 129).

```ts
listBox(button, {
	list: () => panel,          // the element holding the options, read on every event
	role: 'option',             // or 'menuitem'
	open: () => open.get(),
	active,                     // a cell holding the id of the option the keyboard is on
	onOpen: (event) => open.set(true),
	onClose: (reason, event) => open.set(false),
	onPick: (item, event) => choose(item, event),
});
```

It knows nothing about what an option means. It reads the options out of the list element by their
role on every event, so a list that grows is followed with nothing else to call, and it hands the
picked element back rather than a value.

### The keys

| key | closed | open |
|---|---|---|
| ArrowDown | opens and lands on the first option | one option down, wrapping |
| ArrowUp | opens and lands on the last option | one option up, wrapping |
| Home, End | nothing | the first and the last option |
| a printable character | opens and moves the type-ahead | moves the type-ahead |
| Enter, Space | opens | picks the active option |
| Escape | nothing | closes, reason `escape` |
| Tab | nothing | closes, reason `tab`, and the key is left alone so the focus moves on |

Every key the map uses is prevented except Tab, because the page scrolls under an arrow and jumps
under Home, and the person meant the list. Tab is the one key whose default is the point.

**The arrows wrap.** Down from the last option is the first one. The other keyboard map in this
package wraps too (design 203), and one package with two lists that disagree about the end of a
list is worse than either answer: a person who learns the tabs learns the menus. The case against
wrapping is a long list where a wrap looks like a jump to nowhere, and the lists this draws are a
select's options and a menu's actions, which are tens of rows at most. What would reverse it is a
list long enough to scroll a screenful, which is a `Combobox` and not this.

**Type-ahead is a buffer with a 700 millisecond life.** Each character is appended and the search
runs over the options' text, starting after the active option and wrapping, for the first one whose
text starts with the buffer. A pause longer than the buffer's life starts a new search, so `ne`
finds Nevada and, after the pause, `n` finds the first N again. A buffer of one character repeated
steps through the options starting with that character, which is what holding `s` on a list of
states does.

**Pointer hover sets the active option, and a click picks.** Both are read at the document, guarded
by whether the target is inside the list, which is where `dismiss.ts` already listens: the list
element is made when the popup opens, so a listener put on it at install time would be put on
nothing.

**The outside click is `dismiss.ts`.** The behaviour asks for its mousedown half with the trigger
and the list both counting as inside, and closes with reason `outside`. Escape is in the key map
above rather than `dismiss`'s Escape half, because the focus stays on the trigger while the list is
open and Escape therefore always arrives there.

### The active option, and why `aria-activedescendant`

**The focus does not move into the list.** It stays on the element that opened it, and that element
carries `aria-activedescendant` naming the option the keys are on. The alternative is the roving
`tabindex` of design 203: put `tabindex="0"` on the active option and focus it.

Roving is right for a strip of tabs because the tabs are in the document where the person is
looking. It is wrong here for two reasons this package can measure. The list is in the top layer,
rendered at the popup sink at the end of the document, so moving the focus into it moves the focus
across the whole document and back out again on close, and anything watching `focusout` on the
trigger's part of the page sees the person leave. And the trigger is a `<button role="combobox">`
that has to keep the focus for `aria-expanded` to be read as its own state; a select whose focus
is somewhere else while it is open is a control that announces itself twice.

The cost is that a host with no `aria-activedescendant` support announces nothing as the keys
move. Every host in the support set has had it for a decade, and the alternative costs the focus.

**Which option is active is one cell, written here and read by the component.** The component puts
it as `aria-activedescendant` on whichever element holds the focus (see the amendment below) and
puts an `active` segment on the row's class list, so the highlight and the announcement come from
one place and cannot disagree. The behaviour
settles the cell at the start of every event it handles: an id naming no option in the list is
replaced by the option carrying `aria-selected="true"`, or by the first option that can be landed
on. So a list that changed under the keyboard has an active option again from the next key.

**An option carrying `aria-disabled="true"` is stepped over** by the arrows and by the end keys,
and a click on one picks nothing. That is design 203's rule, for its reason: an option nobody may
choose is still something a screen reader should read out.

### Amended: `role` also says where the active id lives

The two paragraphs above are true of a `Select`. A `Menu` cannot follow them, because ARIA refuses
them there: `aria-activedescendant` is allowed on a `role="combobox"` and on a `role="menu"`, and
it is not allowed on the `role="button"` a menu opens from. Measured on the catalogue page with
axe-core: opening the menu and pressing ArrowDown raises `aria-allowed-attr`, critical, on the
anchor button. So `role` now carries a second thing, which is where the focus and the active id
go:

| `role` | who holds the focus while it is open | who carries `aria-activedescendant` |
|---|---|---|
| `option` | the trigger, a `role="combobox"` | the trigger |
| `menuitem` | the `role="menu"` element, on `tabindex="-1"` | the `role="menu"` element |

**Focus into the list, rather than a roving `tabindex` over the rows.** Both are allowed by the
ARIA menu-button pattern and both fix the violation. Moving the focus once keeps everything else in
this file as it is: one active cell, written here, read by the component for the attribute and for
the row's `active` segment, so the highlight and the announcement still cannot disagree. Roving
would make a menu's highlight come from where the focus is and a select's come from the cell, which
is two behaviours living in the file that exists so there is one. It also costs nothing on the
`aria-disabled` rule, because a row that is stepped over is never focused and never named.

The keys are therefore listened for on whichever of the two holds the focus. The trigger keeps its
own listener while a menu is open, because a popup is laid out hidden for the frame before the
solver has placed it and a hidden element cannot take the focus, so that frame would otherwise be
a frame of dead keys. The focus is asked for again on the next frame for the same reason.

The two arguments above against moving the focus still hold for a `Select`, which is why nothing
moves there: a combobox that loses the focus while it is open announces itself twice, and a
`focusout` watcher on the trigger's part of the page would see the person leave.

## Why

`Select` draws its own list, and a `Menu` opens one too. Two components with a list of options each
is two keyboard maps, and a keyboard map is the part of this that is easy to get subtly wrong and
impossible to notice by looking at the page. One file, tested once, is what design 129 already
decided for the four behaviours it named first.

`role` is a parameter, as it is on the tablist, because the ARIA menu pattern and the ARIA listbox
pattern want the same keys: arrows, Home, End, type-ahead, Enter and Space to act, Escape to close.
What differs between them is the role names and what an item does when it is picked, and both of
those are the component's. So `Menu` asks for `menuitem` and `Select` asks for `option`, and there
is one map under them.

## Evidence

`packages/ui/tests/internal.listbox.test.ts` drives it on a list built by hand in the light tree,
so what the tests say is what the behaviour does and not what a component asked it to do: the
arrows move and wrap, Home and End go to the ends, a disabled option is stepped over, type-ahead
finds by prefix and starts again after the buffer's life, Enter and Space pick the active option,
Escape and Tab close with their own reasons and only Tab leaves the key alone, hover sets the
active option, a click inside the list picks and a click outside it closes, the closed list opens
on the keys above, and the teardown removes every listener. For the amendment: a `menuitem` list
takes the focus and the keydown listener as it opens and gives both back as it closes, and an
`option` list does neither. `packages/ui/tests/menu.test.ts` asserts that exactly one element on the
page names the active row and that it is the menu, and `recipes/ui/main.ts` opens the catalogue's
menu from the keyboard as well as from a click and runs axe over both.

`internal.listbox.test.ts` pins the arrow wrap, the type-ahead, Escape in the map, and the active
id being written.

## What this costs

A seventh behaviour file, and a third document-level listener pair while a list is open. The
listeners are installed for the life of the component rather than for the life of one opening,
which is what `dismiss` already does and is one registration per menu on the page rather than one
per open.

A component that wants the map on something of its own writes it itself, which is design 129's
price and is unchanged.

## What would reverse this

A list long enough that the focus has to move into it for a screen reader to page through it,
which is a virtualised `Combobox` and is not this.
