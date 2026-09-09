# 018: An effect follows the depth of its scope

## Decision

`effect` re-runs whenever anything in its scope changes, including a change below the value
it reads. It does not subscribe shallowly on its own.

```js
observer(doc).path('child').effect(fn);            // re-runs on a change anywhere under child
observer(doc).path('child').shallow().effect(fn);  // re-runs only on child's own slots
```

Depth is a property of the scope, set by `shallow()`, and every operator reads it the same
way. `watch` and `effect` differ in what they hand the callback, never in what reaches them.

## Why the corpus case is not adopted

The behavioral corpus carries a case saying an effect subscribes shallowly, so that only a
direct change to the value re-runs it. That case does not carry over, and the corpus is
append-only: a case that is not adopted needs a note saying why, because each one is there
for a reason someone paid for.

The reason it does not carry over is that it answers a question this design does not have.
Where an effect is the only way to react to a value, its depth has to be decided for the user,
and shallow is the safer of the two guesses: a deep default makes an effect on a large subtree
fire for changes the callback never reads. Here the scope already carries that decision, and
carries it in one place for every operator. Making `effect` the one operator that quietly
narrows its own scope would mean `path('child').watch` and `path('child').effect` no longer
hear the same deltas, and a reader would have to remember which operator changes the rule.

The deep default is also the one that matches what a scope is. A scope is a prefix of a delta's
path (design 017), and everything under the prefix is in it. An effect that dropped the
subtree would not be reading its scope; it would be reading something narrower with no name.

## What this costs

The user pays attention rather than the library guessing. An effect that reads one field of a
large subtree re-runs for the whole subtree unless it says `shallow()`. That is a real cost and
it is the cost the corpus case was warning about.

Two things make it acceptable. The narrowing is one call and it reads at the call site, so the
fix is local and visible. And the cost is bounded by the scope the author already chose: an
effect written against the field it actually reads, which is the same rule that says to start
a scope at the observable being read, is shallow by construction without asking for it.

## What would reverse this

Evidence from a real page that the deep default is what people get wrong, rather than a thing
they get right once and forget. The derived surface is the first real consumer of `effect`, so
that is where the evidence would come from. Reversing it means making depth an operator's
business rather than a scope's, which is the coupling this design is buying out of, so the
case would need to be strong.
