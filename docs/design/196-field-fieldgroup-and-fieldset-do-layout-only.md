# 196: `Field`, `FieldGroup` and `FieldSet` do layout only

Reversed by design 209: the three components are withdrawn and the form layout is the theme
entries under them.

## Decision

Three components ship, in `packages/ui/src/field-layout.tsx`. They lay a form out and nothing
else. No control's label, description, error, id or ARIA moves, and `wireField` stays internal.

### `Field`

A `<div role="group">` on the `field` entry, holding whatever the caller put in it: a control that
labels itself, or a bare control and a `<label>` the caller wrote.

```tsx
<Field orientation="responsive">
  <label for="email" theme="field_label">Email</label>
  <TextField id="email" value={email} />
</Field>
```

`inline` and `responsive` lay out the field's own children, so they are for a bare control and the
`<label for>` the caller wrote beside it. A control that was given a `label` already lays that pair
out itself, and a `Field` around one is a column of one thing.

`orientation` is a value or a cell, and it is one of three:

| value | what it does |
|---|---|
| `column` (the default) | the label above, the control, then the notes |
| `inline` | the control beside its words, on the `field_inline` modifier that already existed |
| `responsive` | a column that turns inline from 28rem of its container's width, through a `_container_` block on the `field_responsive` modifier |

The container a `responsive` field measures is the nearest ancestor that declares one, which in
this package is `FieldGroup` and nothing else. With no group above it a `responsive` field is a
column at every width, because a container query with no container answers false. That is the safe
way for it to fail and it is said in the block comment and the README.

Props: `orientation`, `theme`, `element`, `children`, and anything else, which goes to the
element.

### `data-invalid`

`Field` carries `data-invalid` while a control inside it says it has an error, and drops the
attribute when the error clears.

The mechanism is the one this package already uses to carry a message the other way. `field.ts`
gains a third slot on the mount context, beside the two `Validate` puts there (design 138):
`Field` provides it, and `wireField` calls `mark(error)` with whatever the control was given.
`Field` holds a count of the controls that are saying something, watches each reported value, and
writes the attribute from the count. A control gets its error from its own `error` prop or, having
none, from a `Validate` above it, so both ways of saying a field is wrong reach the field the same
way and neither costs the control a line.

**The alternative was the field reading the ARIA already on its subtree**, with a `MutationObserver`
on `aria-invalid`. It needs no slot and it cleans up exactly, and it was not taken because it
answers only in a real browser: the light tree this package's suite runs in has no observer, so the
behaviour could be proved on a page and not in a test. A third option, a `:has([aria-invalid])`
rule in the `field` entry, needs no JavaScript at all, but it writes no attribute, and an attribute
is what an application's own stylesheet and its own tests can reach.

### What `data-invalid` reaches

The engine cannot write a rule from the `field` entry to a label inside it. A part's class is
generated per chain, so `field`'s rules cannot name `field_label`'s, and `_children_` only reaches a
direct child, which the label is not once a control has wrapped itself. The rule is therefore
written from the other end: `field_label` gains `_elem_[data-invalid]`, which emits
`[data-invalid] .awN { color: <$dangerSubtleForeground>; }`, so a label under a marked field takes the
colour its own error message already has.

That is the same role `field_error` uses, not `$danger`, so a label and the message under it are
one colour and the pair stays above the contrast target on `$background`.

### `FieldGroup`

A `<div>` on the `field_group` part: a column, `$space6` between fields, `width: 100%`, and
`container-type: inline-size`, which is what a `responsive` field measures. Props: `theme`,
`element`, `children`.

### `FieldSet`

A `<fieldset>` on the `field_set` part with a `legend` prop rendered as a `<legend>` on
`field_legend` (`$textSm`, weight 500, `$space2` under it). The entry is the group's column and
gaps plus `border: none; padding: 0; margin: 0; min-width: 0`, because a fieldset arrives from the
host with a border, three uneven paddings and a minimum width that stops it shrinking in a flex
column. Props: `legend`, `theme`, `element`, `children`, and anything else, which goes to the
element.

`disabled` goes through as an attribute and the host does the rest: a `<fieldset disabled>` disables
every control in it, natively, with no cell and no prop on any of them. **It does not dim them.**
The `disabled` segment in the default theme is a class `controlStates` writes from a control's own
`disabled` prop, and a fieldset disabling its descendants writes no class on any of them. So a
disabled fieldset's controls are dead to the keyboard and the mouse and still look live. Dimming
them from the fieldset would need a rule reaching every descendant, and the engine's `_children_`
reaches direct children only, which the controls are not. An application that wants the dimming
sets `disabled` on the controls as well.

### Naming

Parts are one class token and modifiers are segments (design 193). `field_group`, `field_set` and
`field_legend` are parts, because each is a different element from a field. `field_inline` and
`field_responsive` are modifiers of `field`, because each is the same `<div>` laid out another way.
An earlier spelling had the first three as `fieldgroup`, `fieldset` and `fieldset_legend`; these
are what design 193's rule gives instead.

