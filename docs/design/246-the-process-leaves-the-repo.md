# 246: The process leaves the repo

## Decision

The repo carries what the stack is and nothing about how it was built.

- `docs/design/` holds one note per design decision: what was decided, why, what it costs,
  and what would reverse it. A note names no person, no date and no review step.
  The notes that were written before this one are rewritten to the same rule and keep their
  numbers, so a citation in a source comment still resolves.
- There is no file of open calls. A question for the maintainer is asked in the conversation
  that raises it, with two or three options, as `AGENTS.md` says under DECIDING. A question a
  later package settles with evidence is written into the owning package's README under its
  known limits, with what settles it.
- The gate no longer reads a note's header. `checkDecisionHeader` leaves the surface of
  `@aweftjs/testing`, with its script and its test, because there is no header to check and
  no calls file to check it against.
- `docs/architecture.md`, the READMEs, the recipes, the benchmarks, the tests and the source
  are brought to the same rule: a citation of a record becomes `design NNN`, and a citation of
  a call becomes the rule stated inline. The notes came first; `npm run words` says what is
  left.

## Why

An agent or a person opening this repo should need nothing outside it to change it
correctly. The vocabulary of the process (who decided a thing, when, through which review,
against which other library) described the work rather than the stack, went stale the day
the process changed, and pointed at files that were never going to be published. A reader
building with the stack does not need it, and a reader changing the stack needs the reasoning,
which the notes keep, and not the provenance, which they drop.

The header check existed to make sure a concept change had an owner. That is now the loop in
`AGENTS.md`: a design call is asked before the code, and the surface diff in the commit is
where an export is reviewed.

## What this costs

The notes no longer say when a decision was made or who made it. The commit history carries
when, and the reasoning in each note is what a later reader needs to revisit it. A superseded
note still says what superseded it.

Nothing in the gate makes sure a concept change was asked before it was built. That was never
something a header could prove either; it proved a line was written.

## Evidence

`packages/testing/tests/surface.test.ts` pins the surface without `checkDecisionHeader`, and
`packages/testing/surface.txt` carries the diff. `npm run words` (design 247) is what says the
rest of the tree keeps to this note.

## What would reverse this

A contributor base large enough that every note needs a named owner and an approval trail
inside the repo. Then a header naming the owner comes back, with a check behind it.
