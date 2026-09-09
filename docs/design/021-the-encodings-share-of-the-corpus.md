# 021: The encoding's share of the behavioral corpus is empty, and why

## Decision

`@aweftjs/codec` lands no `tests/behavior.codec.test.ts`. Its share of the behavioral corpus
is empty. The emptiness is a judgement, and the reasons are below, so it is not a file nobody
got around to writing.

## Why it is empty

The corpus is curated from a state library: observables, delivery, reentrancy, the semantics of
collections under mutation. The encoding sits below all of that and shares none of its surface.
It has no listeners, no ordering between calls, and no state to be reentrant about. A commit
goes in and bytes come out.

Three cases in the corpus do touch identity, which is this package's job, and each was checked
against what is built here rather than waved away.

**An id must never be all zero, because the zero id is reserved as a sentinel in a binary
format.** Does not carry over. Nothing in `spec/format.md` or `spec/identity.md` reserves any id
value, so there is no sentinel for a generated id to collide with. The opposite is true here:
the conformance fixtures name observables `000000000000000000000001` and upward precisely
because low ids are ordinary, and reserving zero would invalidate the suite.

**An id's timestamp field must not truncate before it is clamped.** Does not carry over. An id
is 96 bits of randomness with no timestamp component at all, which design 005 settled and gave
its reasons for. There is no field to truncate.

**Ids must come from a cryptographically secure source.** Holds by construction rather than by
test. `createId` calls `crypto.getRandomValues` and there is no seed, no injectable generator
and no fallback, which `id.ts` documents at its definition site with the reason: a replaceable
generator exists so tests can be deterministic, and its effect is that tests observe randomness
production never sees, so no test can catch a weak source.

One corpus case does bind the encoding, and the format already enforces it: a commit must
never carry two deltas for the same slot. It is not a test here because it
is a rule of the format, in section 6.9, enforced by the canonical order rather than by a
separate check. Two deltas addressing one `(id, ref)` compare equal, equal is not ascending, and
the decoder refuses the commit. `spec/fixtures/invalid/014-duplicate-slot.json` is the case.

## What this does not excuse

An empty share is not a lighter standard. The encoding is held to conformance instead, and that
is the stronger instrument for what it does: fifteen fixtures with hand-written ending documents,
thirty five rejection fixtures each naming the reason it must be refused for, two commits whose
bytes are spelled out by hand from the prose, and a proof program that flips every byte of a
real log and holds the decoder to section 6's rule on each one.

## What would reverse this

A failure in the encoding that the conformance suite could not have caught, of a kind that
recurs. That would mean the format has behavior the fixtures do not describe, and the corpus is
where behavior that resists specification goes.
