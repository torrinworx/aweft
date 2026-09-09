# 093: A hoisted subtree is one bound value

## Decision

A hoisted template instance is one value, and it is the value `h` already returns: the element
itself when nothing in it turned out to be reactive, and otherwise the element together with one
flat list of every signal below it, at any depth.

Nested `h` calls already work this way. An inner call hands its element and its signals to the
outer one, the outer one adds its own, and `mount` receives a single root with one list. A
template does the same in one step: it walks its edits in the order the nested calls would have
run in, appends each signal to one list, and hands `mount` the root.

The order matters, and there are two of them (amended below). The values arrive in the order the
source evaluates them, which is left to right through each call's arguments: an element's
properties, then its children, and a nested element's whole subtree where that child sits. They
are applied to the tree in another order: every element's children first, then every element's
properties, deepest element first. A property that rewrites the element's content, `$textContent`
above all, therefore runs after the children are in place, exactly as it does today, and an
ancestor's runs after a descendant's.

Splitting the two is what lets both hold. Applying children before properties is not the order
nested `h` calls evaluate their arguments in, and evaluating properties first is not the order
`h` writes them in. `h` gets both because the arguments run at the call site and the writing runs
inside it; a template gets both by taking its values in one order and applying them in another.
Two varying children of one element are still made in source order, which is what their anchors
are worked out from. Application order between siblings does not matter, because each one finds
its place from its anchor rather than from when it ran.

`mount` is unchanged and learns nothing new. It cannot tell an instance from an `h` call.

## Why

The alternative shapes were a list of bound values the caller has to mount one by one, and a
bound value per descendant carried in the tree. Both make the caller or `mount` handle something
`h` does not produce today, for a value `mount` already takes.

A flat list also keeps the removal path right. `mount` stops every signal in the list when the
root goes, and the signals of a subtree removed with its parent only have to let go of what they
hold. A nested carrier would need a walk to find them.

## What this costs

The signals of a large template are in one array, so removing the root walks that array even
though most of the entries are for nodes that go with it anyway. That is what nested `h` calls
already cost, and it is linear in the number of reactive parts, not in the size of the subtree,
which is the number a hoisted template is trying to make small.

## What would reverse this

A signal kind that has to be stopped in tree order rather than list order. Nothing today does:
each signal holds one subscription and one handle, and neither depends on a sibling.

## Amended

**The values are emitted in source order.** This note said the transform emits its values "in the
order the nested calls would have run in", and then described that as an element's varying
children, its nested elements, and its own properties last. That is the order the edits are
*applied* in, and an earlier shape emitted the values in it too, so the compiled form ran the
source's own expressions in an order the source never had. `h('p', { title: s.value }, next(s))`
reads `s.value` before `next(s)` runs; the compiled form ran `next(s)` first, and a source whose
properties and children both have side effects rendered a different page.

The two orders are now separate. `build` emits each element's properties value before its
children's, and a nested element's subtree where that child sits, which is what JavaScript
evaluates. `template` groups the edits into runs and applies every element's children before any
element's properties, deepest element first, so nothing about what reaches the tree changes. The
edit list and the value list no longer share an order, and one element's child edits are one run
wherever they sit in the list, because a nested subtree's edits now come between two of them.

Checked by `packages/build/tests/equivalence.test.ts`, which runs five nestings whose expressions
push a label as they run and compares the sequence against one read off the source by hand, and by
the `expressions a side effect can see, in source order` fixture, which renders that sequence into
the page so every mode and every document compares it. Both catch the mistake: the one element
case runs `ba` where the source runs `ab`.
