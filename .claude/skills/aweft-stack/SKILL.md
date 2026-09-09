---
name: aweft-stack
description: Change the aweft stack itself. Use for any edit under packages/, recipes/, spec/ or docs/ of the aweft repo. Reads the changing-aweft half of AGENTS.md, writes the design note before a concept change, runs the root gate, and reports the surface diff with the commit ask.
---

# Changing aweft

Every path below is relative to the aweft repo root, which is `aweft/` in an application that
carries the repo as a submodule. A change to the stack is made in the repo, never in a copy.

## Read first

`AGENTS.md`, the half headed *Changing aweft*, in full: the governing rule, the loop, the
definition of done, the test policy, the coding standards, and deciding and when to stop.
Then `docs/architecture.md` for the packages the change touches, and the notes under
`docs/design/` those sections cite.

## Procedure

1. **Clean tree.** `git status` on the default branch shows nothing. If it does, stop and ask.
2. **One line of goal**, before any edit.
3. **The design calls.** List each call the change will make and apply the two tests in
   DECIDING: hard to reverse, and settled by evidence. A new concept the library would grow (an
   actor, a role, a host) is the maintainer's whatever the tests say: bring two or three options
   with the code shape each produces, and wait. Everything else is yours to settle and write
   down.
4. **The note before the code.** A change to a key concept gets its note in `docs/design/`
   first, numbered after the last one, in the shape the notes there have: Decision, Why, What
   this costs, Evidence, What would reverse this. No person, date or review step in it.
5. **Build to the standards.** Tabs, single quotes, factories not classes, a listener returns
   its unsubscribe, userspace calls deferred, asserts loud, block comments on every public
   export with Params, Returns, Throws and an Example.
6. **Prove it.** Tests through the public surface; a guarantee lands with the check that fails
   when it stops holding, demonstrated red once; the package's recipe still runs; a README
   claims nothing the gate does not check.
7. **The gate.** `npm test` at the repo root. Read its exit code from its own output, never from
   a wrapper. Then `npm run words` for any sentence that says how the work went rather than
   what the code is.
8. **Report and wait.** The diff of every `surface.txt` that changed, the gate command and its
   exit code, and the proposed commits as titles: one logical change each, imperative, no
   attribution trailers. Commit only with the maintainer's approval.

## Stop conditions

The design cannot meet its stated contract; you need an export another package does not have;
the dependency rule would need a new exception; a behaviour looks wrong and you cannot find its
reason; a choice is hard to reverse and no evidence settles it. On any of these, do not patch
around it: say what you were doing, what blocked it, why both tests point at the maintainer,
and two or three options with what each costs.
