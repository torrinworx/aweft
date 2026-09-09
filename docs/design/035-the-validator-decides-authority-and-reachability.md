# 035: The validator decides authority and reachability, and the applier decides the rest

Superseded by design 057. The equivalence claim below is superseded by design 037, which states
it precisely and makes it checkable; the rest stands.

## Decision

`validate` answers one question: may this actor make this change. It refuses a commit for
three causes and no others.

| cause | when |
|---|---|
| `unauthorized` | the policy does not allow a delta's path, or denies it |
| `unreachable` | a delta's target has no attach path from the root, counting the commit's own attachments and its own detachments |
| `multiple-attach` | a delta would leave an observable with two attach edges, so no single path decides its authority |

Everything else a commit can get wrong is the applier's: a slot that is occupied when the
delta says `add`, a slot that is empty when it says `replace`, one observable called two
kinds, a commit with no deltas. `validate` does not check them and its verdict does not claim
they hold.

A server therefore runs both. A refusal from either refuses the commit, per design 012, and
neither closes the connection.

The two reason tokens `validate` shares with the applier, `unreachable` and `multiple-attach`,
are the applier's own words, deliberately: two names for one refusal would make a client's
handling depend on which layer happened to catch it.

An earlier wording said both refuse "the same condition on the same input", and nothing
checked it, so it drifted. Design 037 replaces that sentence with the three properties that
are true and now checked, and states what the check found.

## Why

**The line is forced by the index, not chosen.** Design 034 keeps attach edges and no slot
values, because that is all authority reads. A validator without slot values cannot know
whether a slot is occupied, so `add` against a taken slot is not a question it can answer.
Giving it the answer means giving it the whole document, which is the second applier design
034 rejected.

**Reachability is not an exception to that.** Authority is the path, and a target with no path
has no authority to check rather than an authority that fails. It falls out of resolving the
path and costs nothing extra. It is also what makes design 009's dependent-refusal property
work: a commit that depended on a refused commit to give it a path is refused as unreachable,
with no bookkeeping about which commit went before.

**Ambiguity is a refusal rather than a guess.** A commit that gives an observable a second
attach edge has, per design 010, no defensible tie-break, since deltas in a commit are
unordered. A validator that picked one of the two paths would authorize against a path that
may not be the one that lands, and an actor could choose which rule governs an object by
attaching it twice. So the ambiguity itself is the refusal, and the applier refuses the same
commit for the same stated cause a moment later.

**A verdict that promised more would be a lie.** `ok` means authorized, not applicable. The
alternative, checking everything so `ok` means "this will apply", needs the whole document and
gets `schema` a copy of `core` inside it.

## What this costs

A server writes two checks rather than one, and a commit that is authorized but malformed is
refused at the second. That path is a developer error or a hostile client, never an ordinary
race, so the extra step lands where it costs least.

## What would reverse this

`sync` finding it cannot present the two refusals to an application as one thing. The fix then
would be a shared refusal shape rather than a validator that duplicates the applier.
