# 190: Two more directives, and a declaration whose value is a list

Amended: a directive block holds one more directive, so a query can hold a pseudo block and a
pseudo block can hold a starting style.

## Decision

**`_starting_` compiles to `@starting-style`.** An entry writes

```ts
dialog: { _starting_: { opacity: 0, transform: 'scale(0.96)' } }
```

and the chain emits `@starting-style { .awN { opacity: 0; transform: scale(0.96); } }`. It is the
same code path `_media_` takes: the value is a block, its declarations are resolved through the
chain's lookup, and the result is wrapped. The text after the directive's name is ignored, so
`_starting_` is the key and there is nothing to write after it.

That is the one way a browser will transition an element that is arriving. Without a
before-change style the first frame is already the final one, so an overlay that appears in the
top layer appears at full opacity however long its transition is.

**`_container_<query>` compiles to `@container`.** `'_container_(min-width: 28rem)'` wraps that
entry's body in the query, the way `_media_` wraps it in a media query. The rest of the key is the
query, so a query with an underscore in it survives, exactly as `_media_` already does.

**A declaration whose value is a list is emitted once per item, in order.**

```ts
select: { appearance: ['none', 'base-select'] }
```

emits `appearance: none; appearance: base-select;`. A host that understands the second value takes
it; a host that does not drops that declaration and keeps the first. That is the CSS fallback
idiom, and before this change the list went through `String(value)` and emitted the single
nonsense value `none,base-select`.

Each item goes through `declarationValue` on its own, so a bare number in a size property still
gets `px`, and each is parsed and resolved on its own, so `$name` and `$fn()` work in every item.

**The class cache already tells a list from a string.** `written()` in `sheet.ts` writes an array
as `["none","base-select"]` and a string as `"none,base-select"`, and `same()` compares arrays
element by element, so two entries that differ only in whether a value is a list key differently
and get different classes. Nothing about `contentKey` changed.

## What this does not do

**A directive block holds declarations and one more directive. A third level compiles to
nothing.** A rule is a selector and the at-rules wrapped around it, and each directive is one more
wrapper on either: `_elem_`, `_children_` and `_cssProp_` build the selector, `_media_`,
`_container_` and `_starting_` add an at-rule. `emitBlock` in `sheet.ts` walks two levels deep and
stops, and an enclosing rule is dropped wherever its own body came out empty.

So these are the shapes that work, the third of them since the amendment:

```ts
'_media_(q)': { padding: 8 }                                   // @media q { .awN { … } }
'_media_(q)': { _starting_: { opacity: 0 } }                   // @media q { @starting-style { … } }
'_media_(q)': { '_cssProp_::backdrop': { transition: '…' } }   // @media q { .awN::backdrop { … } }
'_cssProp_::backdrop': { _starting_: { opacity: 0 } }          // @starting-style { .awN::backdrop { … } }
```

and this is one level too many:

```ts
'_media_(q)': { '_cssProp_::backdrop': { _starting_: { opacity: 0 } } }   // nothing
```

`_keyframes_`, `_fontFace_` and `_import_` leave the entry body rather than wrapping the rule, so
they are not frames and are read at the entry's own level only. One inside a directive block emits
nothing.

The consequence an earlier shape lived with is gone. **A dialog's `::backdrop` fades.** Its
transition is a `_cssProp_` inside the reduced-motion `_media_`, and its starting style is a
`_starting_` inside the top-level `_cssProp_::backdrop`. Design 192's amendment has the
frames.

The consequence that remains is not about nesting at all: an overlay's own `@starting-style` still
sits at the top level of its entry rather than inside the query. It could go inside now. It does
not, because a starting style alone changes nothing (it is only ever read by a transition), and
outside the query it is one rule instead of one per query.

`packages/ui/tests/internal.theme.test.ts` pins the new limit, in "a query block holds a pseudo
block and a starting style", "a pseudo block holds a starting style", "a third level of directive
compiles to nothing" and "a font face inside a directive block is not a frame and emits nothing".

## Why

`@starting-style` and `@container` are both a wrapper around the same rule body the compiler
already builds, so each is one branch beside `media` rather than a mechanism. Adding them here
rather than letting a component write raw CSS keeps the rule that every rule this package emits is
inside `@layer aweft` and is generated from a theme entry.

The list value is the other half of the same want: an entry that has to say one property twice had
no way to, because an entry is an object and an object has one value per key.

## Evidence

`packages/ui/tests/internal.theme.test.ts`: "a starting-style directive wraps the entry body",
"a container directive wraps the entry body in the query", "a list value is the property said once
per item, in order", "a list inside a pseudo block emits both", "a directive inside a directive
block compiles to nothing", and "two themes differing only in whether a value is a list get
different classes". `packages/ui/tests/look.test.ts` reads the compiled overlay rules.

**A misspelled directive is refused, amended.** `_medai_(min-width: 10px)` used to emit
no rule and say nothing, so the query never applied and the entry read correctly in the source.
`compileChain` now asserts on a key of the directive shape whose name is not one of the nine, and
the refusal names them: elem, children, cssProp, media, container, starting, keyframes, fontFace,
import. `packages/ui/tests/internal.theme.test.ts`, "a misspelled directive is refused, and the
refusal lists the directives", seen red with the check's own line disabled. `packages/ui/errors.txt`
is unchanged, because the refusal index reads `codecError` makers and this package refuses through
`assert`.

**The gate's literal check reads inside a list, amended.** `flatten` in
`packages/testing/src/theme.ts` recorded one undefined value for anything that was not a string or
an object, so an array was skipped whole and `padding: ['13px', '13px']` passed a check that
refuses `padding: '13px'`. A list is the declaration written once per item, so every item is now
checked as a declaration of the same property: the block above reports eight violations where it
reported two. `packages/testing/tests/theme.test.ts`, "a value written inside a list is a value
written where it stands", with the fallback idiom `appearance: ['none', 'base-select']` still
passing; seen red with the array branch taken out.

## What this costs

Three more shapes a reader of an entry has to know. `_container_` ships with nothing in this
package using it yet, because the entry that wants it is the responsive `Field` of a later pass.

## What would reverse this

A rule that genuinely needs a third level. The walk is already recursive over a selector and a
list of wrappers, so that is one constant, and the reason it is two rather than unbounded is that
nobody has written the entry that wants three and a bound is what keeps a typo from compiling to
something.
