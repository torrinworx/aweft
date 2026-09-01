# aweft state format, v0

Status: draft. Normative, and not yet frozen.

This document defines how a change to observable state is described, grouped, and encoded
so that an implementation in any language can produce and consume it. It is a specification
with conformance fixtures, not a description of one library's behavior.

Keywords **MUST**, **MUST NOT**, **SHOULD**, and **MAY** are used in the usual sense.

---

## 1. Model

State is a graph of **observables**. Three kinds exist:

| Kind | Keyed by | Ordering |
|---|---|---|
| object | string key | none |
| array | position | dense, ordered |
| map | identity | none |

Every observable carries an **id**, unique within a document. Ids are how two replicas
agree on which observable a change refers to without agreeing on where it sits in the tree.

A **delta** describes one change to one slot in one observable. A **commit** is a set of
deltas that took effect together.

### 1.1 Attach edges and aliases

A slot may hold a reference to another observable, and every reference states which kind of
edge it is:

- an **attach** edge means the observable *lives* there
- an **alias** names it without giving it a home

Every observable reachable from the root has **exactly one** attach edge. The attach edges
form a tree, and the aliases are what make the whole thing a graph.

An implementation **MUST** refuse a commit that would give an observable a second attach
edge. That includes a commit adding two attach edges to one observable, because deltas within
a commit are unordered and there is no defensible way to choose between them.

An implementation **MUST** refuse a delta whose target has no path of attach edges from the
root. Reachability is computed against the document before the commit, extended by the attach
edges the commit adds. Attach edges the commit **removes** are not counted, so a commit may
write into a subtree in the same breath as it detaches it.

Moving an observable is one commit that removes its old attach edge and adds the new one.
Both happen together, so it is never in two places and never in none.

*Rationale:* one attach edge means "where does this live" has a single answer, computed by
walking up rather than by searching. Without it the question is answered by enumerating an
observable's paths, and with aliases in the graph that count grows past any budget: a document
of 142 observables produced 36,507 paths, and one of about 2,000 exhausted a 4 GB heap. The
consequence for the layer above is that a reference can neither widen nor narrow who may write
what, which makes two classes of privilege bug unrepresentable. See `docs/design/010`.

### 1.2 An observable's kind is fixed

An observable is an object, an array or a map, and it is that one kind for as long as it
exists. Nothing changes an observable's kind.

Every mention of an id therefore has to agree about its kind: the `kind` on a reference that
names it, the kind implied by a `ref` addressing it, and the kind it already has in the
document. An implementation **MUST** refuse a commit in which two mentions of one id
disagree, including two deltas in the same commit that each introduce the id with a different
kind.

*Rationale:* section 6.4 carries the kind on the reference so a receiver can read a delta
about an observable it has not materialized yet. That only works if the kind is a fact about
the observable rather than an opinion of whoever wrote the delta. Without this rule a commit
can describe an id as an array in one delta and a map in another, and both readings are
defensible, so two implementations diverge without either being wrong.

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

A commit is encoded as a byte string that describes itself. The type set is small on
purpose: null, booleans, integers, one float width, byte strings, text strings, and arrays.
There are no maps and no tagged values.

Conformance is stated as byte equality, so the encoding has exactly one spelling for every
value. A decoder **MUST** refuse any input an encoder would not have produced, and the rest
of this section is that one rule applied case by case.

*Rationale, measured:* a text encoding cannot meet byte equality across languages. The same
double prints as `1e-7` from one runtime's JSON and `1e-07` from another's, so two
conforming implementations would write different bytes for one value. A byte encoding also
measured smaller on a representative editing stream of 2,000 commits and 10,431 deltas:
24.9% smaller raw, 11.0% smaller with each frame compressed alone, and 6.0% smaller with one
compression context across the stream. Size was the tiebreaker. The spelling problem was the
decision.

### 6.1 Heads

Every item begins with an initial byte: three bits of major type, five bits of additional
information. Additional information below 24 is the argument itself. The values 24, 25, 26
and 27 introduce a further 1, 2, 4 or 8 bytes, most significant first. The values 28 to 31
are not part of the format.

| Major | Holds |
|---|---|
| 0 | unsigned integer, the argument |
| 1 | negative integer, minus one minus the argument |
| 2 | byte string, the argument is its length |
| 3 | text string, the argument is its length in bytes |
| 4 | array, the argument is its number of items |
| 7 | `f4` false, `f5` true, `f6` null, `fb` float64 |

