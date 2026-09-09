# 004: The encoding is bytes, not text

## Decision

Commits are encoded as a byte string with one spelling per value, not as text. The type set
is null, booleans, integers, float64, byte strings, text strings and arrays. Maps and tagged
values are excluded, so nothing has a second form.

## Why

Conformance is stated as byte equality: an implementation must re-encode what it decoded and
get the input back. A text encoding cannot meet that across languages. The same double
prints as `1e-7` from one runtime's JSON and `1e-07` from another's, so two correct
implementations write different bytes for one value and neither is wrong.

```
JS  : 1e+21  1e-7   5e-324  1.7976931348623157e+308
PY  : 1e+21  1e-07  5e-324  1.7976931348623157e+308
```

Size was the tiebreaker, not the argument. On a representative editing stream of 2,000
commits and 10,431 deltas:

| variant | raw | per frame gzip | stream gzip | stream brotli |
|---|---|---|---|---|
| canonical text | baseline | baseline | baseline | baseline |
| bytes | -24.9% | -11.0% | -6.0% | -1.8% |

Compression closes most of the gap, which is the honest reading: this is a determinism
decision that happens to also be smaller.

## What was rejected

**Folding the ref kind into the delta type**, giving one small integer for the nine
combinations of three types and three kinds. Measured at -3.3% raw, -1.9% per frame gzip,
-0.9% stream gzip, -0.2% brotli. Rejected: under 1% on the number that matters is below the
bar this repo already set when it dropped terse helper aliases at 0.98%, and folding makes
the type and the kind renumber each other, when they are independent by construction.

## What would reverse this

A measured case where the format has to be read or written by something that cannot carry a
binary payload. Base64 inside a text channel costs 33% and keeps every guarantee, so this
would have to be a channel that also cannot do that.
