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

## 3. Open

- The concrete encoding: width, layout, and textual form.
- Whether ids carry a timestamp component, and if so whether that is a privacy concern for a
  document shared outside a trust boundary.
- Ordering: whether array position references derive from ids or are a separate scheme.
