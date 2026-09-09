# 096: A compiled `html` template raises early, and shares one join

## Decision

The `html` pass reads the same markup dialect the runtime parser reads, at build time, and makes
the same refusals. A fault the transform can see in the source stops the build, with the message
the parser would have thrown and the position in the file. That covers an unterminated tag, a
closing tag with nothing open, a closing tag that names a different element, a tag with no name,
an unterminated quoted attribute, an attribute with no value, a comment that does not end in its
own segment, and a spread written without its `=`.

One refusal does not survive compilation: the parser asserts that a spread is an object, and a
compiled template writes `{ ...expr }`, which spreads whatever it is handed. A string contributes
one attribute per character, so `=${'not a tag'}` compiles to `<div 0="n" 1="o" 2="t" ...>`; a
number, `null` and `undefined` contribute nothing. A compiled template therefore does not catch
that mistake and a parsed one does.

A quoted attribute of several parts becomes one value through `joined`, which `dom` now exports.
The runtime parser uses it as its default join, so the compiled form and the parsed form make the
same value: plain parts concatenate, and a part that is a scope or cell makes the whole value
derived.

## Why

Moving a refusal from runtime to build time is strictly better: it fails on the machine that
compiled the file, with a line number, before the page is served. Every refusal that can move,
moves.

The spread refusal cannot move, because whether an expression is an object is a runtime fact.
Keeping it would mean emitting a call into a helper `dom` does not have, for a check that
`assert` is specified to remove in a release build anyway. The mistake it catches, spreading a
non-object, gives an element the parsed form refuses outright and the compiled form renders:
attributes missing, and for a string attributes that were never asked for.

`joined` is exported rather than reimplemented because two implementations of one join is two
things to keep in step, and the whole point of "one transform, two modes" is that a page
compiled one way and run another does the same thing.

## What this costs

One more name on `dom`'s surface. And one development-time check a page loses by compiling its
markup, named here so it is a known gap rather than a surprise.

## What would reverse this

A cheap way to keep the spread check: a merge helper on `dom` that a compiled template calls,
which asserts and then spreads. That trades a name on the surface and a call per element for a
development check, and is worth revisiting if anyone is actually caught by it.
