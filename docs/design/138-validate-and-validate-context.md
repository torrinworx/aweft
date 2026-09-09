# 138: `Validate` and `ValidateContext`

Amended by design 208: `signal` is read rather than counted, so it can go quiet again, and every
`Validate` under one `ValidateContext` re-checks when any of their cells changes.

## Decision

`Validate` wraps a control and says what is wrong with what is in it. `ValidateContext` collects
those answers for a form.

**`Validate`'s props.** `value` is the cell being checked. `validate` is the check: a function, or
the name of one of the eight built-in validators. `signal` is an optional cell that decides when
checking starts. `valid` and `error` are optional cells the outcome is written into. `showError`
defaults true and turning it off keeps the message off the screen while the cells still move. `icon`
is what sits beside the message, an `Icon` named `triangle-alert` by default. `type` is the theme
variant and `theme` appends segments. The children are the control.

**A validator is given the cell, not the value.** `validate(cell)` returns an error string, or `''`
or `null` for no error. The cell rather than what it holds, because a validator that formats what
was typed has to be able to write it back, and because that is how the twenty-nine uses measured
across the five applications are already written.

**The signal-then-live rule.** With a `signal`, nothing is checked until that cell changes for the
first time; after that every change to `value` is checked, live. That is what a form wants: a person
typing an email address should not be told it is wrong at the second character, and once they have
pressed submit they should see the message clear as they fix it. With no `signal`, checking is live
from the start.

**The message reaches the control, and is rendered once.** While it says something, the message is
rendered after the children as a live region in the `field_error` entry. It is also handed down
through a context this package keeps internally, and `wireField` (design 129) reads it when the
control was given no `error` of its own. So the control goes `aria-invalid` and its
`aria-describedby` names the message `Validate` rendered. That is one extra read in the field wiring
and no second message: the id travels with the error, so the control points at the element that
exists rather than at one it would have rendered itself.

A control given its own `error` prop keeps it, and `Validate` still renders its own message. Two
sources of truth is the caller's choice, and silently dropping one of them is worse.

**`showError` false takes the message off the screen and leaves it announced.** It is rendered
visually hidden rather than not rendered, because the control's `aria-describedby` names it: a
control that says it is invalid and then points at nothing is a dead end for anyone reading the page
with their ears.

**`ValidateContext` is the form's answer.** It takes a `value` cell and writes true while every
`Validate` under it is valid, false otherwise. Each `Validate` registers when it mounts and leaves
when it unmounts, so a field that goes away stops holding the form invalid. It is a component
providing a slot rather than a `createContext` value, because the group has to survive the cell being
written and a context transform is re-run whenever its raw value changes.

**The eight built-in validators.** `phone`, `email`, `pan`, `expDate`, `postalCode`, `date`,
`number` and `float`. Each answers `''` for an empty value, so a field is not invalid before anybody
has typed in it. Four of them rewrite the cell to format what was typed: `phone`, `pan`, `expDate`
and `postalCode`. The other four read and do not write. The README says which.

They are small on purpose. Measured, no application names one: all twenty-nine uses pass a function
of their own. They ship because the catalogue names them, so each does what its name promises and
nothing else: `email` is a shape check and not a deliverability check, `date` is `YYYY-MM-DD`,
`postalCode` is the Canadian one, and `pan` is a Luhn check on thirteen to nineteen digits.

## Why

The catalogue holds what an application needs and nothing beside it. The measurement is what shaped
the props: twenty-nine uses in eight files, every one with a function; twenty-six pass
`signal={submit}` where `submit` is a `mutable(false)` a form sets true; `ValidateContext value={allValid}`
in seven files with `allValid` a `mutable(true)`.

The error wired through the field behaviour rather than through a prop on the control, because a
`Validate` wraps a control it did not build and cannot reach its props. A context is the one way down
that this package already has.

## What this costs

`Validate` has to be able to see the control's field wiring, which means the control has to be one of
this package's. A `Validate` around a plain `<input>` renders and announces the message and the input
does not go `aria-invalid`, because nothing read the context. That is written in the README.

The eight validators are opinionated about a country and a date format. An application outside
those writes a function, which is what every measured use already does.

## What would reverse this

An application needing a validator run against a value that is not in a cell, an upload for
instance. That is a `Validate` whose `value` is a derived value rather than a cell, and the shape
here already takes one: what it costs is that a formatting validator cannot write back.

## Evidence

`packages/ui/tests/validate.test.ts` asserts a function validator, a named one, that nothing is
checked before the signal and everything after it, that `ValidateContext` goes false when one child is
invalid and true again when it is fixed, that a `Validate` unmounting leaves the context, and that the
message reaches the wrapped `TextField`'s `aria-invalid` and `aria-describedby`.
`packages/ui/tests/internal.field.test.ts` keeps every existing guarantee of the field wiring, which is
what says the extra read changed nothing else.
