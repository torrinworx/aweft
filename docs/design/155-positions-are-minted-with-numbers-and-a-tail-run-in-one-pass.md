# 155: Positions are minted with Numbers, and a tail run in one pass

The key bytes a position is made of are unchanged; `spec/format.md` and the fixtures stay as
they are.

## Decision

`between` in `core/src/position.ts` does its integer arithmetic on Numbers, and reaches for
BigInt only when the integer part of a key does not fit below 2^53. The digit and jitter
rules, the byte layout and the ordering guarantees are exactly what they were, so every key
the old code minted the new code accepts, and the conformance fixtures do not change.

Appending a run of values, which is what `push(...values)` and `insertRun` do, mints the
run's positions in one pass: the integer part of the last key is read once, each next key
takes the next integer and one jitter draw, and nothing decodes the key it just wrote. One
value appended at a time takes the same path with a run of one.

## Why

Measured under load, minting 10,000 tail positions in sequence cost
15 ms in Node, and BigInt ran twice per mint, once to rebuild the previous key's integer and
once to take the new one apart. On the push path, `jitter`, `integerBytes`, `finish` and
`between` together were about 10% of self time and, with `Uint8Array`, 10.4 MB of the
allocation during create 10,000 in Chrome. Pushing 10,000 prebuilt objects into an array
cost 30 to 41 ms, against 2 to 8 ms for a comparable observable list measured beside it, and
positions are the part of that gap the wire does not require.

Measured with the change on a quiet machine, 10,000 tail mints: the earlier loop 4.11 ms, the
new loop 4.99 ms, the new run 1.15 ms. The arithmetic was never
most of the cost. Each key went through four throwaway arrays (the digit list, its spread,
the jitter copy, the concatenation) and `Uint8Array.from` over a plain array; the run writes
the digits and the three jitter bytes straight into the key. The one-at-a-time path keeps
`between` as it was, on Numbers.

## What would reverse it

A document whose array integer parts exceed 2^53, which the BigInt path covers, or a
measurement showing the run path produces keys longer than the one-at-a-time path did.
`bench/replicate.ts` measures position bytes and must not grow.
