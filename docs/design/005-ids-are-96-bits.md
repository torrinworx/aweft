# 005: Ids are 96 bits, written as sixteen base64url characters

## Decision

An id is 12 bytes from a cryptographically secure source. Its textual form is base64url with
no padding: exactly sixteen characters. Ids carry no timestamp and no counter.

## Why

Ids are 35.5% of the raw bytes of a representative editing stream, so width is the largest
single lever on the size of the format. Against 16 bytes, measured on that stream:

| width | raw | per frame gzip | stream gzip | stream brotli |
|---|---|---|---|---|
| 8 bytes | -16.7% | -13.9% | -11.8% | -6.1% |
| 12 bytes | -8.3% | -6.9% | -6.1% | -2.4% |
| 16 bytes | baseline | baseline | baseline | baseline |
| 20 bytes | +8.3% | +6.8% | +6.2% | +3.5% |

Eight bytes is the cheapest and was rejected. A collision is silent, permanent, and corrupts
data with no recovery path, and 64 bits reaches a real probability at reachable scales: a
document of a million observables sits at roughly one in 37 million, and a hundred thousand
such documents at roughly one in 370. At 96 bits the same fleet is around one in a trillion.

Sixteen bytes was rejected because it buys nothing 96 bits has not already bought, and costs
6.1% of every byte sent, forever.

Twelve bytes also happens to be a multiple of three, so the textual form has no padding to
strip and no character needing an escape in a URL.

## The part that decides it

Width defends against accidental collision only. A participant that wants a collision can
choose one, so no width is a defence against a hostile writer. That belongs to the authority
layer, which is what makes 96 bits sufficient rather than merely likely.

## No timestamp

Every id in a synchronized document is visible to every participant by design. A timestamp
component would publish the creation time of every object to everyone who can read the
document, including anyone it is shared with later. What a timestamp buys is sortable
storage keys, and storage keys are local and free to carry one.

## No injectable generator

`createId` reads the platform's cryptographically secure source and takes no seed, no
generator argument and no global to swap.

The reason to allow one is always testing: a deterministic id makes an assertion easy to
write. The effect is that tests then observe a generator production never uses, so no test
can catch a weak or broken source, which is the one property of id minting that matters.
Code that needs deterministic ids takes them as an argument instead, which every function
here already supports: `createObject`, `createArray` and `createMap` all accept the id to
use, and the conformance fixtures state their ids rather than minting them.

## What would reverse this

A measured workload where documents routinely exceed the scale above, or where the id share
of the stream stays above a third and bandwidth is the binding constraint. Widening is
cheap; narrowing later is not, because existing ids stay.
