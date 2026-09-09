# 042: The replication envelope: topics by number, a sequence per frame, batching

Amended by design 053: topics by number and batching per tick stand; the accept ordering rule
and the session id went with the host.

## Decision

- **A link carries many documents.** Every frame names its topic by a small integer agreed
  when the topic was joined. The name an application wrote rides on the join frame and
  nowhere else.
- **A commits frame states the sequence number of its first commit.** The client numbers what
  it sends; the host numbers what it publishes for a topic. An accept says how far the host
  got in both numberings, because a commit is never sent back to whoever made it and the
  sender would otherwise have a hole in its count.
- **A frame carries one or more commits.** Commits made in one tick go in one frame. This is
  batching and never rate limiting: every commit still goes, in order, in the tick it was
  made.
- **The frame carries no actor.** Authority comes from the connection, which is where the
  caller authenticated it.
- **An accept goes out before anything else that client is told afterwards.** The accept is
  owed from the moment the commit is numbered, which is before a host-side watcher writing in
  answer to it can publish.
- **A `joined` frame says whether it describes the whole document**, as a field of its own
  rather than by carrying a reset.

## Why

Measured with `bench/replicate.ts` on 1,840 commits of a board-shaped edit stream, against the
commit bytes alone:

| shape | raw | gzip, whole stream | frames |
|---|---|---|---|
| the topic name on every frame | +29.5% | +27.0% | 1,840 |
| one commit per frame | +15.5% | +26.1% | 1,840 |
| four per frame | +6.5% | +10.9% | 460 |
| sixteen per frame | +4.3% | +5.8% | 115 |
| sixty-four per frame | +3.7% | +4.4% | 29 |

A hand-rolled byte layer was measured beside these: a varint
header of kind, topic and sequence cost +7.2% raw against the value encoder's +15.5%, and
dropping the sequence from it took that to +3.7%. Both were rejected, the first because two
points at a batch of sixteen does not pay for a second decoder to specify and fuzz, and the
second because a frame that cannot say where it belongs finds a hole at the next accept
rather than at the frame that caused it.

- **The topic is a number.** A string on every frame is the largest avoidable cost measured.
- **The sequence stays**, at about two bytes a frame, because a frame that states where it
  belongs catches a hole at the frame that caused it rather than at the next accept, and the
  compressed share it costs only shows on an unbatched stream, which is not bandwidth bound.
- **Batching is what pays.** It is also the only thing that fixes per-frame compression, which
  is a loss at commit size: gzip a frame at a time is 116,532 bytes against 104,945 raw,
  because a frame of a few dozen bytes cannot amortize a gzip header. Turn on the transport's own
  shared-context compression instead.
- **No byte layer of its own.** One encoding, owned by tier 1, for the reason above.

**What a reconnect needs.** A per-client sequence that survives it: the client numbers its
own commits and the host echoes the last it decided, in the join answer. The originating actor
once a commit arrives through more than one hop is not carried, because a host reads the actor
from the connection and forwarding is not built; that question stays open against `store`,
which is what has to record the actor beside a stored commit.

## Two things an earlier shape got wrong

Both are now cases in the corpus.

**The accept was accumulated across a batch and flushed at the end.** A host-side watcher
writing in answer to a commit publishes while the batch is still running, so the client heard
about that write before it heard where its own commit landed, saw a hole in the topic stream
that was not there, and asked to start over. That request was answered with a replay of
commits it had already applied, which threw, which made it ask again: 501 requests in 4,000
microtask turns, with the event loop starved so no timer could ever fire. The trigger is the
action pattern `docs/architecture.md` prescribes, so it was not an exotic shape.

**`reset` present meant "this is the whole document".** A host whose document is empty has no
commit to send, so a replica holding stale content was never told to drop it. `whole` is now
its own field.

## What would reverse this

A workload where the envelope is a material share of bandwidth, measured against a shared
context compressor rather than per frame. Or forwarding between hosts, which is what makes
the originating actor a field rather than a property of the connection.
