# 214: `FileDrop` says why in a way a page can use

Amends design 137: what an entry carries, what the message says, and where the checks live.

## Decision

### An entry carries a reason code

`FileDropEntry` gains `reason`, beside `error`:

| `reason` | what happened |
|---|---|
| `type` | the file is not one of the declared `extensions` |
| `size` | the file is over `limit` |
| `count` | `multiple` is false and this is not the first file |

`error` stays what it is, the sentence a person reads. `reason` is what a page branches on, so a
page that wants its own wording has something to switch over rather than a string to match against.
An accepted entry carries neither.

### The message writes the limit for a person

`limit` is bytes, because that is what a `File` reports. The message writes it in KB, MB or GB,
1024 to a step, with one decimal where it is not whole: a `limit` of `4_000_000` reads "over the
3.8 MB limit" rather than "over the 4000000 byte limit".

### The prompt names what is accepted

The zone's prompt line names the types and the limit the way a person says them: `image/png`
reads as `png`, `image/*` reads as `image`, `.csv` reads as `csv`, and the limit is the same unit
the refusal uses. "Drop files here, or choose them. png, jpeg, up to 3.8 MB."

### `FileDrop.Button` works on its own

**Outside a zone, `FileDrop.Button` is the picker with no chrome**: it renders its own visually
hidden `<input type="file">` beside the button and runs the same checks, so it takes `files`,
`extensions`, `multiple`, `limit`, `onDrop` and `ready` alongside the `Button` props. There is no
drop target and no listing, which is the point: a page that wants "Change photo" and nothing else
writes one component.

**Inside a zone it is what it was**: a `Button` that opens the zone's input, taking no checking
props, because the zone owns the list and has already been told what it accepts. Which one it is
is decided by whether the zone put its opener on the mount context, so it is never ambiguous and
never a prop.

The checking is one function both use, `packages/ui/src/file-checks.ts`: what covers a file, why a
file was refused, how a byte count is written, and how a run of files becomes entries. Neither
copy of it is a second opinion about what `image/*` matches.

### The look

The look stays, polished, which here is the prompt line above and nothing else. The entries do not
move.

## Why

The refusal message is the first thing a page has to deal with, and the sentence used to be the
only thing the component said, so a page re-derived the reason from the platform `File` instead. A
page that wants to count how many files were the wrong type, or to word the refusal in its own
voice, had to parse English. A code is one field and it makes both trivial.

The byte count was measured at `packages/ui/src/file-drop.tsx:169` and read `is over the 4000000
byte limit`. Nobody reads a number that long. The unit is arithmetic on a number the component
already has.

There was no button-only picker: the checks came only with the zone's chrome, so
a page wanting a plain "Choose a file" button either took the zone and hid it or wrote the input
itself and lost the checks. Making the button stand alone is the same code with no zone around it.

## Evidence

`packages/ui/tests/filedrop.test.ts`: a file of the wrong type, a file over the limit and a second
file under `multiple={false}` each land with the right `reason` and the right sentence; an accepted
entry carries neither; the limit is written in KB, MB and GB at the boundaries and whole numbers
lose their decimal; the prompt names the types with the MIME prefix off and the limit as a unit; a
`FileDrop.Button` on its own picks a file, refuses one of the wrong type with the same `reason`,
writes its `ready` cell, and renders no zone and no listing; the same button inside a zone still
opens the zone's input and takes no checking props of its own.

The suite pins both: the `reason` on the size branch, and the limit written as a unit rather than
in bytes.

## What this costs

`FileDropEntry` has one more field, which is one more thing in the README's entry shape.

`FileDrop.Button` has two behaviours decided by where it is. That is the ambiguity the assert used
to catch, turned into a feature: a button outside a zone used to be a loud assert naming the fix,
and now it is a picker. A page that put one outside a zone by mistake gets a working picker with no
list rather than a message, which is a worse error to make. The README says which is which in one
sentence, and a button given a checking prop inside a zone is a loud assert naming the zone that
already owns those props, so the one way to write it that could mean two things is refused.

## What would reverse this

A page needing more than three reasons, an image too small to use, say. Then the reason becomes an
open string and the three named ones are the ones this component can decide, which is a widening
rather than a reversal.
