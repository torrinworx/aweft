# 013: An observable's surface is the user's data, and nothing else

## Decision

An observable is a proxy whose every property is a slot. Assignment is the mutation:

```js
doc.title = 'aweft';
delete doc.draft;
```

The framework's own operations are free functions, imported from `@aweftjs/core`:
`observer`, `atomic`, `apply`, `idOf`, `kindOf`, `alias`, `insertAt`, `positionsOf`.

An observable carries no method of its own, with two exceptions named below.

## Why

A method on the observable is a name the user cannot use. `doc.watch` has to mean the slot
called `watch`, because a document with a `watch` field is ordinary and the framework
stealing that name breaks it in a way that reads as data loss. The same argument applies to
every name the framework might want, so the rule is all of them rather than a list.

The two alternatives were considered against that:

- **Methods on the observable**, with `get` and `set` as calls. No collision, because keys
  become arguments, but every read and write in every application gets louder, and the
  ergonomic cost lands on the primitive people touch most.
- **A symbol escape**, `doc[ops].watch(...)`. Collision-free, and it puts two ways to reach
  one object in the API. The symbol has to be imported anyway, at which point a free
  function is the same import with less indirection.

## The exceptions

Arrays keep the read half of `Array.prototype`: `map`, `filter`, `find`, `join`, `includes`,
iteration and `length` all work, because an array whose contents cannot be read with the
array methods is not an array. The mutating half is replaced by implementations that produce
deltas, and the ones that cannot be expressed against position keys assert rather than
silently rewrite every slot.

Maps carry their methods outright, because a map slot is named by an id and no id can be
spelled `get`. The collision this design exists to prevent cannot occur in that kind.
Design 022 has the reasoning.

## The cost

Every proxy trap is a function call on a read path. Nothing here is measured yet, and the
derived value benchmark covers propagation rather than access. If access cost turns out to
matter, the fix is inside this design (a faster trap set, a cached shape) rather than a
return to methods.

## What would reverse this

A measurement showing proxy access dominates a real workload, together with a demonstration
that the method form is materially faster. Ergonomics loses to a large enough number, and to
nothing smaller.
