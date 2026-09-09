# 045: A session resumes by id, and a host keeps a bounded window of recent commits

Superseded by design 053: nothing resumes.

## Decision

A host mints a session id and sends it with the answer to a join. A client presents it when
it joins again, and the host answers with how far it had got in deciding that client's
commits, so the client replays exactly what did not land.

A host keeps the last 256 commits per topic and the last 1,000 disconnected sessions. Both
are configurable. A client whose gap is inside the window is sent the commits it missed; one
outside it is sent the document.

## Why

**Without it a reconnect loses work.** A client cannot know which of its in-flight commits
the host applied, because channel position does not survive the reconnect. Its choices are to
replay them all, which applies some of them twice, or to drop them all, which loses edits on
every network blip. The session id is the smallest thing that makes the third answer possible.

**A host matches the session to the actor** before believing it, so presenting somebody
else's session id gets a client nothing it did not already have: authority still comes from
the connection. A session record is not consumed when it is presented, either: every topic on one
connection carries the same session id, so consuming it on the first would leave the rest to
replay commits the host had already applied and be told a landed write was refused.

**A verdict in flight when the link dropped is lost.** The host remembers how far it got, not
what it decided, so a commit refused in the moment the link went is dropped without a report.
The document is still made right, because the client reconciles on the way back in. Recording
verdicts across a disconnect would be a log per session, which is storage, and storage is not
this package.

**The window is bounded and local.** 256 commits covers the outage a network blip produces
and costs a few hundred kilobytes on a busy topic. Nothing about it is on the wire, so it can
change without migrating anything.

## What the suite pins

The two guarantees above are the most security-relevant lines in the package: a host matches
the session to the actor before believing it, and a session record is not consumed when it is
presented. `packages/sync/tests/edges.test.ts` holds both, and both go red when either line
goes.

## What a remembered session holds

A session record keeps the documents its topics were on alive for as long as it lasts, so a client
that comes back inside the window still finds the commits it missed. When the bound drops the
record, whatever it was the last thing holding is let go: the watch on the document stops and the
window of recent commits goes with it. A host whose `resolve` opens a document per name would
otherwise grow for as long as it runs.

## What would reverse this

A `store` that holds a document's commit history, which makes the window a cache in front of
it rather than the whole of what a host can replay.
