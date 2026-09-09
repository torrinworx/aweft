# 040: An array position carries randomness, so two replicas never name one slot

Revises the claim in design 014 and replaces the position chooser that grew a key by a byte
every eight inserts at one place.

## Decision

A position is a run of fixed-width levels. Each level is one digit and three random bytes.
The digits are the fraction; the random bytes tell two replicas apart when they choose the
same digit.

The digit is chosen without randomness: a step of one at an open end, the midpoint of a
closed gap. Two replicas inserting at the same place therefore choose the same digit and
different randomness, so they produce two slots that both survive, in an order both sides
compare the same way.

## Why

**Design 014 stated this as already true and nothing checked it.** Its words were "two
replicas inserting at the same index generate different keys, and both survive in the order
their keys compare." The chooser was a pure function of the two neighbours, so both replicas
produced the same bytes, the second commit to reach the host was refused as `slot-exists`,
and the insert was lost. Reproduced against running code: identical keys for an insert
between two elements, for an append, and for a prepend, on every attempt. Two people adding to one list
at the same moment lose one of the two.

That is design 014's own reversal condition: "a concrete case where two replicas converge
to an order that a position key cannot express, found while building `sync`. The answer to
that would be a different position generator." This is that generator. Per-element identity
is not needed and does not return.

**Fixed width is what makes the randomness safe.** A comparison is bytewise, so a digit byte
must never line up against a randomness byte. Levels of one width guarantee it, and the
result is that comparing two positions is exactly comparing their levels in order. Two
earlier shapes put the randomness at the end as a suffix and both were wrong: one walked the
fraction forward by a whole suffix on every append, and one let a long fraction's digits be
compared against a short one's randomness, which put two positions in the wrong order.

**The cost is measured and it is small where it matters.** Against the byte-per-level
chooser this replaces, on the same shapes:

| | before | after |
|---|---|---|
| 500 inserts between one pair, longest key | 64 bytes | **20 bytes** |
| 2,000 appends, longest key | 16 bytes | 64 bytes |
| a real board edit stream, total commit bytes | 100,459 | **101,564, +1.1%** |

`bench/replicate.ts` has the shipped numbers and the distinctness count: 1,000 replicas of
one array inserting at the same place choose 1,000 different slots.

Deep subdivision gets cheaper because a level holds a whole digit of room where the old
chooser spent bytes on its own escape path. Appends get four times more expensive per level.
On a real stream of 1,845 commits the two nearly cancel, at +1.1%.

**Three bytes of randomness.** Two replicas that chose the same digit collide once in 16.7
million, and a collision is a refused commit that the client reports, not silent loss. Two
bytes would be one in 65,536, which a busy list reaches.

## What it costs

An array built with `createArray(['a', 'b'])` produces different position keys on every call,
so a test cannot assert position bytes and a document is not byte-identical to a second one
built the same way. Neither was ever guaranteed: `spec/format.md` says generation is
unspecified and a receiver never regenerates a position.

## What would reverse this

A workload where array keys are a material share of stored or transmitted bytes, measured
rather than assumed, together with a chooser that keeps distinctness for less. The 1.1%
above is the number to beat.
