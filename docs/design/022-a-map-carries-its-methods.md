# 022: A map carries its methods

## Decision

`createMap` returns an object carrying `get`, `has`, `set`, `add`, `delete`, `size`, `keys`,
`values`, `entries` and iteration. This is the second exception to design 013, which says an
observable carries no method of its own and names one exception, arrays keeping the read half
of `Array.prototype`.

## Why the rule does not need to reach here

Design 013 exists because a document's property space belongs to the user. An object slot is
named by a string the application chose, so a field called `watch` is ordinary and a framework
that took the name would break the document. There is no name the framework can safely claim,
so it claims none and everything is a free function.

A map slot is not named by a string the application chose. It is named by an id: twelve bytes,
sixteen base64url characters, and nothing else is accepted, which `keyOf` enforces at every
entry point. No id is spelled `get`, and none can be. The collision the rule protects against
cannot occur in this kind, so the reason to forbid methods is absent while the cost of
forbidding them stays: a map read through free functions is worse to use for no benefit.

The rule stands unchanged for objects, where the collision is real and ordinary.

## Where the reasoning also lives

`map.ts` carries the same reasoning in a comment at the top of the file, at the definition
site.

## What this costs

Two kinds now read differently: an object is all free functions, a map is methods. That is a
real inconsistency for someone learning the library, and it is the price of not making map
awkward to satisfy a rule that does not apply to it. An array already sits between the two,
keeping its read methods, so the honest description is that each kind keeps the surface its
addressing makes safe.

## What would reverse this

A map slot becoming addressable by something other than an id. If a key could ever be an
arbitrary string, the collision returns and the methods have to go.
