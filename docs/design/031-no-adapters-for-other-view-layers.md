# 031: No adapters for other view layers

## Decision

The stack ships one view binding: the `dom` package. No adapter for React, Vue, Svelte or any
other rendering library is planned, built, or reserved a package name.

## Why

An adapter is a promise to track someone else's release cadence, reconciliation model and
scheduling semantics forever. The stack's own binding is where hydration, static render and
the mounting model are designed as one path; an adapter would be a second consumer of core
with none of those guarantees, and its existence would make every core delivery-order
decision answer two masters.

Anyone who wants aweft state inside another framework already has the supported pieces: `get`
for a render, `watch` for an invalidation hook. That is small enough to live in the
application that needs it.

## What this costs

Adoption inside an existing codebase on another framework is on that codebase. This stack's
applications are full-stack aweft, which is who the packages are for.

## What would reverse this

A consuming application that matters adopting a hybrid architecture for a long transition.
The adapter would then be that application's, promoted only if a second one appears.
