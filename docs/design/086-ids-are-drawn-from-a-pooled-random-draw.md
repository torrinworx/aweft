# 086: Ids are drawn from a pooled random draw

## Decision

`createId` fills a buffer from `crypto.getRandomValues` once and hands out the next twelve
bytes of it on each call, refilling when the buffer runs out. Array position jitter already
draws from a pool the same way (design 040 and `position.ts`); this is the same mechanic in
the other place ids come from.

An id is still twelve bytes from the same cryptographically secure source. Nothing about their
width, their alphabet, or where they may be used changes. There is still no seed, no injectable
generator and no fallback (design 005).

## Why

One system call per id was 59% of the cost of making 10,000 row objects, measured: the call
itself dominates, not the randomness. Drawing 4,092 bytes once and
slicing 341 ids out of it makes the same ids for a 341st of the calls.

Pooling does not weaken the ids. The bytes come from the same generator in the same order; the
only difference is how many bytes are asked for at a time, and the platform generator is
specified to produce the same quality either way. A pool that is never reset also means no
counter and no state that could repeat: a refill is a fresh draw.

The pool is 4,092 bytes because it is a whole number of ids (341) and stays under a page.

## What this costs

Up to 4,080 bytes of drawn randomness are held and never used if a process mints one id and
exits. That is one buffer, not one per document.

A forked process that inherits a partly used pool would hand out the same remaining bytes in
both children. Node's `crypto.getRandomValues` is not fork-safe in that sense, and neither is
this, but the exposure moves from nothing to one buffer. Nothing in the stack forks after
minting ids; if something does, it refills first.

## What would reverse this

A platform whose `getRandomValues` is cheap enough that the call is not the cost, measured
rather than assumed. Or a deployment that forks worker processes after minting ids, which wants
an explicit refill on fork rather than a return to one call per id.
