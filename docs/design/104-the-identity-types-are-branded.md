# 104: The identity types are branded

## Decision

`Id`, `Position` and `Tag` become distinct types rather than three spellings of `Uint8Array`.
Each is `Uint8Array` intersected with a phantom property that exists only in the type system, so
nothing changes at runtime and nothing reaches the wire.

`assertId` and `assertPosition` are what mint them. They already check the bytes at runtime; now
their return type is what the rest of the stack requires, so the check and the type agree by
construction.

47 public signature positions change: 21 in `codec`, 10 in `core`, 6 in `sync`, 5 in `store`,
4 in `testing`, 1 in `schema`.

## Why

Today a signature reading `Uint8Array` could want an id, a position or an integrity tag, and the
compiler stops none of the swaps. A reader has to know which from the parameter name, and an
agent writing against the declarations has nothing else to go on.

Every one of those swaps is already a refusal at runtime. Branding moves the same failure to the
compiler, which is where the ablation evidence behind design 101 says a reader fixes it fastest
and where it costs nothing to hit.

Phantom property rather than a unique symbol because `erasableSyntaxOnly` forbids a runtime
declaration, and an intersection is type-only.

## What this costs

A visible `surface.txt` diff across six packages. Anyone building an id from raw bytes now goes
through `assertId`, which is a check they should have been making.

## What would reverse this

A place where the brand cannot be carried and a cast is the only way through, appearing often
enough that callers start casting by habit. A cast written to silence the compiler is worse than
the unbranded type, because it looks checked.