Majors 5 and 6 are not part of the format.

An encoder **MUST** write every head in the shortest form that holds its argument. A decoder
**MUST** refuse a wider one, **MUST** refuse an indefinite length, **MUST** refuse bytes
following the end of the commit, and **MUST** refuse an array whose stated length exceeds
the bytes remaining.

Nothing this format writes nests past four levels (a commit, its list of deltas, a delta,
a ref inside it). A decoder **MUST** refuse nesting past eight levels (`nesting-too-deep`),
so a hostile length cannot recurse a reader to death, while the format keeps room to grow
without re-freezing this rule.

### 6.2 Numbers

A number that is whole and within plus or minus 2^53 **MUST** be encoded as an integer, in
the shortest head that holds it. Every other finite number **MUST** be encoded as a float64.

A decoder **MUST** refuse an integer outside that range, which cannot be held exactly, and
**MUST** refuse a float64 holding a whole number inside it, because the integer form is the
one an encoder would have written.

NaN and the infinities have no encoding. Negative zero is written as zero: nothing in the
model tells the two apart, and a second spelling for one value is exactly what section 6
exists to prevent.

### 6.3 Text

Text is UTF-8. A string holding an unpaired surrogate has no encoding, and an encoder
**MUST** refuse it rather than substitute a replacement character. Substituting changes the
value on its way out, and the result still decodes cleanly, so nothing downstream can
notice.

### 6.4 Values

A value is a primitive or a reference to an observable. There is nothing else. An
implementation **MUST NOT** inline a structure into a slot.

```
reference = [ edge, kind, id ]
edge      = 0 attach | 1 alias
kind      = 0 object | 1 array | 2 map
```

*Rationale:* a structure inlined into a slot would be state that changes without a delta
addressing it, and every change to state is a delta. Carrying the kind on the reference,
rather than inferring it from the other deltas that mention the id, is what lets an
observable with no slots be fully described, and lets a receiver read a delta about an
observable it has not seen yet. The edge is section 1.1, and it costs one byte per reference,
measured at 0.26% of a representative raw stream and nothing measurable once compressed.

### 6.5 Refs

```
ref = [ kind, key ]
```

| Kind | Key is |
|---|---|
| 0 object | a text string |
| 1 array | a position, section 6.6 |
| 2 map | an id |

The kind is written rather than inferred. This is section 2.3 made concrete.

### 6.6 Positions

A position is a byte string, ordered as a byte string: bytes are unsigned, and a string that
is a prefix of another sorts before it.

A position **MUST** be non-empty and **MUST NOT** end in a zero byte. Both rules exist so a
position can always be produced between any two others. With a trailing zero allowed,
nothing fits between a key and that key followed by a zero, and the array acquires a place
it can never grow into.

How a position between two others is chosen is **not specified**. Any choice meeting the two
rules interoperates, because a receiver orders by comparing positions and never by
regenerating them.

### 6.7 Deltas

```
delta = [ type, id, ref ]           when the type is remove
delta = [ type, id, ref, value ]    otherwise
type  = 0 add | 1 replace | 2 remove
```

### 6.8 Commits

```
commit = [ deltas ]
commit = [ deltas, tag ]
```

`deltas` holds at least one delta. `tag` is a byte string of 4 to 32 bytes, section 3.3.

A commit with no deltas **MUST** be refused. Coalescing whose net effect is nothing emits
nothing at all, not an empty commit.

### 6.9 Canonical order

Within a commit, deltas **MUST** be written in ascending order of the encoding of the
delta's `id` followed by the encoding of its `ref`, compared as byte strings.

A decoder **MUST** refuse a commit whose deltas are in any other order, rather than sorting
them. Sorting would mean two byte strings decode to one commit, and re-encoding could then
not reproduce its input.

Because the order is strict, one comparison also enforces section 3.2's other rule: two
deltas addressing the same `(id, ref)` compare equal, and equal is not ascending.

### 6.10 Ids

An id is 12 bytes. See `spec/identity.md`.

### 6.11 What a commit does not carry

Left out deliberately:

- **Which document it belongs to.** Section 3.4 confines a commit to one document. Which one
  is the routing layer's business, and carrying it here would invite a commit to be read
  without its route.
