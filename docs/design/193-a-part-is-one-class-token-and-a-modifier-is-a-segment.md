# 193: A part is one class token, a modifier is a segment

Amended: a segment is never an entry name, and the gate refuses one.

## Decision

**A class token that holds `_` names exactly the entry of that name.** `theme: 'filedrop_entry'`
reaches the `filedrop_entry` entry, and whatever that entry `extends`, and nothing else. It no
longer also reaches the bare `filedrop`.

**A class token with no `_` is a segment, matched as it always was.** `theme: ['button', 'quiet',
'sm']` reaches `button`, `button_quiet` and `button_sm`, gaps allowed and order enforced.

The two mix, which is the point:

```ts
theme: ['filedrop_entry', status]      // filedrop_entry, and filedrop_entry_error while status is
                                       // 'error'
theme: ['card_title', 'card']          // both, because a caller who wants both says both
theme: ['filedrop', 'entry']           // still reaches filedrop and filedrop_entry, as before
```

`matchAt` in `sheet.ts` is where this lives. A part token consumes that whole run of the entry's
segments or none of it; a plain token consumes one. Every state of the walk is carried rather than
one position, because a plain token that took a segment early can leave a part with nothing to
match, and both readings have to be tried.

**The rule for which an entry is which.** A part is a different element from its component. A
modifier is a state or a variant of the same element. So `dialog_head` is a part, because the head
is a `<div>` inside the dialog; `button_quiet` is a modifier, because it is the same button.

**A segment is never an entry name (amended).** A key's segments after the first may not
name a top-level entry that lays an element out, because the class list that reaches the key reaches
that entry too and compiles it onto the same element. `button_icon` was the square button and the
bare `icon` segment brought the `icon` entry's `display: inline-block; width: 1em; height: 1em` with
it, which took the button's flex centring away: measured in Chromium, the svg inside
the 36px square sat 12.25px from the top and 9.75px from the bottom. It is `button_square` now, and
`select_icon` and `filedrop_input` are `select_chevron` and `filedrop_picker` for the same reason.

An entry that only paints is exempt, and that is what the check reads: `hovered`, `pressed` and
`disabled` write no box declaration, so composing them onto anything is safe and is the whole point
of them. `disclosure_summary_disabled` rides on `disabled` deliberately. `checkTheme` in
`packages/testing/src/theme.ts` refuses the rest, one file at a time, so two pages of one tree are
not read as one theme.

The entries this changes how you reach:

| part | reached as |
|---|---|
| `field_label`, `field_hint`, `field_error` | `theme: ['field_label']` |
| `dialog_head`, `dialog_body` | `theme: ['dialog_head']` |
| `filedrop_prompt`, `filedrop_picker`, `filedrop_list`, `filedrop_entry` | `theme: ['filedrop_entry', status]` |
| `colorpicker_swatch`, `colorpicker_track` | `theme: ['colorpicker_track', 'hue']` |
| `disclosure_summary` | `theme: ['button', type, 'disclosure_summary', 'left']` |
| `select_wrap`, `select_chevron` | `theme: ['select_wrap']` |

`colorpicker_hue` is now `colorpicker_track_hue`: it is a modifier of the track, and the class list
says the track as one token, so an entry spelled `colorpicker_hue` reaches nothing.

The parts table above is what those two renames change: `filedrop_input` is `filedrop_picker` and
`select_icon` is `select_chevron`.

The modifiers stay segments and none of them move: `button_quiet`, `button_danger`,
`button_round`, `button_inline`, `button_sm`, `input_invalid`, `card_tight`, `field_inline`,
`filedrop_dragging`, `filedrop_entry_error`, `disclosure_summary_left`,
`disclosure_summary_disabled`, `dot_second`, `dot_third`, every `text_*`, every `row_*` and every
`column_*`.

**Design 190's rename is undone.** An earlier shape spelled the field's three parts `fieldlabel`,
`fieldhint` and `fielderror`, one segment each, to keep the label out of the field's column. That
worked and read badly: a reader could not tell that `fieldlabel` belonged to `field`, and the same
workaround was owed to `dialog_head`, `filedrop_entry`, `colorpicker_swatch` and
`disclosure_summary`, none of which had had it. They are `field_label`, `field_hint` and
`field_error` again. Design 192's text on this is superseded by this note.

## Why

The matching rule made every part of a component wear the component's own box. Measured in
Chromium before this change:

- A row in a file drop's listing wore a 1px dashed border and 16px of padding, which are the drop
  zone's.
- A dialog's heading row wore 16px of padding, a 1px solid border, `max-width: 512px` and the
  surface fill, which are the dialog's.
- A colour picker's swatch was a flex row with a 12px gap, which is the picker's layout.
- A file drop's prompt wore the zone's padding and dashed border.

Every one of those is the same bug and none of them was noticed, because a part is usually inside
its component and the second border reads as a rendering artefact rather than as a rule. The other
way out was to keep renaming parts until none of them carried its component's name, which is what
that earlier shape did for one of the five and which loses the naming that says what a part
belongs to.

The engine change is where the fix belongs because the class list is what says what an element is.
An element themed `filedrop_entry` is a row in a listing, not a drop zone that happens to be
inside one. Saying so in one token is both what a caller means and what the entry name already
said.

Backward compatible on purpose: a class list of plain segments matches exactly as it did, so every
call site that had not been renamed still works and the change is additive. The whole rule is one
edit to `matchAt` rather than a sweep across call sites.

## Evidence

`packages/ui/tests/internal.theme.test.ts`: "a class token holding an underscore names that entry
and not the one it starts with", "a part token followed by a segment reaches the modifier of the
part", "a plain segment list matches exactly as it did", and "a part token and its component in
one list reach both".

`packages/ui/tests/look.test.ts`, "a part named as one class token wears its own rules and none of
its component's": the compiled rules for `filedrop_entry` carry no dashed border and no padding
and still carry the row's own `display: flex; align-items: center; gap: 8px`; `dialog_head` carries
no width cap and no padding and still carries `justify-content: space-between`.

`packages/ui/tests/browser.test.ts`, "a part wears its own rules and none of the component it
belongs to", measured in Chromium after the change: the zone is still `1px dashed` with 16px of
padding, the row is `0px none` with `0px` of padding and an 8px gap, and the head and the body are
`0px none`, `0px` and `max-width: none`.

## What this costs

A theme entry name is now read one way inside a class list and another way as a key. `card_title`
as a key is two segments; `card_title` in a class list is one token naming that key. That is one
more rule for a reader of the engine, and it is the rule that makes the two spellings mean the
same thing.

An application that was relying on a part inheriting its component has to say both tokens. Nothing
outside this repo does, and inside it every case was the bug above.

The walk is a small table rather than a single index. It is bounded by the entry's segment count,
which is at most four in this package, times the class list, and it runs once per entry per chain
per render before the chain is cached.

## What would reverse this

A component whose part genuinely is its component, styled the same and laid out the same. There
is none: an element that wants both entries says both, which is one more token and is what the
last test above pins.
