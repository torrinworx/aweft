# 080: Context is one opaque value threaded through mount

## Decision

`mount(target, item, before, context)` carries `context` down to every nested mount and hands
it to a component that returns a mounter, `(elem, item, before, context) => remove`. `dom`
never reads it, never writes it and gives it no shape. A component library builds a context
tree, ids and introspection on it.

## Why

The split keeps the binding a binding: the component library above it builds `createContext`
on that value. The requirements the architecture doc lists for contexts (introspection,
stable identity, a registry per render) are answered where the tree is built.

## What this costs

Two packages to read to understand a context. That is the same two as today.

## What would reverse this

Static generation needing to walk the context tree from inside `render`, which no `ui` value
can offer it. Then the tree moves down, and this design is superseded.
