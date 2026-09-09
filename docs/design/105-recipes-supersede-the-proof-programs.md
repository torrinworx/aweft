# 105: Recipes supersede the proof programs

## Decision

`examples/` becomes `recipes/`. The ten proof programs move in as their packages' recipes, and
new recipes are per task: a todo list, two clients converging over sync, an optimistic write the
server refuses.

A recipe is what a proof was, with one addition: it uses public exports only, does a job someone
would actually have, asserts its own outcome, exits nonzero when an assertion fails, and runs in
the gate. Item 6 of DEFINITION OF DONE FOR A PACKAGE names a recipe instead of a proof, so a
package is not foundational-complete until one exists.

The integration app leaves the repo. Integration recipes do the job `examples/site` was going to
do, and the documentation site gets its own repository.

## Why

A proof answers "does this package still work". Nobody had the second question answered:
"how do I do this". Ten programs indexed by package teach a reader nothing about a task that
crosses two of them, and a reader arriving with a task does not know which package owns it.

Indexing by task rather than by package is the whole change. A package's own program is one recipe
for that package, and a recipe can also be something no single package owns: how to build a chat
application, a server and a client over a socket, a client-server database observer network, a
todo list.

No new machinery is needed. Proofs already run in the gate and assert their own outcomes, so
recipes are the same runner with a different index.

Gating completion on a recipe because recipes that are merely intended do not get written. It
raises the bar on every future package, which is the point.

## What this costs

Every future package owes a recipe before it is complete. A recipe that goes stale turns the
build red, which is the enforcement and also the maintenance.

## What would reverse this

Recipes drifting into restating unit tests, which is what the proof rule already forbade. That
would mean the index changed and the substance did not, and the answer is the rule about what a
recipe must be, not a return to per-package proofs.
