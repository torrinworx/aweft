# 207: `hidden` hides a themed element

Amends design 199, which gave `Avatar`'s two parts a `[hidden]` rule of their own because nothing
else had one.

## Decision

**The root `*` entry carries `[hidden] { display: none }`, so every themed element honours the
attribute.** The rule is written as `'_cssProp_:is([hidden])'` on the `*` entry, which the directive
grammar already compiles (design 190): the key's rest starts with a colon, so it is appended to the
generated class as written and the rule lands inside `@layer aweft` with the rest of the theme.

**`Avatar`'s two per-part rules go.** `avatar_image` and `avatar_fallback` said the same thing
twice; the root entry now says it once for every entry there is.

## Why

A themed element given `hidden` stayed on the screen. Measured on the catalogue: a themed button
given `hidden` computes `display: flex`, and an unthemed one computes `none`. The only way round
it was an entry of the page's own.

The host's own `[hidden] { display: none }` is unlayered, and an unlayered rule loses to every
layered one whatever its specificity. Every entry that lays an element out declares a `display`
inside `@layer aweft`, so the host's rule never applies to a themed element. Nothing in the
package said so, and nothing failed: the attribute is written, the accessibility tree drops the
element, and the element is still drawn.

Putting it on the root entry rather than on each entry that declares a `display` is the same
argument design 118 makes for the focus ring: no component has to remember it and none can forget
it. `:is([hidden])` rather than a bare `[hidden]` keeps the rule at the same specificity the two
`Avatar` rules already used, which is the generated class plus one attribute, so it beats every
`display` any entry of the chain declares and loses to an application's own `!important`-free rule
of higher specificity, which is what an application that wants a hidden element drawn would write.

## Evidence

`packages/ui/tests/look.test.ts`: the compiled sheet for a `button` chain carries a rule whose
selector is the chain's class plus `:is([hidden])` and whose body is `display: none`, and the two
`avatar` part chains no longer carry one of their own.

`packages/ui/tests/browser.test.ts`, measured in Chromium: a themed `<button>` given `hidden`
computes `display: none`, and the same button without the attribute computes `inline-flex`.

## What this costs

One more rule per generated class in the sheet. An application that wants a themed element drawn
while it carries `hidden` now has to out-specify a rule that did not exist, which is a change in
behaviour for a page that was relying on the bug.

## What would reverse this

An application that needs `hidden` to mean "out of the accessibility tree and still laid out".
That is not what the attribute means, so the reversal would be a second attribute rather than this
rule going away.
