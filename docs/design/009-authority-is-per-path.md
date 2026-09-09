# 009: Wire authority is per path, and actions are a pattern rather than a second protocol

Superseded by design 057 for its authority half: the library checks no actor. The measurement
that a whole commit can be checked before it lands still holds, and is what `intercept` (design
058) rests on.

## Decision

A `schema` policy is a set of declarative patterns over paths, and that is the only authority
the wire checks. Per-action authority is not a protocol feature.

An application that wants named intents writes the intent into the document as ordinary
state, in a region the actor has path authority to write. A server-side handler, itself an
actor with wider authority, reads the intent and writes the outcome. Both writes pass through
the same validator. There is one enforcement mechanism at the wire, not two.

## Why

The architecture replicates state rather than calling procedures. A collaborative editor at
canvas rate emits a stream of small commits, and naming each one as an intent adds a function
call to the hot path while adding no information, because the handler would emit the deltas
the client already stated.

A prototype validator settles the feasibility question. It is a function of an actor, a
document and a commit, and it needs nothing from the runtime, so it can be built before
`core` exists. Twelve cases pass, including a whole subtree added in one commit, a partly
authorized commit, and a target nothing reaches.

**Authority over paths that do not exist yet works.** Policies talk about paths and deltas
carry ids, so the validator holds an index from id to path and extends it with the commit's
own attachments before deciding. A delta into an observable that did not exist a moment ago
resolves to a path, because another delta in the same commit gives it one. This is the same
shape as the separate clause that row level security uses to constrain a row being inserted
rather than a row that exists.

**A partly authorized commit is refused whole.** Forced by commit atomicity, and it matches
the comparable systems: in a batched write, every operation must be allowed or the batch is
denied.

The known weakness of replaying deltas is that a replayed delta restates a decision made
against older state. Half of that is caught for free: a commit that depended on a refused
commit for its reachability is itself refused, because the attachment that would have given
it a path never happened. The semantic half survives, meaning a write that is still
authorized but was premised on the refused change. That residue is confined to the refusal
window, the application sees the whole group under design 011, and a mutation whose meaning
depends on current server state is exactly what the action pattern is for, because the
handler runs against current state.

Attaching authority to handler functions instead would put the policy inside imperative code,
where it cannot be read as data or audited, and would leave a validator that is mandatory at
the wire with nothing to check.

## What would reverse this

Building a real collaborative application and finding that most refusals need semantic
re-derivation rather than notification, so most mutations end up routed through the action
pattern anyway. Or a demonstration that the pattern language cannot express a real
application's authority rules without escaping to a handler for ordinary writes.