- **Where it sits in a causal order.** Section 4 requires commits to be applied in the order
  the sender emitted them, which is a property of the channel, not of the commit.
- **A format version.** Versioning is negotiated once, not repeated on every commit. See
  `spec/CHANGELOG.md`.

---

## 7. Conformance

An implementation conforms when:

1. It decodes every fixture in `spec/fixtures/` to the deltas that fixture states.
2. It encodes those deltas to bytes equal to the fixture, whatever order they are handed to
   it in.
3. It applies each fixture's commits in generated, shuffled and reversed order, and reaches
   the document the fixture states.
4. It refuses each fixture in `spec/fixtures/invalid/`, **for the reason that fixture
   names**.

Point 4 is stricter than refusing somehow. A format whose implementations disagree about why
an input is invalid has not been specified, only implemented.

Every fixture in `spec/fixtures/invalid/` names its reason, and that directory is the complete
vocabulary. Most reasons belong to decoding, and each one is a **MUST** in section 6 read back
as a refusal:

| reason | the bytes were refused because |
|---|---|
| `malformed-head` | a head uses reserved additional information 28 to 30, section 6.1 |
| `indefinite-length` | a length is indefinite instead of stated, section 6.1 |
| `non-canonical-integer` | a head is wider than its value needs, section 6.1 |
| `truncated` | the bytes end before the value they promise, section 6.1 |
| `trailing-bytes` | bytes follow the one commit, section 6.8 |
| `nesting-too-deep` | nesting passes eight levels, section 6.1 |
| `integer-out-of-range` | an integer is outside plus or minus 2^53, section 6.2 |
| `non-canonical-float` | a float carries a value the integer encoding must carry, section 6.2 |
| `non-finite-float` | a float is an infinity or not a number, section 6.2 |
| `invalid-utf8` | text is not well formed UTF-8, section 6.3 |
| `unsupported-major` | a major type outside the format appears, section 6.4 |
| `unsupported-simple` | a simple value other than false, true or null appears, section 6.4 |
| `invalid-commit` | the commit is not an array of deltas and an optional tag, section 6.8 |
| `empty-commit` | the commit carries no delta, section 6.8 |
| `invalid-tag` | the tag is not 4 to 32 bytes, section 6.8 |
| `duplicate-slot` | two deltas address one slot, section 6.8 |
| `deltas-out-of-order` | the deltas are not in canonical order, section 6.9 |
| `invalid-delta` | a delta is not an array of three or four items, section 6.7 |
| `unknown-delta-type` | a delta type outside add, replace and remove appears, section 6.7 |
| `missing-value` | an add or replace carries no value, section 6.7 |
| `unexpected-value` | a remove carries a value, section 6.7 |
| `invalid-id` | an id is not a 12-byte string, section 6.10 |
| `invalid-ref` | a ref is not a kind and the key that kind takes, section 6.5 |
| `unknown-ref-kind` | a ref kind outside object, array and map appears, section 6.5 |
| `invalid-reference` | a reference value is not an edge, a kind and an id, section 6.4 |
| `unknown-edge-kind` | a reference edge outside attach and alias appears, section 6.4 |
| `invalid-position` | a position is empty or ends in a zero byte, section 6.6 |

Five belong to applying, where the bytes are a well formed commit and the
document is what refuses it:

| reason | the commit was refused because |
|---|---|
| `kind-conflict` | two mentions of one id disagree about its kind, section 1.2 |
| `multiple-attach` | it would give one observable a second attach edge, section 1.1 |
| `slot-exists` | an `add` names a slot that is already taken, section 2.1 |
| `slot-missing` | a `replace` or `remove` names a slot that is not there, section 2.1 |
| `unreachable` | the target has no path of attach edges from the root, section 1.1 |

An implementation that refuses at the wrong stage has also failed point 4. A commit whose
bytes are well formed **MUST** decode, and be refused when it is applied.

---

## 8. Open

Not yet specified, and deliberately not guessed:

- **The integrity tag algorithm**, and whether this specification fixes it or a connection
  negotiates it. The encoding does not depend on the answer, because a tag is opaque bytes.
- **Large and exact numbers.** There is no big integer and no decimal type. An application
  needing one carries it as text or as a byte string, and knows it is doing so.
- **What becomes of an observable after its attach edge is removed.** It is still in the
  document and nothing reaches it. Whether it is collected, kept so the detach can be undone,
  or simply left is not decided here.
