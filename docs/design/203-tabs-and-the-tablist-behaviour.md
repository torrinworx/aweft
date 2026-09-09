# 203: Tabs, and the tablist behaviour

Amended: what happens when the value names no tab.

## Decision

Three exports and one internal behaviour. `Tabs` is the one component here that brings a
keyboard map of its own, and the map is a file rather than a method so a menu can take it later.

### The behaviour: `packages/ui/src/tablist.ts`

`tabList(element, { role, onSelect })`, called with the element carrying `role="tablist"` and a
callback for "this one is chosen now", returning the teardown. That is the shape the other four
behaviours have (design 129), and like them it is not exported.

What it does:

- **The roving tabindex.** A strip of tabs is one stop in the Tab order, not one per tab. The tab
  showing carries `tabindex="0"` and every other carries `-1`, so Tab lands on the tab showing and
  the next Tab leaves the strip for the panel.
- **The keys.** Right and Left move one tab and wrap at each end; Down and Up do instead when the
  strip says `aria-orientation="vertical"`; Home and End go to the ends. A key the map does not
  know is left for the page, and the ones it does know are prevented so the page does not scroll
  under them.
- **A disabled tab is stepped over.** `aria-disabled="true"` is what says so, not the element's own
  `disabled`: a tab nobody may choose is still something a screen reader should read out, and a
  disabled `<button>` is not read out. A click on one does nothing either.
- **Arriving chooses.** Every move focuses the tab it landed on and reports it, which is automatic
  activation: holding Right shows each panel in turn, which costs the fewest keystrokes. The other
  pattern, where Enter or Space confirms, costs a second press on every move
  and pays for it only where showing a panel is expensive.

**Which tab is chosen is read off `aria-selected`, and the component writes that.** So the value
cell stays the one source of truth and the behaviour never holds a second opinion about it. The
component writes the starting `tabindex` too, from the same cell, which is what puts the zero in a
server's markup; the behaviour writes it again as it moves. The two never disagree because both
read the same cell.

**The tabs are read again on every event.** A strip that grows a tab is followed with nothing else
to call, which is what a `tabs` list held in a cell needs.

**`role` is the parameter.** The key map and the roving index are the reusable half; `tab` is only
the default. A menu asking for `menuitem` gets the same file (menus come later, so
nothing calls it that way yet).

### The components

| export | the element | its own props |
|---|---|---|
| `Tabs` | a `<div>` on `tabs` holding a `<div role="tablist">` on `tabs_list` and the panels | `value`, `tabs`, `orientation`, `type`, `size`, `label`, `onChange`, `element`, `theme` |
| `Tab` | a `<button type="button" role="tab">` on `tab` | `value`, `label`, `disabled`, `element`, `theme` |
| `TabPanel` | a `<div role="tabpanel" tabindex="0">` on `tabs_panel` | `value`, `element`, `theme` |

**A `Tab` reaches its group through a slot on the mount context**, which is how `Field` reaches the
controls under it (design 196) and what `withSlot` is for. Not `groupFor` (design 202): that mints
one name per value cell and hands back a string, and a tab needs four things from its group, the
ids, whether it is showing, the variant and the height. A `Tab` or a `TabPanel` with no `Tabs`
above it is a loud assert naming what to write instead.

**Ids come from the render's counter**, one pair per value, minted on first ask and then kept
(design 109). The tab is `<id>-tab` and the panel is `<id>-panel`, and each names the other with
`aria-controls` and `aria-labelledby`, so a server render and the hydration that adopts it agree. A
value already on the page keeps the ids it was given when the list grows.

**Every panel stays mounted and the ones not showing carry `hidden`.** Coming back to a panel finds
it as it was left, which is what a form half filled in inside one needs. A caller who wants a panel
built again wraps its contents in a `Shown`, which is one component they already have rather than a
prop on this one.

**With no `value` the component keeps its own cell and starts on the first tab.** The first `Tab`
to mount that is not disabled claims it. A cell the caller passed holding nothing is left holding
nothing: choosing for them would be a write they did not ask for.

