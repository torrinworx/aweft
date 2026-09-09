# 032: A policy is patterns over paths, written as data

Superseded by design 057: no policy, no actor.

## Decision

A policy is an array of rules. A rule names a pattern over the attach path a delta lands on,
and optionally the roles it applies to and the delta types it covers.

A pattern is an array of steps. A step is one of four things:

| step | matches |
|---|---|
| a string | that exact path step |
| `ANY` | any one step |
| `SELF` | one step equal to the acting actor's id |
| `REST` | every remaining step, including none. Only ever the last step |

A path step is the slot's name as the format spells it: an object slot is its key, a map slot
is the identity in text form, an array slot is the position in hex. So a policy can name an
object slot and a map slot literally, and reaches an array slot only through `ANY` or `REST`.

Every step is a string or a plain object, so a whole policy survives `JSON.stringify` and
comes back meaning the same thing. `ANY`, `REST` and `SELF` are exported constants holding
`{ any: true }`, `{ rest: true }` and `{ self: true }`.

`REST` anywhere but last throws `bad-pattern` the first time the policy is used, not when a
path happens to reach it. So does an empty pattern: every delta lands at least one step deep,
at the slot it names, so a pattern with no steps can never match anything, and an allow that
never fires is the failure this check exists to catch. An earlier `checkPolicy` accepted one.

## Why

**Patterns over paths is design 009 restated in code.** That design settled that path
authority is the only authority the wire checks, and that named intents are a pattern built on
top of it rather than a second protocol. This design only fixes the grammar.

**The four steps come from the state the first applications will sync.** Three shapes recur in
their trees, and a rule has to be able to name each one:

- a collection of records keyed by an id, where a rule is about one member and every member
  alike: `['runs', ANY, REST]`;
- one object holding fields written by different parties, so a rule has to name a single field
  beside its siblings: `['editing', 'doc', REST]` granted while `['editing', 'status']` is
  not;
- a region only one party may write at all, which is the default and needs no rule.

Literal steps, `ANY` and `REST` cover all three. `SELF` covers the shape those trees do not
have yet and the package exists for: one document with several actors in it, where the rule is
"an actor writes their own region". Design 010's own worked example, users whose posts name
their author, is exactly that shape.

Nothing needed a step matching at any depth, which core's scope grammar calls `tree`. Leaving
it out keeps matching a single left-to-right scan with no backtracking; adding it later is
additive and costs nothing already written.

**Data, not symbols, and not bare strings.** A bare string sentinel such as `'*'` collides with
an object key literally named `*`, and the collision is silent and grants more than the author
wrote. Symbols cannot collide but do not serialize, and a policy that cannot be stored or
shipped stops being auditable the moment anything wants to keep one. A step that is either a
string or a small object has neither problem: a string is always a literal key, because a
literal key is always a string.

**`SELF` rather than building the policy per actor.** A function from actor to rules would be
as expressive and would stop being data, which is the property design 009 chose a pattern
language for. One placeholder buys the whole per-actor case and keeps a policy a value you can
print, diff and store.

**`REST` is last, and that is checked.** `[REST, 'name']` would mean "name at any depth", which
is the feature left out above and would need a backtracking matcher for a case nothing asked
for. Refusing it keeps the matcher linear and the reading obvious.

## What this costs

An array slot cannot be named literally. That is right rather than a limitation: an array
position is chosen by whoever inserted, means nothing to a policy author, and is a different
string after an unrelated edit. It does mean an authority boundary inside one array is not
expressible, and an application that needs one puts those elements in a map or an object.

A policy is matched per delta, so its cost is the rule count times the pattern length.
Measured on the shipped validator in `bench/authority.ts`.

## What would reverse this

A real application whose authority rules need a step matching at any depth, or a condition on a
value rather than on a path. The first is additive. The second is a different design, because a
condition on a value makes the validator read the document rather than only its shape.
