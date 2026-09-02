# @aweftjs/schema

Commit validation and mutation authority: who may write what, decided by path.

A commit arrives from somewhere you do not control. Before it is applied, this answers one
question about it: may this actor make this change. The answer is decided by where each
delta lands in the document and by a policy written as data, and a commit is authorized whole
or refused whole.

An authenticated client is not an authorized one. Nothing is granted by default, so a policy
with a gap in it refuses rather than permits.

## Quickstart

A commit is what arrived on the wire. On the sending side it is what a watcher handed you;
on the receiving side it is what came out of the decoder. Both are the same shape:

```ts
observer(clientDoc).watch((change) => send(encodeCommit(change)));  // one commit, on the wire
const commit = decodeCommit(bytes);                                 // and off it again
```

An actor is who is speaking, and it comes from the connection, never from the message.
`validate` believes `actor.id`: whoever calls it has already decided who this is. Reading the
id out of the client's own message would let anyone claim to be anyone, which is the whole
point of the line above.

`actor.id` is compared against a path step exactly as written, so it is whatever the document
names this actor by: `textIdOf(record)` when members are filed in a map by their own id, or
the key itself when they sit in an object.

```ts
import { decodeCommit, encodeCommit } from '@aweftjs/codec';
import { apply, createObject, idOf, observer, textIdOf } from '@aweftjs/core';
import { ANY, REST, SELF, createIndex, record, validate } from '@aweftjs/schema';
import type { Policy } from '@aweftjs/schema';

const doc = createObject();
const index = createIndex(idOf(doc));

const policy: Policy = [
	// Anyone may write their own record, and everything under it.
	{ effect: 'allow', path: ['users', SELF, REST] },
	// Anyone may set any post's title, and nothing else about a post.
	{ effect: 'allow', path: ['posts', ANY, 'title'] },
	// Nobody may touch a verified flag, whatever else they were granted.
	{ effect: 'deny', path: ['users', ANY, 'verified'] },
	// A moderator may write anything the deny above does not cover, because it does not.
	{ effect: 'allow', path: [REST], roles: ['moderator'] },
];

const actor = { id: textIdOf(memberRecord) };  // who the connection authenticated

const verdict = validate(commit, { index, policy, actor });
if (verdict.ok) {
	apply(doc, commit);   // the applier decides whether it is well formed
	record(index, commit);  // fold it in, after it applied, never before
} else {
	for (const reason of verdict.reasons) console.warn(reason.code, reason.message);
}
```

`validate` never mutates anything and never throws for a refusal. It throws only for a policy
that cannot mean what it says.

## A policy is patterns over paths

A rule names the paths it is about. A path is the slot names from the document root down, so
the `title` slot of the post at `posts/p1` is `['posts', 'p1', 'title']`.

| step | matches |
|---|---|
| a string | that exact step |
| `ANY` | any one step |
| `SELF` | one step equal to `actor.id` |
| `REST` | every remaining step, including none. Only ever the last step |

Without a trailing `REST`, a pattern matches that slot and nothing under it: `['a', 'b']`
covers the `b` slot of `a` and not `a/b/c`. With one, `['a', REST]` covers the `a` slot and
everything below it.

Steps are strings and plain objects, so a policy survives `JSON.stringify` and comes back
meaning the same thing. `ANY`, `REST` and `SELF` are those objects, exported so you do not
have to write them out.

An object slot is named by its key and a map slot by the identity in text form, so both can
be written literally. An array slot is named by its position in hex, which nothing stops you
writing literally and which you should not: a position is chosen by whoever inserted, and it
is a different string after an unrelated edit. Reach array slots through `ANY` and `REST`, and
if you need an authority boundary inside a collection, put those elements in a map or an
object where the key is yours to choose.

A wildcard matches every slot, including one whose name begins with an underscore. That
convention makes a slot private from wildcard *observers*, which is a delivery rule; it is not
an authority rule, and a `_` slot is ordinary state that still has to have an owner. So
`['users', SELF, REST]` grants `_internal` along with everything else. Design 039 has the
reasoning.

## Nothing is granted, and a deny wins

A delta is authorized when at least one `allow` rule matches it and no `deny` rule matches
it. Order does not matter: a deny cannot be undone by an allow written later, and an allow
cannot escape a deny written earlier. Policies grow by having rules appended, and this is
what stops an append from silently widening or killing what is already there.

`effect` is required. Allowing everything is a rule you have to type:

```ts
const trusted: Policy = [{ effect: 'allow', path: [REST] }];
```

`roles` narrows a rule to actors holding one of them, and `types` narrows it to some of
`add`, `replace` and `remove`. Omit either and it does not narrow.

`roles` narrows a deny exactly as it narrows an allow: `{ effect: 'deny', path, roles }`
refuses only actors holding one of those roles, and an actor holding none is reached by no
role-scoped rule at all. What a deny cannot do is be reopened: no allow written anywhere
survives a deny that matches. So there is no "deny everyone except", and a field that only
some actors may write is **granted** to them and not covered by a wider grant:

```ts
{ effect: 'allow', path: ['notes', ANY] },                                  // start a note
{ effect: 'allow', path: ['notes', ANY, 'title'] },                         // anyone
{ effect: 'allow', path: ['notes', ANY, 'pinned'], roles: ['moderator'] },  // moderators
```

`['notes', REST]` instead of the two narrow allows would hand `pinned` to everyone, because
two allows are still an allow. Reach for a subtree grant when the whole subtree really does
have one authority.

