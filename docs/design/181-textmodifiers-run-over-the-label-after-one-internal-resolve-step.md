# 181: `TextModifiers` run over the label, after one internal resolve step

## Decision

`TextModifiers` is a context holding a list of `{ check, return }`. `Typography` runs the list
over its `label` and renders the result: a gap between matches is text, a match is whatever
`return(match)` answers.

**`check` is a string or a regex.** A string is escaped and matched everywhere, case-insensitive.
A regex is used as given and must be global, because a pattern that finds one match is almost
never what was meant; a regex without the `g` flag is an assert naming the fix. Matches are
collected in declaration order, sorted by start, and an overlap loses to the match that started
first, ties to the earlier modifier.

**What a modifier returns is rendered with no modifiers below it.** A `return` that mounts a
`Typography` of its own gets a plain one, so a match that still matches its own check cannot
recurse. A zero-width match is skipped, because a pattern that matches nothing at every index was
never meant, and an empty string `check` is an assert naming the fix.

**Extra keys on a modifier are ignored.** An existing list may carry `atomic`, which only a caret
reads; it passes through unchanged.

**A nested provider replaces the one above it.** The value below is the list given, not the two
joined, which is what the one measured user relies on.

**Modifiers apply to `label` only.** `children` render as given: a child is already markup or a
component and has nothing for a regex to run over. A `label` that is not a string renders as
given too; a number is stringified first.

**A cell label re-runs the pass on change**, through `map`, so a typed value re-renders its
matches as it changes. That is the whole of what a cell costs here.

**One internal resolve step runs before the modifiers.** The label passes through a function
that answers the string to render, and today that function answers what it was given. It is the
seam a later translation step fills; it is not exported, because nothing outside this package has
a value to put in it yet. An earlier outline called it a text context; it stays internal until
translation, shaped and deferred, has a consumer for the export.

## Why

The plain-string-plus-regex model is the one idea worth keeping here: no document model, no
serialization, and the same list can later render an editor's view. Its shape is kept and what
only a caret needs is dropped. Measured: one user across the four applications, one application's
Markdown component, with `check`, `return` and `atomic` on every modifier, no context argument
read by any `return`, and no nesting.

## What this costs

Every regex runs over the whole label on every change, so a long label with many modifiers pays
for all of them each time. A match cannot nest another: a `return` that wants modifiers inside its
own output runs them itself. A nested provider that wanted to add to the list above it writes the
two lists joined.

## What would reverse this

A second user whose `return` needs the type or the theme, which would put a context argument back.
An application nesting providers to extend a list, which would make the transform append.

## Evidence

`packages/ui/tests/typography.test.ts` asserts a string check, a regex check, declaration order
under overlap, a modifier's extra key ignored, a nested provider replacing, a cell-valued provider
applied and followed, children untouched, a cell label re-rendered after a write, a `return` that
mounts a `Typography` terminating with the inner one plain, a zero-width match skipped, an empty
string check refused, and a non-global regex refused with the fix in the message.
