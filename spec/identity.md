# aweft identity, v0

Status: draft. Normative for the parts marked so; the encoding is open.

Every observable carries an id. Ids are how two replicas agree on which observable a change
refers to without agreeing on where it sits in the tree.

## 1. Requirements

An id **MUST** be unique within a document, and **MUST** remain valid when the observable it
names is detached and reattached.

Ids **MUST** be generated from a cryptographically secure source. An implementation
**MUST NOT** provide a fallback to a non-cryptographic generator, and **MUST NOT** expose a
way to replace the generator at runtime.

*Rationale:* a global generator override exists to make tests deterministic, and the failure
it produces is that tests run on one source of randomness while production runs on another,
so no test can observe the weakness. Determinism in tests is obtained by injecting a
generator at construction, not by replacing a global.

## 2. Ids are not credentials

An id **MUST NOT** be used as an authentication token, session identifier, or capability.

*Rationale:* ids are published. Every id in a synchronized document is visible to every
participant, by design. A value that is broadcast cannot also be a secret. Credentials are
minted by a separate mechanism with a separate call site, so that reaching for the wrong one
is not expressible.

## 3. Encoding

An id is **12 bytes**, 96 bits from the source in section 1. Its textual form, for a URL, a
log line, or a key in a document, is **base64url with no padding: exactly sixteen
characters** drawn from `A-Z`, `a-z`, `0-9`, `-` and `_`.

Twelve bytes is a multiple of three, so the textual form carries no padding to strip and no
character needing an escape anywhere an id is likely to be written.

*Rationale, measured:* ids are 35.5% of the raw bytes of a representative editing stream, so
the width is the largest single lever on the size of the format. Measured on that stream
against 16 bytes, 12 bytes is 6.1% smaller compressed and 8 bytes is 11.8% smaller.

Twelve was chosen over eight because a collision is silent, permanent, and corrupts data
with no recovery path, and 64 bits reaches a probability at scales an application can
actually get to: a document of a million observables sits at roughly one in 37 million, and
a hundred thousand such documents at roughly one in 370. At 96 bits that same fleet is
around one in a trillion. Twelve was chosen over sixteen because sixteen buys nothing that
96 bits has not already bought, and costs 6.1% of every byte sent, forever.

Width defends against accidental collision only. A participant that wants a collision can
simply choose one, so no id width is a defence against a hostile writer. That belongs to the
authority layer, and it is why 96 bits is enough here.

### 3.1 Ordering

An id **MUST NOT** carry a timestamp or a counter, and **MUST NOT** be ordered by anything
but its bytes.

*Rationale:* every id in a synchronized document is visible to every participant by design,
so a timestamp component publishes the creation time of every object to everyone who can
read the document, including anyone it is shared with later. What a timestamp buys is
sortable storage keys, and storage keys are local, unshared, and free to carry one.

Array ordering does not use ids at all. See `spec/format.md` section 6.6.

## 4. Open

- Whether an id ever needs re-minting, and what a replica holding the old one should do.
