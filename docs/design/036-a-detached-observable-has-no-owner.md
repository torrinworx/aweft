# 036: An observable nothing attaches has no owner, and authority does not linger

Superseded by design 057. Core still keeps a detached observable (design 048).

## Decision

Authority over an observable is the chain of attach edges from the root to it, and nothing
else, including nothing about where it used to be. So an observable that has lost its attach
edge is owned by nobody, and any actor who may write a slot may attach it there and becomes
the only actor who may write it from then on.

Detaching is therefore not deleting. A policy that has to stop content coming back removes the
content, not only the edge that reached it.

## Why

This is design 010 with nothing added: it says authority is decided by the single chain of
attach edges "and by nothing else". Making a former parent count would be adding something
else, and the something else would have to be remembered forever, per observable, for as long
as detached observables stay in the index.

The alternative was considered and rejected on what it costs. Keeping a former parent beside
every detached observable would mean:

- **A second authority rule with different reach.** An actor could be refused an attach for a
  reason that is not on any path in the document, which is not readable from the policy and
  not visible in the tree. The whole point of the path model is that the answer is somewhere a
  person can look.
- **A rule that decays.** After a re-attach and a second detach, which former parent counts?
  Answering means a history, and a history is the thing design 034 kept out of the index.
- **No protection where it matters anyway.** An actor who can attach an orphan can already
  read it, because nothing filters reads. The content was reachable before the detach and the
  bytes did not move.

## What this costs

Removing an item from a list leaves its contents alive and adoptable by anyone who learns its
id, until something collects it. An application that treats a detach as a delete is wrong
about that, so the README says so where a reader meets it rather than here.

## What would reverse this

Read filtering landing and making an orphan's contents genuinely unreadable to an actor who
could adopt it. Then adoption would be a way to read what a policy
refused, and the answer would be a rule about what may be attached rather than a rule about
what used to be where.
