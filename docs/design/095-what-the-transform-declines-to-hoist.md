# 095: What the transform declines to hoist

## Decision

Four cases are left as a plain `h` call. Each is a case where a hoisted template could mean
something the source did not.

1. **A spread in the properties.** `h('div', { ...rest })` may carry a `children` property at
   runtime, which `h` mounts as the element's body and a template would not. The transform cannot
   see what is in `rest`.
2. **`children` given as a property.** The same case, written out. `h` couples it to the rest
   arguments with its own rules and asserts when both are given.
3. **A tag that is not a literal name.** A component, a variable, a member expression. There is no
   element to put in a prototype. The subtree around it still hoists, with the call as one of its
   edits.
4. **Any element in a file that binds the name `h` anywhere except the one import from
   `@aweftjs/dom`.** This is the file-level reading of design 092.

Case 4 is deliberately blunt. A file that imports `h` from `@aweftjs/dom` and then shadows it,
with a parameter or a local, gets no hoisting anywhere in the file rather than hoisting
everywhere the shadow does not reach.

JSX and the `html` tag still compile in all four cases. Only the template substitution stops.

## Why

Cases 1 and 2 are correctness: a hoisted template that dropped a runtime `children` would render
an empty element and nothing would say so. Refusing costs that one element its clone and keeps
its subtree's.

Case 4 is correctness bought with a blunt instrument. Following the shadow properly means real
scope analysis: block scopes, `var` hoisting to the function, catch parameters, destructuring
patterns, and every one of them a place to be subtly wrong in the direction of hoisting
something that should not be. The blunt rule can only be wrong in the direction of hoisting less,
and a file that imports `h` and then shadows it is not a shape anything in this repo writes.

## What this costs

A page that spreads properties onto plain elements gets less of the saving. A file that shadows
`h` gets none of it. Both are visible: the transform reports nothing, so the only way to notice
is that the output has no template call in it.

## What would reverse this

For case 1: handling a runtime `children` inside the properties edit, which means deciding where
those children sit among the static ones and is only worth it if real pages spread onto plain
elements often. For case 4: a real page that shadows `h` and loses the saving, which is the
evidence that scope analysis is worth its own risk.
