# 037: Reachability follows the applier, and the two are checked against each other

Superseded by design 057. Supersedes the reachability half of design 035.

## Decision

`validate` resolves a delta's path against the document as it stands, extended by the attach
edges the commit adds, and **not** reduced by the edges it removes. That is the applier's rule,
stated in `packages/core/src/apply.ts`, and the two now agree by construction rather than by
intention.

So a commit may write into a subtree it detaches in the same breath, and the write is
authorized at the path that subtree had when the commit began. A commit that moves an
observable still resolves at the new path, because an edge the commit adds wins over the edge
it had.

The equivalence design 035 claimed is now a check, stated exactly, because the loose version
is not true and cannot be. `tests/agreement.test.ts` runs one
commit stream through both and holds them to three things:

1. **No false refusal.** A commit `validate` turns away is one `apply` turns away too. This is
   the property that costs something when it breaks: a refusal loses the client its edit under
   design 011.
2. **No false acceptance.** A commit `apply` refuses as `unreachable` or `multiple-attach` is
   one `validate` refuses too. Those two causes are what `schema` exists to decide.
3. **One cause, when both can see it.** When both refuse and the applier's reason is one of the
   two shared ones, it is the same one.

What is deliberately not claimed is that the stated cause always matches. The applier checks
slot occupancy, which an authority index does not hold, and it checks a ring closing during
the write rather than before it. So a commit that breaks two rules at once can be refused as
`slot-missing` by one and `unreachable` by the other, and both are right about what they can
see. Design 035's unqualified wording is superseded by this list.

## Why

**Design 035 stated the equivalence and nothing enforced it, so it drifted immediately.**
The claim was that `unreachable` and `multiple-attach` are "refused for the same condition on
the same input". For `multiple-attach` that held. For `unreachable` it did not, and the
disagreement refused ordinary work: one `atomic` block that writes a slot and then deletes its
parent produces a single commit that the applier accepts and the validator refused. Under
design 011 the client rolls back and the user loses the edit. It was found by running both
halves on one commit, which nothing did before.

**The applier's rule is the right one, not merely the incumbent.** A delta into a subtree the
commit removes lands at the path that subtree had, which is exactly where the policy already
governs it, so following the applier refuses less without granting more. The alternative,
making core refuse it too, would forbid a shape ordinary editing produces and would contradict
core's own written reason for allowing it.

**A shared claim between two packages needs a check that spans both.** The one-sided suites
could not see this: the conformance suite feeds the validator only commits the fixtures already
accept, and the index-versus-document suite never calls `validate` at all. Each half was
checked against something, and the seam between them was checked against nothing.

## What this found

The check found a defect in `core`, not in `schema`. Replacing a slot's attach edge
with an alias to the same observable skipped the detach, so the observable's parent went on
naming a slot that no longer attached it: `isReachable` answered true, `parentOf` named a
parent, `snapshot` did not contain it, and writes into it were accepted. A document in that
state cannot be rebuilt from its own snapshot. Fixed in `core` with a corpus case, and the
case is red against the old code.

It also found that a commit attaching an observable inside its own subtree closes a ring the
applier refuses and the validator did not. The validator refuses it now.

## What this costs

`schema`'s test suite now imports `core`, as a devDependency, to run the two halves on one
input. That does not weaken design 034: the shipped package still depends on `codec` alone
and never touches a live document. It does mean the check lives where both are reachable,
which is the test suite, and it is the only place it can live while the runtime dependency
stays out.

## What would reverse this

The applier changing its own rule, which would move this with it, because the point of this
design is that one of them follows the other rather than that either is right in isolation.