```ts
// Comments can be written and edited by their author, and removed by nobody.
{ effect: 'allow', path: ['comments', SELF, REST], types: ['add', 'replace'] }
```

## Three refusals, and what they mean

```ts
if (!verdict.ok) for (const { code, path, message } of verdict.reasons) ...
```

| code | when |
|---|---|
| `unauthorized` | the policy does not allow that delta's path, or denies it |
| `unreachable` | the delta's target has no attach path from the root |
| `multiple-attach` | the delta would leave an observable in two places, so no path decides it |

There is one reason per refused delta, so a policy with a gap in it shows you every path it
missed rather than the first.

Reachability counts the commit's own attachments, so a whole new subtree arriving in one
commit is judged at the paths that commit gives it, and its own detachments, so an observable
a commit takes out cannot be written to in the same breath. A commit that depended on a
refused commit to give it a path is refused as unreachable with no bookkeeping about what
went before.

## What this does not decide

Whether the commit can be applied. A slot that is occupied when the delta says `add`, a slot
that is empty when it says `replace`, one observable called two kinds: those need the
document's values, and an authority index holds attach edges and nothing else. So an
authorized commit still goes through the applier, and a refusal from either refuses the
commit. Neither closes the connection.

`unreachable` and `multiple-attach` are the applier's own words, deliberately. Neither layer
lets past what the other would refuse for one of those two causes, and that is checked on a
real commit stream rather than intended. The stated cause can still differ when a commit
breaks two rules at once, because the applier can see things an authority index does not, such
as whether a slot is already taken. Design 037 states it exactly.

## A move re-homes authority

Authority is the attach chain, so moving an object changes which rules govern it. An actor
who may take an object out of a collection may put it where their own rules govern it, in the
same commit, and a rule about its old path stops applying:

```ts
{ effect: 'allow', path: ['tasks', ANY] },                              // anyone may remove a task
{ effect: 'allow', path: ['tasks', ANY, 'archived'], roles: ['admin'] },
{ effect: 'allow', path: ['users', SELF, REST] },
```

One commit that removes `tasks/t1`, attaches the task under `users/<them>`, and sets
`archived` is **authorized**, because at the path that commit gives it the flag is inside
their own subtree. The same write in place is refused.

The guard is the removal, not the field. Granting an actor the power to take something out of
a shared collection is granting them the power to take it somewhere else, so grant removal
where objects are genuinely theirs to take, and not where a rule about a field is the only
thing protecting it. Design 010 has the model: a move needs remove authority at the old
parent and add authority at the new one, and nothing else decides.

## Detaching is not deleting

An observable with no attach edge is owned by nobody, so any actor who may write a slot may
attach it there and becomes the only actor who may write it after that. Authority is the
chain of attach edges and nothing else, which is what makes "where does this live" a walk up
rather than a search, and it means authority does not linger where something used to be.

So taking an item out of a list leaves its contents alive and adoptable by anyone who learns
its id. If a policy has to stop content coming back, remove the content, not only the edge
that reached it. Design 036 has the reasoning and the alternative it rejected.

## The index, and the one contract you have to keep

`createIndex(rootId)` starts empty. `record(index, commit)` folds in one commit, and it goes
**after** the commit was applied:

```ts
if (verdict.ok) {
	apply(doc, commit);
	record(index, commit);
}
```

Recording a commit the applier refused leaves the index describing a document that does not
exist, and the symptom is an authority answer about a path that is not there. `record` throws
`multiple-attach` on the one breach it can see for itself; the rest is this contract.

`pathOf(index, id)` is where an observable lives, or undefined when nothing attaches it. A
detached observable stays in the index, so the index grows the way the document does.

**Bootstrapping.** An index is fed commits, and a server that builds its own document mutates
rather than applies, so wire the watcher **before** the first mutation and record what it
hands you:

```ts
const doc = createObject();
const index = createIndex(idOf(doc));
observer(doc).watch((change) => record(index, change));  // before anything is written

atomic(() => { doc.users = createMap(); doc.tasks = createMap(); });
```

Wire it late and the index silently lacks paths for whatever it missed, and the symptom is an
authority answer about a path that is not there. A document restored from a snapshot rather
than from its history has no commits to replay, so say it as one: a commit of `add` deltas,
one per slot, fed to `record`. There is no entry point for that yet, because nothing needs one
until something persists a document.

**Do not send a client back the commit it sent you.** It already applied it locally, and
applying it a second time gives whatever it attached two attach edges. Broadcast an accepted
commit to every replica except the one it came from.

Measured on the shipped code with `bench/authority.ts`, against a document of 30,941
observables at depth 4: finding where a leaf lives costs 0.334 us, deciding a one-delta commit
costs 0.513 us against one pattern and 0.669 us against twenty, and taking a 2,380-entry
branch out of the document or putting it back is one commit at 0.564 us. The measurements
behind the design, the per-commit rebuild that costs 57,486 us and the path cache that costs
1,098 us to move that same branch, are in design 034.

## Boundaries

This package knows about commits and paths. It does not know about transport, storage, or the
runtime that holds the document: it never imports `@aweftjs/core`, and a validator never
touches a live tree. That is what lets the server side judge a commit before deciding whether
to build anything from it.

Deliberately not here: read authority. Everything above is about who may **write**. Filtering
what an actor may read is not decided.

The reasoning is in `docs/design/` designs 009 to 012 and 032 to 035, and a multi-actor
program using all of the above is in `examples/schema/`.
