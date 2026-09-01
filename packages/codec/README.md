# @aweftjs/codec

The wire format: values, deltas and commits to bytes, and back.

One value has one spelling. The decoder refuses any input an encoder would not have written,
so two implementations that both pass the fixture suite write byte-identical output for the
same commit. Byte equality is what conformance means here, and every rule in the package
serves it.

That is a rule about spelling, not about trust. See "What this does not do" before you rely
on it for anything else.

The format is written down in `spec/format.md`, and this package is its normative
implementation. Nothing here knows about observables, transports or storage.

## Quickstart

```ts
import { createId, decodeCommit, encodeCommit, type Commit } from '@aweftjs/codec';

const doc = createId();

const commit: Commit = {
	deltas: [
		{ type: 'add', id: doc, ref: { kind: 'object', key: 'title' }, value: 'plan' },
		{ type: 'add', id: doc, ref: { kind: 'object', key: 'done' }, value: false },
	],
};

const bytes = encodeCommit(commit);
const back = decodeCommit(bytes);
// encodeCommit(back) is byte for byte the same as bytes. Always, for any input decodeCommit
// accepted.
```

`encodeCommit` sorts the deltas, so the same commit handed over in any order gives the same
bytes. `decodeCommit` refuses deltas that arrive out of that order rather than sorting them:
accepting both spellings would mean two byte strings decode to one commit, and re-encoding
could no longer reproduce its input.

## A delta names a slot, not a path

The target is `id` plus `ref`. There is no path anywhere in the format, so a delta means the
same thing whatever else moved in the same commit.

```ts
{ kind: 'object', key: 'title' }        // a string slot
{ kind: 'array',  key: position }       // a position key, ordered as bytes
{ kind: 'map',    key: someId }         // keyed by identity
```

`ref.kind` says which observable kind the delta is talking about, so a receiver that has
never seen the target can still read the delta. `value` is present for `add` and `replace`
and absent for `remove`.

## Values are flat

```ts
type Value = null | boolean | number | string | Uint8Array | Reference;
```

There is no nested structure in a slot. A structure inlined into a slot would be state that
no delta addresses, and every change to state is a delta. A slot that holds another
observable holds a `Reference` to it:

```ts
{ edge: 'attach', kind: 'object', id: childId }   // where the child lives
{ edge: 'alias',  kind: 'object', id: childId }   // a second name for it, moves nothing
```

An observable has exactly one attach edge. Every other reference to it is an alias, which is
what makes one walk up the attach edges the whole answer to where something sits.

## Ids and positions

Ids are 12 random bytes, and `idToText` gives the 16 base64url characters that are safe in a
URL, a log line or a JSON key. `createId` takes no seed and no injectable generator on
purpose: code that needs deterministic ids takes them as input.

A position is a non-empty byte string that does not end in a zero byte. Those two rules are
what guarantee a key always exists between any two distinct keys, so an array never runs out
of room to grow. `comparePositions` is the plain unsigned byte comparison, and a prefix sorts
before what extends it.

```ts
import { assertPosition, comparePositions, isValidPosition } from '@aweftjs/codec';

isValidPosition(Uint8Array.of(0x80));        // true
isValidPosition(Uint8Array.of(0x80, 0x00));  // false, ends in a zero byte
```

`assertId` and `assertPosition` hand the value back, so they can wrap it on the way into a
structure rather than sitting on a line of their own.

This package judges positions and never mints one. Choosing a key between two others is left
open by the format on purpose, and `@aweftjs/core` is what makes the choice: ordinary array
work does it for you, so `list.splice(1, 0, x)` on `['a', 'c']` turns positions `80 81` into
`80 8080 81`. `positionsOf` reads the keys back, and `insertAt` is the other direction, for a
receiver honouring a position it was told rather than inventing one and diverging.
Writing your own is a real job, not a one-liner, so reach for core rather than starting from
`comparePositions`.

## Refusals name a reason

Every throw is a `CodecError` carrying a `reason`, and the reason is part of the format's
contract rather than a message for a human. Two implementations that reject the same input
for different stated reasons have not agreed on the format.

```ts
import { decodeCommit, type CodecError } from '@aweftjs/codec';

try {
	decodeCommit(damaged);
} catch (error) {
	(error as CodecError).reason;  // 'deltas-out-of-order', 'truncated', 'duplicate-slot', ...
}
```

The reasons are pinned by `spec/fixtures/invalid/`: one file per case, naming the bytes, the
stage the refusal is due at, and the reason to refuse for. The filenames say which is which,
so that directory is the list to read and to branch on. A reason not exercised there is not
part of the contract.

## The value layer

`encodeValue` and `decodeValue` sit below commits, on the small type set the format allows:
null, booleans, integers, float64, byte strings, text strings and arrays. No maps and no
tags, so there is no dialect to negotiate.

Integers are exact and written as integers in `[MIN_INT, MAX_INT]`, which is +/- 2^53, and
anything outside that is a float. The bound is exact representability rather than JavaScript's
safe-integer range, because a double holds 2^53 exactly. A whole number written as a float is
refused, and so is an integer padded into a wider form than it needs.

Most callers want `encodeCommit` and never touch this layer. It is public because an
implementation in another language checks its own value encoding against this one.

## What this does not do

**It does not detect tampering.** Damage a byte and one of two things happens: the bytes stop
being a commit and decoding throws, or they are still a legal commit and decode cleanly into a
different one. Both are correct. Flip a bit inside an id and you get a different id, which is
as valid as the one you started with, and nothing in the format can know you did not mean it.
Flipping every bit of three small commits in turn, 562 of 968 flips decoded without
complaint. How many depends on the shape of the commit, and it is never small. If your bytes cross a channel that can change them, put a checksum or a signature
in your own framing. This package will not notice.

`Commit.tag` is not that check, whatever the word integrity suggests. It is a digest over the
prior values of the slots a commit addresses, computed by the sender against its own state
before the commit, and it answers one question: did this commit land on the state the sender
thought it would? A receiver that computes a different tag treats the two replicas as
diverged and resynchronizes. It says nothing about the bytes in between, and the algorithm
that fills it is still open, so nothing here computes or checks one yet.

**It does not frame anything.** A commit says how long it is, but a log of commits needs its
own framing, which `examples/codec/main.ts` shows one way of doing.

## Boundaries

Deliberately not here: any document model, any transport, any persistence.

The reasoning behind the choices lives in `docs/design/`, and the format they implement in
`spec/format.md`.