## Why

Layout only: `Field` with an orientation (column, inline, responsive), `FieldGroup` for a form's
stack, `FieldSet` with a legend, and controls keeping `label`, `description` and `error`. The
alternative, `Field` owning the label and every control losing its own, was weighed and not taken.

The gap this fills is real and small. A control already lays its own three parts out; what nothing
laid out was the form around them, so a page wrote its own `display: flex; gap` every time, and a
checkbox beside its words was a different hand-written row on every page. Three components that do
that and nothing else cost a page three imports and take that decision off it, and because they
own no label they cannot disagree with a control about what a label is.

`role="group"` rather than nothing, because a field is a box of related things and that is what the
role says. It is not `role="none"` and it is not a `<fieldset>`: a fieldset carries a legend and a
disabling rule, which is what `FieldSet` is for, and putting one around every field would put a
group heading in the accessibility tree for every text box on the page.

## Evidence

`packages/ui/tests/field-layout.test.ts`: each of the three renders its element and its entry; an
`orientation` cell moves the class from `field_inline` to `field_responsive` while the field is on
the page; `FieldSet` renders its legend first, which is where the host needs it; `data-invalid`
appears when a control inside says it has an error and goes when the error clears; and a `Field`
holding no control at all renders one empty group.

`packages/ui/tests/look.test.ts`, "a form's layout is three entries and two modifiers": the
compiled rules for `field_group`, `field_set`, `field_legend`, `field_inline` and
`field_responsive`, and that nothing outside the container query turns a responsive field. "A label
under a marked field takes the colour its message already has": `field_label` emits
`[data-invalid] .awN { color: ... }` in the same role `field_error` uses.

`packages/ui/tests/browser.test.ts`, measured in Chromium:

- "an inline field puts the control beside its words on one line": `flex-direction` is `row`, the
  label's box and the control's overlap vertically, the row is 36px tall, which is `$control`, and
  the difference between their two middles is 0px.
- "a responsive field is a column in a narrow group and a row in a wide one": the same field, with
  nothing about it changed but the group's width, computes `flex-direction: column` at 20rem, `row`
  at 40rem, and `column` again back at 20rem. A second field on the same page with no group above
  it is wider than the 448px the query asks for and is still a column.
- "a fieldset's legend sits above its fields, and the box itself draws nothing": the legend's bottom
  is above the first field's top with at least `$space2` between them, `border-top` is `0px none`,
  `padding` is `0px`, `min-width` is `0px` and `flex-direction` is `column`.

`recipes/ui/examples/field.example.tsx` lays a form out with all three and `recipes/ui/main.ts`
reads the responsive field's direction at the catalogue's own pane width, with axe-core over the
page.

## What this costs

**A control that leaves a field while it is invalid leaves the field marked**, until the field
itself goes. `wireField` registers with the field and has no way to deregister: a control is called
with a `cleanup` it does not declare, and declaring one on all nine of them is nine signatures in
`surface.txt` for a case a field with one control in it cannot reach. The narrow case that gets it
wrong is a field whose control is swapped for another while the first one has an error. Reverse it
by giving `wireField` a cleanup, which is a mechanical change whenever the case turns out to matter.

**Two `<div>`s where a control labels itself.** A `Field` around a `TextField` with a label renders
the field's own `<div theme="field">` inside the `Field`'s. Both are columns with the same gap, so
the page looks right and there is one more element in it than there needs to be. Collapsing them
would mean the field owning the label, which is the shape this design turned down.

**`field_inline` and `field_responsive` carry the same five declarations twice.** The responsive
entry is a column that becomes the inline row inside a `_container_` query, and the query's body has
to restate every declaration `field_inline` makes rather than reaching for it: a directive body is a
block of declarations and there is no `extends` inside one, because `extends` is a key of an entry
and the query is not an entry. So an application redefining `field_inline` and expecting the
responsive field to follow is redefining half of it, and has to redefine the query too. Left as it
is: the alternative is a way for a directive body to name an entry, which is a theme grammar change
for five declarations.

**`28rem` is written where it stands**, in the `_container_` key. A directive's argument is not a
declaration, so `check-theme.ts` does not read it and no `$name` reaches it; the same is already
true of every `_media_` query in the package.

**A disabled fieldset does not dim.** Named above, and it is the one place in this package where a
control is off and does not look off.

## What would reverse this

A form layout an application cannot express with a column, an inline row and one breakpoint. The
three shapes here are what a form is made of; a fourth would be a fourth `orientation` rather than
a fourth component.

A host where a container query with no container answers true rather than false, on which a
`responsive` field with no `FieldGroup` above it would be a row at every width. Every host in the
support set answers false.
