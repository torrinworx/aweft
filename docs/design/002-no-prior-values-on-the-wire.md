# 002: Prior values do not go on the wire

## Decision

A delta carries the new value and not the value the slot held before. Divergence detection
is provided by an optional per-commit integrity tag instead.

## Why

The receiver reconstructs the prior value from its own state while applying, so on the wire
it is derivable data. Carrying derivable data next to its source creates a way for the two
to disagree.

Measured on a representative editing stream of 38 frames and 144 deltas:

| variant | raw | gzip | brotli |
|---|---|---|---|
| no prior value | baseline | baseline | baseline |
| prior value per delta | +17.9% | +40.2% | +26.2% |
| hash per delta | +14.9% | +45.0% | +43.9% |
| tag per commit | +3.9% | +12.7% | +14.3% |

The per-delta hash costing more than the data it replaces is the counterintuitive result:
hashes are high entropy and do not compress, while the prose and small integers in real
prior values do.

Undo does not need it either. The client that made a change already holds the prior value
locally, and undoing another participant's change is a different feature that should not be
silent.

## Scale, honestly

The whole stream is 1.2 KB gzipped. Even the worst option costs about 470 bytes, so this is
a design argument with the measurement as tiebreaker, not a bandwidth argument.

## What would reverse this

A use case needing receiver-side inverse without local state, such as a stateless relay
that must undo. None exists in the planned stack.
