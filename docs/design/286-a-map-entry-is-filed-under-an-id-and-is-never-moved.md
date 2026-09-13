# 286: A map entry is filed under an id and is never moved

## Decision

An entry in an observable map is filed under an id: the one `set` is handed, or the value's own
id when `add` files an observable. The key is the slot name in every delta about the entry, and
that is all it is. An observable's id never changes, so an entry filed by `add` cannot be re-keyed
in place, and there is no operation that moves an entry from one key to another. A caller who
wants a value under a new key deletes and sets, which is two deltas in one commit or two, and a
watcher on the old key hears the removal while a watcher on the new one hears the add.

Three cases the corpus knows from keyed collections are therefore left out on purpose, and this
note is what the corpus rule asks for when a case is left out: a key that changes under a live
watcher must relink so the watcher follows; a delete and re-add of one entry within one commit
must resolve in any delta order; and the delta's key is authoritative over any id the value
carries. None of the three has a shape here, because nothing moves and the value's id is the
key or is unrelated to it, never a second opinion about it.

## Why

A keyed collection whose key can change under the entry is a known source of quiet divergence:
the local map files the entry under one key while a replica applying the same commit in another
delta order files it under the other, and both are self-consistent. The only cure is a rule about
delta order inside a commit, which this format refuses to have (design 003: one delta per slot,
order undefined). Keeping the key a slot name and nothing more means a map entry is exactly an
object slot with an id for a name, and every rule about object slots carries over unchanged.

No application surveyed moves a map entry. One that needs to has delete and set, and the cost is
two deltas where one might have done.

## What this costs

An application that models a re-key as a move has to write it as a remove and an add, and a
watcher on the entry sees two changes. That is the honest reading: the entry is gone from where
it was.

## Evidence

`packages/core/tests/behavior.core.test.ts`: an entry filed under a chosen id keeps the value's
own id unrelated to it; moving an entry is a removal on the old key and an add on the new one,
each heard by its own watcher, in one commit that a copy applies to hold the entry under the new
key only.

## What would reverse this

An application that moves entries under live watchers often enough that two deltas per move
shows up as a cost, together with a delta-order rule the format could adopt without giving up
design 003.
