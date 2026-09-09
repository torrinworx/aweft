# 094: A template is a structural spec, not markup

## Decision

The static shape the transform hands `template` is nested arrays, `[tag, attributes,
...children]`, with a string for a text child. It is not a markup string, and `template` builds
the prototype with the same `createElement`, `createTextNode` and `setAttribute` calls `h` would
have made.

Only three things go into the prototype: element names, non-`$` attributes whose value is a
string, number or boolean literal in the source, and text children. Everything else is an edit
applied per instance.

## Why

A markup string would be shorter to emit and faster to build in a browser, and it produces a
different tree. Two adjacent static text children are two nodes through `h` and one node through
a parser. An element in `svg` is in the HTML namespace through `createElement`, which is what
`h` does, and in the SVG namespace through a parser. The light tree's parser applies none of
HTML's tree-construction rules, so a markup string would also build one tree on a server and
another in a browser, which is the failure "one transform, two modes" exists to prevent.

Building with the same calls `h` makes means the prototype is the tree `h` would have made, by
construction rather than by inspection, and the equivalence suite can say so.

`$` properties stay out of the prototype for a second reason: `cloneNode` copies attributes, not
JavaScript properties, and the record of the properties the binding set, which hydration replays
onto the server's node, is keyed by node and does not survive a clone.

## What this costs

Building the prototype costs one `h`-sized construction per document rather than one parser
call. That happens once per template per document and is not in the per-row path the whole pass
is for.

The emitted spec is longer than the equivalent markup string. It compresses well, being repeated
brackets and quoted names, but it is bytes on the page.

## What would reverse this

A prototype built from markup whose tree is provably the same tree `h` builds, for every case
the equivalence suite covers. That needs a parser that follows the same rules in a browser and
in the light tree, which is a larger thing than the light tree's parser is.
