# aweft replication protocol, v1

Status: not frozen. No deployed implementation depends on it yet. Changes go in
`spec/CHANGELOG.md`. v1 replaces v0 whole: v0 had a host and a client, and this protocol has
two equal ends (design 053).

This document specifies what two ends of a replication link say to each other. It builds on
`spec/format.md`, which specifies the commit; nothing here changes a commit.

The key words **MUST**, **MUST NOT**, **SHOULD** and **MAY** are used as in RFC 2119.

`spec/frames/` is the normative fixture corpus. Where this prose and a fixture disagree, the
fixture is correct.

## 1. The link

A link carries **frames** in order between two ends. A frame is a value; whether it is bytes
is a property of the transport (section 6). The two ends are equal: each runs the same
protocol, and nothing in it says which end is which.

- A link **MUST** deliver every frame it accepts, in the order it accepted them, or end.
- A link **MUST NOT** reorder, drop or duplicate a frame. The protocol detects nothing and
  repairs nothing at this level: a link that cannot keep this promise ends, and a new link is
  a new conversation.
- Delivery **MUST NOT** be synchronous with the send. A receiver applies commits, and applying
  a commit from inside another document's delivery breaks the ordering the receiver rests on.
- Nothing resumes. When a link ends, everything about it is forgotten at both ends. Opening a
  new one, and sharing again on it, is the application's.

## 2. Topics

A link carries any number of documents. Each is a **topic**, named by a string the
application chose and numbered by each end independently.

- An end numbers the topics it opens, starting at 1, unique on that link for as long as the
  link lives. A number is never reused on one link.
- A frame names a topic by **the sender's number** for it, with one exception: a `fault` that
  answers a frame names the topic by the number that frame carried, which is the other end's,
  because the other end is the one that has to find the topic that ended. Each end therefore
  keeps two maps: its own numbers, and the numbers the other end announced with `open`.
- An `open` is the only frame that carries a name. It states the sender's number, the name,
  the sender's root id and kind, and whether the sender `want`s the other end's state. An end
  that holds nothing under the name states no root (both null) and **MUST** set `want`.
- Two ends that both hold nothing under a name each answer the other's `open` with `fault`
  naming `no-document`, and the topic never becomes live. Nothing waits in silence.
- A topic is **live** at an end once that end has both shared the name and received the
  other end's `open` for it. An end **MUST NOT** send `commits` or `state` for a topic that
  is not live.
- An `open` naming a root id that differs from the root id this end shares under that name
  **MUST** be answered with `fault` naming `root-mismatch`, and the topic never becomes live.
  Two documents are only ever kept in step when they are one document.
- An end sets `want` only when it holds nothing for that name: a document it minted from the
  other end's root, or one it has chosen to throw away. An end that receives `open` with
  `want` true **MUST** answer with `state` once the topic is live.
- Commits an end made before the topic was live are sent when it becomes live, as ordinary
  `commits`, unless the other end asked for state, in which case the `state` covers them and
  they are not sent.
- `leave` ends a topic at both ends. A frame about a topic that is not open **MUST** be
  answered with `fault` naming `no-topic`, and the link carries on.

## 3. Sequence numbers

Each end numbers the commits it sends on a topic, starting at 1. A `commits` frame states the
sequence of its first commit; the rest follow in order. The numbers exist so a `refused` can
name a commit. They are not used to detect loss: a link delivers in order or ends (section 1).

## 4. What an end does

- On `commits`: for each commit in order, ask the application whether to accept it, then
  apply it. A commit that is not accepted, or that the applier refuses, is **reported to this
  end's application** and answered with `refused` naming its sequence and the reasons. The
  next commit in the frame is still applied. A refusal refuses the commit and never the link.
- On `state`: move this document to the state the frame describes, applying the difference
  against what it holds. A receiver **MUST NOT** replace its document, and **MUST** drop
  anything it holds that the state does not mention. A `state` with no commit means the other
  end's document is empty.
- On `refused`: report it to this end's application, with the commit and its inverse when
  this end still holds them. An end keeps a bounded window of the commits it sent; a refusal
  naming a commit outside the window is reported with its sequence only.
- On `leave`: forget the topic. On `fault`: report it; a `fault` naming a topic ends that
  topic, a `fault` naming topic 0 ends the link.
- A commit that arrived over a link **MUST NOT** be sent back over the same link. It **MUST**
  be delivered to every other consumer of the document (another link, a store, a watcher) as
  an ordinary commit made at this end (design 055).
- The protocol never decides which end yields when two ends conflict. That is the
  application's, and it acts by asking for the other end's state: an end MAY send `open`
  again for a live topic with `want` true, and the other end answers with `state`.

## 5. Frames

A frame is an array. Element 0 is the kind, as an integer. The encoding of every element is
`spec/format.md` section 6.

| kind | frame | elements |
|---|---|---|
| 0 | `open` | topic, name, root id, root kind, want |
| 1 | `state` | topic, commit or null |
| 2 | `commits` | topic, first, list of commits, each as bytes |
| 3 | `refused` | topic, seq, list of reasons |
| 4 | `leave` | topic |
| 5 | `fault` | topic, reason, message |

- A root kind is 0 for object, 1 for array, 2 for map. In an `open` the root id and kind are
  both null when the sender holds nothing; one null without the other is `bad-frame`, and so
  is no root without `want`. `want` is a boolean. Topic numbers are integers from 1; topic 0
  in a `fault` means the link itself.
- A reason is `[code, message, path or null]`, where a path is a list of text steps. Codes
  are the apply-stage vocabulary of `spec/format.md` section 7, or whatever the application's
  `accept` gave.
- In `refused`, `topic` is the refusing end's number and `seq` is a sequence the other end
  assigned (section 3).
- A `commits` frame **MUST** carry at least one commit; a `refused` at least one reason.
- A frame with the wrong number of elements for its kind, an unknown kind, or an element of
  the wrong type **MUST** be refused with the reason `bad-frame`.
- Frames **MUST NOT** be compressed one at a time. Measured on a real commit stream, gzip per
  frame is larger than the frames themselves. Use the transport's shared-context compression.

A receiver **MUST** treat a frame that does not decode as the end of the link, not as an
exception to raise into a delivery.

## 6. Transports

A frame is a value. A transport that carries values (an in-process pair, a structured-clone
port) carries frames as they are; a transport that carries bytes encodes each frame with
section 5 and `spec/format.md` section 6. Both are the one protocol.

## 7. Not specified

- **Authority.** Nothing here says who may write what. An end's `accept` is the application's
  and the protocol does not know what it checks.
- **Who yields.** Section 4, last item.
- **Resuming.** Section 1, last item.
- **Application messages.** A link carries commits and nothing else.
- **Read filtering.** Every end sees the whole document it shares.
