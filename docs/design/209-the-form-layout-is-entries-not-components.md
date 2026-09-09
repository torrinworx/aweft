# 209: The form layout is entries, not components

Reverses design 196: the three components it shipped are withdrawn and the entries under them
stay.

## Decision

**`Field`, `FieldGroup` and `FieldSet` go, with `field-layout.tsx` and the `data-invalid` slot in
`field.ts` that fed them.** `packages/ui/src/field-layout.tsx` is deleted; `field.ts` keeps the ids,
the ARIA and the two pieces of markup a labelled control puts around itself, and loses `FieldMarks`,
`MARKS_SLOT` and `marksAt`.

**The entries stay, all six**: `field`, `field_group`, `field_set`, `field_legend`, `field_inline`
and `field_responsive`, along with `field_label`, `field_hint` and `field_error`. A form is written
with them and a bare `<label>`:

```tsx
<div theme="field_group">
  <fieldset theme="field_set">
    <legend theme="field_legend">Where to send it</legend>
    <div theme={['field', 'responsive']}>
      <label for="street" theme="field_label">Street</label>
      <input id="street" theme="input" />
    </div>
  </fieldset>
  <TextField label="Notes" value={notes} description="Anything else" />
</div>
```

**The control keeps `label`, `description` and `error`, and its own `<div theme="field">`.** A
control given any of the three still wraps itself, which is the markup design 128 gave it and the
markup a form written with this package relies on.

**The `data-invalid` slot goes and the rule stays.** Nothing but `field-layout.tsx` wrote the
attribute, so the slot on the mount context, the count per field and the watcher per control all
go. The rule that reads it, `field_label` under an ancestor carrying `data-invalid`, stays as a
hook a page writes itself from the cell it already passes to `error`.

## Why

Five people building the same form from the docs alone all avoided the three components, for one
reason: a control given a `label` lays itself out, so a `Field` around it is a column holding one
thing. Design 196 shipped layout-only components on the argument that layout is worth a name; what
forms actually get written says the name is not worth an import, because the entry is already the
name and `theme="field"` is shorter than `<Field>`.

What the components did that the entries do not is `data-invalid`: a field that marks itself while
a control inside it says it is wrong. That is one CSS hook, it costs a slot on the mount context,
a count per field and a watcher per control, and nothing used it or asked for it. A page that
wants it writes the attribute from the same cell it already passes to `error`.

`responsive` still works, because it was always the entry: `field_responsive` is a container query
against `field_group`, and both are class names an application writes.

## Evidence

`packages/ui/tests/field-layout.test.ts` is deleted with the components; `internal.field.test.ts`
keeps the wiring tests and loses the two that covered the marks slot.

`packages/ui/tests/look.test.ts`: the six entries still compile from names only, with the container
query on `field_group` and the width rule inside `field_responsive`.

`recipes/ui/examples/field.example.tsx` is a form written with the entries, and `recipes/ui/main.ts`
keeps every measurement it had over that example except `data-invalid`: the group is an inline-size
container, the responsive field is a row at the pane's width, the inline field is a row, and the
fieldset draws no frame.

`packages/ui/surface.txt` loses six names.

## What this costs

A page that imported `Field`, `FieldGroup` or `FieldSet` no longer compiles. There are none in
this repo outside the catalogue and the tests, and the stack has shipped no release, so the cost
is the rewrite in the README and the one example.

`data-invalid` is gone as a behaviour and left as a rule. A page that wants a label to turn red
under a wrong control writes the attribute itself from the cell it already has.

## What would reverse this

An application that lays out enough forms for the entry names to become noise, and that wants the
invalid mark without wiring it. Then the components come back with the invalid mark as their whole
reason to exist, rather than as a feature of a layout box.