**The tabs and the panels arrive in two marks.** A tab goes inside the strip and its panel goes
outside it, and a component may not read another component's props to tell them apart (design 202),
so a caller writing them out says which is which with `<mark.tabs>` and `<mark.panels>`. `categories`
is the mechanism this package already has for a component that takes more than one slot of children,
and its assert names both slots. A bare child is refused rather than guessed at: a `Tab` mounted
outside a `role="tablist"` is an accessibility bug that renders perfectly. The `tabs` prop is the
short way and takes `{ value, label, disabled, content }`.

### The entries

`tabs`, `tabs_vertical`, `tabs_list`, `tabs_list_vertical`, `tabs_list_line`, `tabs_panel`, `tab`,
`tab_sm`, `tab_lg`, `tab_selected`, `tab_line` and `tab_line_selected`. Every value is a role or a
size and nothing is written where it stands (design 119). A tab is `$control` tall, `$controlSm`
and `$controlLg` under the size axis's one segment (design 194). No segment of any of them names an
entry, which is design 193's rule.

**Three of those are entries a plainer list would not have.**
`tabs_vertical` exists because a strip standing on its side has to stand beside its panel: without
it the panel sits under a column of tabs at the full width, which is a stack of headings and not a
set of tabs. `tabs_list_line` exists because the filled strip is the list's own box, so the type's
second look belongs to the list entry; a `tabs_line` on the root would have been an empty
entry. `tab_disabled` does not exist: the theme's one `disabled` rule already dims and
takes the pointer away, and `controlStates` already puts that segment in the class list.

**The lift is taken off in `tab_line_selected`, not in `tab_line`.** A chain is ordered by how far
along the class list each entry matched, not by the order the entries are written in: `['tab',
'line', 'selected']` matches `tab_line` at the second segment and `tab_selected` at the third, so
`tab_selected` is emitted last of the two and its fill wins. Measured before the
declarations moved: an underlined tab was a raised one as well.

## Why

`Tabs` is the one component here that brings a keyboard map. The map is a file of its own for the
reason design 129 gives for the other four: a behaviour is not a component, it has nothing to
render, and it is testable in one place instead of once per component that uses it. Writing it
against a role rather than against tabs costs one parameter and is what lets a later menu take it
without a second copy of the roving index.

Automatic activation is the platform's own habit for tabs. The panels here are already mounted, so
moving through them is showing an element that exists rather than fetching one.

## Evidence

`packages/ui/tests/internal.tablist.test.ts`, on a strip built by hand in the light tree: the
roving index after installing and after each key, wrap-around both ways, Home and End, a disabled
tab stepped over by an arrow and by an end key, the vertical key map (and a sideways arrow left for
the page), the element the callback is handed, a click choosing and a disabled click refusing, a
tab added after it was installed, and both listeners gone after the teardown. The suite pins the
disabled skip in `step` and the wrap-around.

`packages/ui/tests/tabs.test.ts`: the ids and the two ARIA links, the first tab showing by default,
`hidden` on the other panels while they keep their contents, the value cell written from outside
and written by a click, `onChange` firing only for the second, the `vertical` and `line` segments
on both boxes, a `tabs` list growing a tab through a cell without moving the ids of the tabs already
there, tabs and panels written out in the two marks landing in the right two places, and the three
refusals. Three of those fail if `hidden` is never written.

`packages/ui/tests/look.test.ts`: every new entry from names only, both types and all three heights,
and `checkTheme` over `defaults.ts` reporting nothing.

`packages/ui/tests/browser.test.ts`, measured in Chromium: a real Tab lands on the tab showing and
the next Tab lands in its panel rather than on the next tab; ArrowRight moves the focus, the
selection and the roving zero together; the wrap steps over the disabled last tab; End and Home; a
hidden panel is not laid out; and the two types measured, the default's `$muted` strip with the tab
showing lifted onto `$background`, and the line type's 3px `$accent` rail with no fill anywhere.

