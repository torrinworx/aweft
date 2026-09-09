# 208: `Validate` covers a form

Amended: the re-entrancy flag stays, and it is the mount it holds off. Amends design 138: what
`signal` means, and when a validator runs again.

## Decision

Two changes, both to when a check runs. Nothing about what a check is, what it is handed or where
its message goes moves.

### `signal` is read, not counted

**While the `signal` cell holds something falsy nothing is checked, and while it holds something
truthy everything is.** Design 138 said "until it changes for the first time nothing is checked;
after that, everything is", so the first change was a door that only opened. A form that clears
itself after a successful submit writes its fields back to `''` and its `submitted` cell back to
false, and every field went red on the empty form the person was left looking at.

Reading the cell rather than counting its first change also drops a special case: a `signal` that
starts truthy is a form that wants checking from the start, and there is now nothing to explain
about the first delivery.

**A `Validate` that goes quiet clears its message, its `valid` cell and its `error` cell.** Going
quiet means "nobody has been asked yet", which is what the field said before the first submit; a
message left on the screen under a signal that has gone false would be the same bug read the other
way round. `valid` is written true, because a form that has not been checked does not hold itself
back.

### A validator re-runs when any cell the form is checking changes

**Every `Validate` under one `ValidateContext` runs its check again when any of their `value` cells
changes.** A validator that reads a second field, which is what confirm-must-match is, went quiet
the moment the second field moved: it was subscribed to its own cell and to nothing else.

The set of cells is the form's own members and nothing wider. A `ValidateContext` already knows
every `Validate` under it, because each one joins on mount and leaves on unmount (design 138), so
the cells are there to be followed with no new prop, no new component and nothing for a page to
declare. A `Validate` with no `ValidateContext` above it is unchanged: it follows its own cell.

One write is one round. A check that writes its own cell back, which four of the eight built-ins
do, does not start a round inside the round it is in: `core` queues a write made during a delivery
rather than delivering it inside that one. Measured: writing a cell from inside another cell's
effect, the second effect runs after the first returns.

**The mount is the one call that is not a delivery, and each `Validate` holds that one off itself.**
`value.effect` calls back as it registers, so a write the first check makes has no delivery to be
queued behind and arrives back inside that check. A per-`Validate` flag makes the mount one check
like every write after it. Measured with the flag taken out: a formatting validator ran twice on one
mount and the cell came out formatted twice over, while every write after the mount was one round
with or without it.

A validator that reads a cell no `Validate` in the same form is checking still goes quiet for it.
Put that control in a `Validate` too, which is what a form does with a field it cares about, or
derive the pair into one cell and check that.

## Why

Four of five people building the same form from the docs alone dropped `Validate` or rebuilt it
around `TextField`'s `error` prop, and the two reasons they gave are these two. Both were design
138 by design, and both show on a real form rather than in argument.
Confirm-must-match reads the new-password cell inside the confirm field's validator, and every
field of such a form sits under one `ValidateContext`, so the form-wide rule fixes the measured
case with no change to the page at all.

**What was not built, and why.** The larger mechanism is a tracked read scope in
`core`, where a validator re-runs when any cell it read changes, whatever that cell is. `core`
exports no such thing: `Derived.map` says in as many words that what a transform reads besides its
input is not tracked, and there is no read-recording scope anywhere in the stack. Adding one is a
change to `core`'s central concept, not `ui`'s, so this note does the smaller thing that covers
the measured case, and whether `core` grows the general one is left open. If it does, this rule becomes a special case of it and nothing a page wrote changes.

The alternative inside `ui` was a prop naming the extra cells, `when={password}`. It is exact
rather than a superset, and it fails the way the bug already failed: a person who does not know to
write it gets a check that is quietly never run again, which is the defect this note exists to
remove. A form-wide trigger is a check that runs more often than it has to, which costs a function
call per keystroke per field and can be seen.

## Evidence

`packages/ui/tests/validate.test.ts` pins both flows, red before the change and green after:

- **Cleared after success.** A signal cell written true, a message shown, the cell written back to
  false with the field cleared: the message goes, `valid` is true and `error` is null, and writing
  the signal true again brings the message back. Before the change the message stayed and `valid`
  stayed false.
- **The other field moves.** Two `Validate`s under one `ValidateContext`, the second checking that
  its cell equals the first's: the message goes when the first cell is edited to match and comes
  back when it is edited away again, without the second cell being touched. Before the change the
  message never moved after the first check.

Also: a signal that starts truthy checks from the start; a `Validate` outside a
`ValidateContext` still follows only its own cell; a formatting validator writing its cell back
under a form does not loop.

Four ways to get this wrong, each caught. The scope: sweeping only the member that fired, and
handing the group no cell to follow. The signal: reading it as always true, and leaving the message
on the screen when it goes false. A fifth, taking the re-entrancy flag out, passed all 573 tests,
so the case it holds off was looked for and found: the mount.
`packages/ui/tests/validate.test.ts`, "a check that writes its own cell as it mounts does not run
again inside itself", counts the calls and catches it.

## What this costs

A form of N fields runs N checks per keystroke instead of one. The eight built-in validators are
string tests and a Luhn sum, so the cost is a function call each; a page whose check is expensive
now pays for it on every field, and the way out is to derive the expensive part into a cell the
validator reads.

A page that wrote a `signal` cell it never set back to false sees no change. A page that used the
signal as a counter, incrementing it per submit, is now checked from the moment it is non-zero,
which it already was after the first submit.

## What would reverse this

`core` growing a tracked read scope. Then a validator re-runs on exactly what it read, the
form-wide broadcast becomes redundant, and this note's second half is replaced rather than
amended. Nothing a page wrote changes when that happens, which is why this is the safe order to do
it in.
