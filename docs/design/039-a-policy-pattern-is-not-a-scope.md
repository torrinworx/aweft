# 039: A policy pattern is not a scope, and the three places they differ are deliberate

Superseded by design 057.

## Decision

Policy patterns and scopes both describe places in a document and they are not the same
language. Three differences, all kept:

| | a scope, in `core` | a pattern, in `schema` |
|---|---|---|
| any one step | `skip(count)`, a builder taking a count | `ANY`, a value |
| what it covers by default | the subtree, narrowed with `shallow()` | that slot exactly, widened with `REST` |
| a leading-underscore slot | not delivered to a wildcard | matched by a wildcard |

## Why

**A pattern is data and a scope is a chain.** Design 032 made a policy serializable so it can
be printed, diffed and stored, so its steps are values. A scope is built by calling methods and
never leaves the process, so its steps are calls. `skip(3)` has no spelling as a value that
reads better than three `ANY`s, and `ANY` has no spelling as a builder that reads better in an
array. Naming them the same thing would be the drift, not this.

**The defaults are inverted because the failure directions are.** A scope that hears too little
is a bug someone notices: the interface stops updating. A grant that covers too much is a hole
nobody notices. So delivery defaults to the subtree and authority defaults to the one slot, and
each is widened or narrowed by saying so. `packages/schema/README.md` already carries the
consequence a policy author meets, which is that a subtree grant hands out every field inside
it.

**The underscore rule is about observers, and it stays that way.** Leading `_foo` is
runtime-private *from wildcard observers* (design 020), and that is a delivery rule. A `_` slot is
ordinary state: it replicates, it crosses the wire, and something has to decide who may write
it. If a wildcard pattern skipped it, no rule would reach it, default deny would refuse every
write to it, and an author would need a literal rule per underscore slot to get their own state
back.

The error direction is worth naming, because it is the permissive one: an author who reads `_`
as private everywhere will write `['users', SELF, REST]` and grant `_internal` along with the
rest. That is a documentation duty rather than a behaviour change, and the README and the
corpus now both state it.

## What would reverse this

An application whose underscore slots are consistently the ones a policy must not grant, which
would argue for a wildcard that skips them and a literal step that still reaches them. That is
a bigger change than it looks, because it makes a pattern's meaning depend on a naming
convention, which the repo forbids for exactly this reason: an internal surface another
package needs goes behind an exported Symbol or a documented subpath export.
