# aweft state format, v0

Status: draft. Normative, and not yet frozen.

This document defines how a change to observable state is described, grouped, and encoded
so that an implementation in any language can produce and consume it. It is a specification
with conformance fixtures, not a description of one library's behavior.

Keywords **MUST**, **MUST NOT**, **SHOULD**, and **MAY** are used in the usual sense.

---

## 1. Model

State is a tree of **observables**. Three kinds exist:

| Kind | Keyed by | Ordering |
|---|---|---|
| object | string key | none |
| array | position | dense, ordered |
| map | identity | none |

Every observable carries an **id**, unique within a document. Ids are how two replicas
agree on which observable a change refers to without agreeing on where it sits in the tree.

A **delta** describes one change to one slot in one observable. A **commit** is a set of
deltas that took effect together.

---

## 2. Deltas

A delta has a type, a target, and a value.

```
delta = {
	type : "add" | "replace" | "remove"
	id   : observable id        the observable the change happened in
	ref  : reference            which slot within it
	value: any                  absent for remove
}
```

### 2.1 Types

- **add**: the slot did not exist and now holds `value`.
- **replace**: the slot existed and now holds `value`.
- **remove**: the slot existed and now does not. `value` **MUST** be absent.

### 2.2 The target is `id` plus `ref`, never a path

An implementation **MUST** address a delta by the id of the observable and a reference
within it. It **MUST NOT** address a delta by a path from the document root.

*Rationale, measured:* a delta produced by coalescing a remove and a re-add within one
window can have no position in the tree at the moment it is described, because the
observable it refers to was detached and reattached during the window. Path resolution on
such a delta has no defined answer. Addressing by id has one, always.

### 2.3 `ref` is polymorphic and **MUST** be discriminated by the encoding

| Observable kind | `ref` is |
|---|---|
| object | a string key |
| array | a position identifier, ordered relative to its siblings |
| map | an identity value |

An encoding **MUST** make the three distinguishable without consulting the observable being
addressed, because a receiver may process a delta for an observable it has not yet
materialized.

### 2.4 Prior values are not carried

A delta **MUST NOT** carry the value the slot held before the change.

*Rationale, measured:* the receiver reconstructs the prior value from its own state while
applying, so on the wire it is derivable data, and derivable data carried alongside its
source is a way for two things to disagree. Carrying it measured at **+40.2% gzip** on a
representative editing stream, against **+12.7%** for the per-commit integrity tag in
section 3.3, which provides the divergence detection that was the actual motivation. A
per-delta hash of the prior value was also measured and is worse than both at **+45.0%**,
because hashes do not compress and the values they replace do.

Implementations that need an inverse **MUST** compute it locally, where the prior value is
available for free.

---

## 3. Commits

A commit is an unordered set of deltas that took effect together.

### 3.1 A commit is the unit that crosses every boundary

An implementation **MUST** transmit, persist, and validate whole commits. It **MUST NOT**
split a commit across messages, and **MUST NOT** apply a commit partially.

*Rationale, measured:* a consumer that rebuilds state by applying deltas one at a time
observes intermediate states in which invariants spanning two slots are false. Applying the
same deltas as one commit does not, because every delta is validated, then every delta is
applied, then observers are notified once. Splitting a two-delta commit into two
applications was measured to expose a broken invariant; applying it whole did not.

### 3.2 Deltas within a commit are order-independent

A receiver **MUST** produce the same state regardless of the order in which it applies the
deltas of one commit.

A commit **MUST NOT** contain two deltas addressing the same `(id, ref)`.

*Rationale, measured:* 2,700 commits containing 16,515 deltas were applied in generated,
shuffled, and reversed order across objects, arrays, maps, nested observables and shared
references, with no divergence in any order and no duplicate `(id, ref)` pair observed in
any commit.

### 3.3 Integrity tag

A commit **MAY** carry an integrity tag: a short digest over the prior values of the slots
it addresses, computed by the sender against its own pre-commit state.

A receiver that supports tags and computes a different tag **MUST** treat the replicas as
diverged. It **MUST NOT** attempt to repair by inference; divergence is resolved by
resynchronizing.

The tag detects that a commit landed on state the sender did not expect. It does not
identify which delta diverged, and is not required to.

### 3.4 Commit scope is one document

A commit **MUST NOT** span two documents.

*Rationale:* atomicity across documents is available on some storage backends and not on
others. A commit whose atomicity depends on where it is stored has semantics that change
with deployment, which is worse than a narrower guarantee that holds everywhere.
Invariants spanning two documents belong to the layer above this one.

---

## 4. Ordering between commits

Commits **MUST** be applied in the order the sender emitted them.

Coalescing is safe only within one emission window. An implementation **MAY** merge changes
into a single commit before emitting it, subject to section 5.

---

## 5. Coalescing

An implementation **MAY** merge multiple changes to state into one commit before emitting
it. If it does:

1. It **MUST NOT** drop a change to a slot that no other merged change addresses.
2. It **MUST** merge changes to the same slot into the net effect over the window.
3. It **MUST** omit a slot whose net effect over the window is no change.

*Rationale, measured:* rule 1 is the one that gets violated in practice. A coalescing
strategy that keeps the first and last change of a burst and discards what falls between
was measured silently dropping a change to a slot nothing else in the burst touched. A
strategy keyed by slot, merging only within a slot, was measured lossless across 2,700
commits and 16,515 deltas.

A conforming implementation **SHOULD** key its merge structure by slot rather than by time,
because the two rules above then hold by construction rather than by care.

---

## 6. Encoding

The wire encoding is defined by the conformance fixtures in `spec/fixtures/`. An
implementation conforms when it can decode every fixture to the described state and encode
the described state to a byte-equal fixture.

Fixtures are the normative artifact. This prose describes intent; where they disagree, the
fixtures are correct and the prose is a defect.

---

## 7. Conformance

An implementation conforms when:

1. It decodes every fixture in `spec/fixtures/` to the state each describes.
2. It encodes each fixture's state to bytes equal to the fixture.
3. It applies each fixture's commits in generated, shuffled, and reversed order to the same
   final state.
4. It rejects each fixture in `spec/fixtures/invalid/` with the stated reason.

---

## 8. Open

Not yet specified, and deliberately not guessed:

- The concrete byte encoding. Section 6 defers to fixtures that do not exist yet.
- The id scheme. See `spec/identity.md`.
- Whether the integrity tag algorithm is fixed by this specification or negotiated.
