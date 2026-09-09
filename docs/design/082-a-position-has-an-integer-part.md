# 082: A position has an integer part

Revises the layout half of design 040; the randomness and the fixed-width fractional levels
stand.

## Decision

A position begins with an integer part: one count byte, then that many digits in base 254
with no leading zero digit (a digit byte is its value plus one, so no digit is zero), then
three random bytes. After it come the fractional levels of design 040, each one digit and
three random bytes.

An append counts the integer up; a prepend counts it down until zero, then goes under it as
before. An insert between two neighbours takes the integer midpoint when one exists and
otherwise goes under the lower neighbour, exactly as a fractional level does.

## Why

Design 040's chooser stepped the first digit by one and added a level every 126 appends, so
the key for row N was about N/126 levels long: 32 bytes at row 1,000, 316 bytes at row 10,000,
1.6 MB of keys for a 10,000-row list, and every compare, hex conversion and delta carried the
length. That design measured 2,000 appends at 64 bytes and accepted it at +1.1% on a real
edit stream; at 10,000 rows it was the dominant cost of creating a list (`bulk.ts`).

A count byte in front is what makes a longer integer sort after every shorter one under the
byte comparison the format specifies, so the integer part is a plain positional number and
appending grows it by a byte every 254-fold. The format leaves the choice of a position to
the implementation (`spec/format.md` 6.6), so nothing on the wire changes; only the bytes
this chooser produces do, which is why it lands before anything is stored.

Measured with `bench/replicate.ts` and the position tests:

| | 040 | this |
|---|---|---|
| 2,000 appends, longest key | 64 bytes | 6 bytes |
| 10,000 appends, longest key | 316 bytes | 6 bytes |
| 10,000 rows, key bytes for the list | 1,594,852 | 59,874 |
| 500 inserts between one pair, longest key | 20 bytes | 21 bytes |
| 2,000 prepends, longest key | 64 bytes | 65 bytes |
| a real board edit stream, total commit bytes | 101,564 | 105,026, +3.4% |
| push 10,000 observables in one commit | 113.7 ms | 46.8 ms |

The board stream grows because every array key carries one more byte, the count. What it
buys is the row above it: the lists a page actually builds stop paying by the row.

## What this costs

One byte more on every key, for the count, which is the +3.4% on the board stream. Prepends
still grow a level every 126 once the integer reaches zero, so a list built by prepending pays
what appends used to; the first 128 prepends are free because the first element starts at 128.

Beside it, `splice` now removes a run from the back, so each removal shifts only the slots past
the run: clearing 10,000 rows from the front went from 95.7 ms to 4.1 ms. No design note of
its own; it changes no concept and no surface.

## What would reverse this

A stored document written by the old chooser meeting this one: the two orderings disagree
on the first byte. Nothing is stored yet. If something were, this would need a migration
rather than a switch.