`recipes/ui/main.ts` drives the catalogue: the strip's three tabs and three panels with two hidden,
one tab stop, every `aria-controls` naming an element that is really there, a real ArrowRight moving
the selection, End stepping over the disabled tab, and the line type's rail. axe reports no WCAG 2.2
AA violation on the page with both modes showing.

## What this costs

A caller who writes the tabs and the panels out by hand writes two marks. That is one more thing
to learn than a component that sorted its children by what they are, and it is what keeps this
component from reading another component's props.

The `tabindex` on a tab is written twice, by the component from the cell and by the behaviour as
it moves. Both read the same cell, so they cannot disagree; what it buys is a strip that is right
in a server's markup and a behaviour that can be tested with no component around it.

`Tab` and `TabPanel` are exports that mean nothing on their own. They are named in the catalogue's
own list of components shown inside another example, beside `FieldGroup` and `FieldSet`.

## Amended

**When the value names no tab in the `tabs` list, and it named one before, the component selects the
first tab anyone may choose.** Taking the tab that was showing out of the list left the value naming
nothing: every tab read `tabindex="-1"`, so the strip was not a stop in the Tab order at all, and
every panel carried `hidden`, so the page showed nothing. Measured through both an
owned cell and a caller's: `tabs=1 tabstops=0 panelsShowing=0`. Removing a tab is the ordinary thing
a list held in a cell does.

**The component writes the cell and calls `onChange`, rather than drawing a tab the cell disagrees
with.** This note already says the value cell is the one source of truth and that nothing here
holds a second opinion about it; a component showing the first tab while the cell holds a value that
went away is exactly that second opinion, and a caller reading the cell back would load the wrong
panel's data. The event argument is null, because nobody pressed anything.

**Which rule applies when.** A cell holding a value that was never on a tab is left alone, which is
this note's paragraph about a caller's cell holding nothing and is unchanged: nothing shows, and
choosing for them would still be a write they did not ask for. It is the tab going away that the
component steps in for, and the two are told apart by whether a tab was ever built for that value.
An owned cell is unaffected either way: it starts on the first tab as it always did, and now on the
first tab that is not disabled.

**With every tab disabled, nothing is chosen.** Selecting a tab nobody may choose would say a panel
is showing that nobody could have asked for. So no tab says `aria-selected="true"` and no panel is
shown, and the first tab carries `tabindex="0"` so the strip is still one stop in the Tab order and a
keyboard can reach it if a tab is enabled later. Every tab still carries `aria-selected="false"`:
the attribute is what the tab pattern asks for on a tab that is not showing, and taking it off would
be a worse answer than the one this fixes.

**Tabs written out in the two marks are not read this way.** The fallback reads the `tabs` list,
which is the only set of tabs this component owns; a strip written out by hand is the caller's own
markup, and taking a tab out of it is a change they made to their own tree.

**A `TabPanel` whose `value` no `Tab` has is refused**, with the same shape as the orphan assert. Its
`aria-labelledby` names an id that is not on the page and its tab's `aria-controls` names nothing,
which no browser reports. The tabs are built before the panels, so a panel can ask; the check is
whether a tab was ever built for that value, so a `tabs` list that grows and shrinks does not fire
it.

**The behaviour settles the roving zero at the start of every event, not only at install.** The
element carrying the zero can be taken out of the strip between two events, and then nothing in the
strip is in the Tab order. This note already says the tabs are read again on every event; the zero
is settled again on every event for the same reason.

`packages/ui/tests/tabs.test.ts`: the selected tab removed from a `tabs` cell, through an owned cell
and through the caller's, with the cell and `onChange` checked; the tab that takes over never a
disabled one; every tab disabled; and a caller's cell of null left holding null.
`packages/ui/tests/internal.tablist.test.ts`: the item holding the zero taken out of the strip, and
the stop back on the next event.

## What would reverse this

An application that needs a tab to confirm before its panel is shown, because showing one is
expensive. Then activation becomes a prop and this note's second half is reopened. Nothing in the
default theme or on the wire changes with it.
