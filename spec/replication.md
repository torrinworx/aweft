# aweft replication protocol, v0

Status: not frozen. No deployed implementation depends on it yet. Changes go in
`spec/CHANGELOG.md`.

This document specifies what two sides of a replication link say to each other. It builds on
`spec/format.md`, which specifies the commit; nothing here changes a commit.

The key words **MUST**, **MUST NOT**, **SHOULD** and **MAY** are used as in RFC 2119.

`spec/frames/` is the normative fixture corpus. Where this prose and a fixture disagree, the
fixture is correct.

## 1. The link

A link carries **frames** in order. A frame is a value; whether it is bytes is a property of
the transport (section 6).

- A link **MUST** deliver every frame it accepts, in the order it accepted them, or end.
- A link **MUST NOT** reorder, drop or duplicate a frame. The protocol detects loss and does
  not repair it: it resynchronizes.
- Delivery **MUST NOT** be synchronous with the send. A receiver applies commits, and applying
  a commit from inside another document's delivery breaks the ordering section 4 rests on.

One side is the **host**. It owns the documents and its order is the order every replica ends
in. The other side is a **client**.

## 2. Topics

A link carries any number of documents. Each is a **topic**, named by a string the application
chose and numbered by an integer the client chooses when it joins.

- The number **MUST** be unique on that link for as long as the topic is joined.
- Every frame except `join` names its topic by the number and **MUST NOT** carry the name.
- A host **MUST** answer a `join` with `joined` or with `fault`.
- A `fault` in answer to a `join` **MUST NOT** end the link.
- A `join` naming a topic number the link already holds, with the same name, is a request to
  start that topic again: the host answers it like any other join and the topic keeps its
  member. With a different name it is a mistake, and the host **MUST** refuse it with
  `topic-in-use`.
- A client that has lost its place **MUST** `leave` the topic and join it again presenting no
  session, rather than joining with a `have` of zero while still a member. A host cannot tell
  "I hold nothing" from "I have lost my place" by a count alone, and answering the second by
  replaying commits the client already applied is an endless conversation, not a recovery.
- A host **MUST NOT** serve one document under two different authorities. A second join
  resolving the same document with a different policy is refused with `policy-mismatch`,
  because otherwise whichever join arrived first would decide what everyone after it may
  write.

## 3. Sequence numbers

Two independent counters per topic, both starting at 1.

- The **client sequence** numbers the commits a client sends. A `commits` frame from a client
  states the sequence of its first commit; the rest follow in order.
- The **topic sequence** numbers the commits a host publishes for a topic. It counts every
  commit the host accepted or made, including ones it does not send back to the client that
  made them.

A host **MUST** refuse a `commits` frame whose `first` is not the sequence it expects, with a
`fault` naming `out-of-order`, and **MAY** end the link.

An `accept` states `through`, the highest client sequence decided, and `at`, the topic
sequence the last of them was given. A client **MUST** take `at` as its position in the topic
stream: it is never sent its own commits back, so without it it would have a hole.

A host **MUST** send the `accept` for a commit before anything else it sends that client about
that topic afterwards. A host that writes in answer to a commit publishes that write while the
batch is still being processed, and a client told about that write before it learns where its
own commit landed sees a hole that is not there.

## 4. What a client does

A client applies its own commits at once and holds them until the host decides them.

- On `commits`: if `first` is not one past what it holds, the client **MUST** rejoin from
  zero. Otherwise it undoes its held commits newest first, applies what arrived, and redoes
  them oldest first. A commit that will not redo **MUST** be dropped and reported.
- On `accept`: drop the held commits through `through`, and take `at`.
- On `refuse`: undo back to the named commit, drop it, redo the rest. Report the dropped
  commits together, with their prior values.
- On `joined`: rebuild if the frame is `whole` (section 5), then replay everything the host
  has not decided.
- A commit this side gave up on **MUST** keep its place in the run until the host decides it.
  Taking it out leaves a hole, and the next frame then arrives out of order.
- A client that has asked for the whole document several times in a row without moving
  **MUST** stop asking and report it, rather than asking forever.

A client **MUST NOT** leave a refused change applied. A client **MUST NOT** be sent a commit
it sent.

## 5. Joining and resuming

`join` states the topic name, the number, how far along the topic sequence the client is, and
the session it is resuming, if any.

`joined` states how far the host had got in deciding that client's commits (`accepted`), where
the client now stands in the topic sequence (`seq`), whether the frame describes the whole
document (`whole`), the session id to present next time, the document's root id and kind, and
optionally a `reset`.

- `whole` and `reset` are separate fields on purpose. A host whose document is empty has no
  commit to send and still has to be able to say that the document is empty, or a replica
  holding stale content would keep it forever.
- A `reset` is the whole document as one commit of `add` deltas. It does not create the root:
  a receiver mints its root with the stated id and kind and applies the reset to it.
- A receiver of a `whole` frame **MUST** apply the difference between what it holds and what
  the frame says, rather than replacing the document, and **MUST** drop anything it holds that
  the frame does not mention.
- A host **MAY** answer without a `reset` when it can send the commits the client missed
  instead. It then states `seq` as the `have` the client asked with, and the missed commits
  follow as an ordinary `commits` frame.
- A host **MUST** match a resumed session to the actor it was minted for before believing it.

## 6. Frames

A frame is an array. Element 0 is the kind, as an integer. The encoding of every element is
`spec/format.md` section 6.

| kind | frame | elements |
|---|---|---|
| 0 | `join` | topic, name, have, session or null |
| 1 | `joined` | topic, accepted, seq, whole, session, root id, root kind, reset commit or null |
| 2 | `commits` | topic, first, list of commits, each as bytes |
| 3 | `accept` | topic, through, at |
| 4 | `refuse` | topic, seq, list of reasons |
| 5 | `leave` | topic |
| 6 | `fault` | topic, reason, message |

- A root kind is 0 for object, 1 for array, 2 for map. `whole` is a boolean.
- A reason is `[code, message, path or null]`, where a path is a list of text steps.
- A `commits` frame **MUST** carry at least one commit; a `refuse` at least one reason.
- A frame with the wrong number of elements for its kind, an unknown kind, or an element of
  the wrong type **MUST** be refused with the reason `bad-frame`.
- Frames **MUST NOT** be compressed one at a time. Measured on a real commit stream, gzip per
  frame is larger than the frames themselves. Use the transport's shared-context compression.

A receiver **MUST** treat a frame that does not decode as the end of the link, not as an
exception to raise into a delivery.

## 7. Refusals

- A refusal refuses the commit and never the link.
- A `refuse` carries one reason per delta that caused it. Codes are the authority vocabulary
  of `@aweftjs/schema` (`unauthorized`, `unreachable`, `multiple-attach`) and the apply-stage
  vocabulary of `spec/format.md` section 7.
- A host **MUST** send any pending `accept` before a `refuse`, so a client reads the two in
  the order the host decided them.

## 8. Not specified

- **Application messages.** A link carries commits and nothing else.
- **Forwarding.** A commit enters through exactly one authenticated hop, so no frame carries
  an originating actor. Server to server replication would need one.
- **Read filtering.** Everything here is about who may write. Whether anyone ever sees less than the whole document is not decided.
- **How long a host remembers.** The window of recent commits and of disconnected sessions is
  local to a host and observable only as whether a `reset` arrives.
