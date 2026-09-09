# 111: The theme engine, its layer, and the five fixes

## Decision

`Theme.define(definitions)` takes one flat object whose keys are `_`-joined selector paths, and
merges it into a registry that is static data at import. An entry compiles to CSS the first time
a render asks for it, and the compiled result and the `<style>` element live on that render
(design 109).

**Matching.** An element's `theme` prop flattens to a class list, with `*` in front of it. An
entry matches when its segments are a subsequence of that list: gaps allowed, order enforced, so
`button_hovered` matches an element themed `button_primary_hovered`. Entries are ordered by the
index of their last matched segment, ties broken by the longer entry, and the ordered list is the
define chain. Later in the chain wins.

**Variables.** `$name` in a value resolves against the whole chain, starting at the highest
precedence entry and walking down to the lowest. So a generic `hovered` entry writes
`background: '$hover'` once and every component's own entry supplies its `$hover`.

**Functions are theme data.** `$fn(a, b)` calls a function the theme defines, found by the same
precedence walk as a variable and living in the same `$name` namespace: a `$name` whose value is a
function is a function, and a `$name` whose value is anything else is a variable. So an application
adds a function by defining it, and a nested `Theme` shadows one the same way it shadows a
variable. The colour functions (`$shiftBrightness`, `$brightness`, `$saturate`, `$hue`, `$alpha`,
`$invert`, `$contrast_text`, `$luminance`) and the arithmetic set (`$add`, `$sub`, `$mul`, `$div`,
`$mod`, `$min`, `$max`, `$floor`, `$ceil`, `$round`, `$if`) ship as entries of the **default
theme**, not as a table inside the package, so every one of them can be replaced. A `$name(`
nothing defines is written back out as it was read, so `calc()`, `rgb()` and every other CSS
function survive.

`$$` is a literal `$`, and `$size$px` works because a `$` ends a name and is eaten as its
terminator. The colour reader takes hex 3, 4, 6 and 8 digits, `rgb()`, `rgba()`, `hsl()`, `hsla()`
in both notations, the sixteen CSS names and `transparent`; anything else is not a colour and a
colour function hands it back untouched.

**The layer.** Every rule `ui` emits is inside `@layer aweft`, and `ui` emits no `!important`.
Unlayered styles beat every layer, so an application's own stylesheet beats the library with a
one-class selector and no specificity fight.

**Values stay literals.** A generated class carries the colour, not a `var()`. Emitting CSS custom
properties is not done.

### The five fixes

1. **At-rules leave the entry body.** `_fontFace_`, `_keyframes_` and `_import_` compile into a
   separate section of the sheet, once per definition per render, keyed by identity. Two class
   chains that both reach an entry emit its `@font-face` once, and recompiling an entry does not
   re-emit it, so a browser does not refetch the font. `@import` is implemented rather than
   parsed and dropped, and is emitted above the layer as `@import url(...) layer(aweft);`,
   because `@import` may not sit inside a layer block.
2. **`_cssProp_` tells `:` from `::`.** A key naming one of the CSS pseudo-elements gets `::`,
   and everything else gets `:`, so `_cssProp_focus` compiles to `.aw0:focus` and matches. A key
   written with its own leading colons is used as written.
3. **`_media_` exists.** `_media_(min-width: 40em)` wraps that entry's body in the query. A
   directive key is read as `_name_` and then everything after it, so a query with `_` in it
   survives.
4. **An identical re-define is tolerated.** Defining a key twice with a deep-equal body is a
   no-op; defining it twice with different bodies asserts. A module reloaded in development, and
   two copies of a package in one bundle, both stop being a crash.
5. **The sheet is per render.** No `<style>` is mounted at import time, and no theme edit reaches
   another render's page.

### Amended: a function is theme data

An earlier shape had the functions as a fixed table inside the package. Any theme has to be able
to define its own functions, so the table is gone, the built-ins are entries of the default theme,
and the `Decision` above is written as it now stands.

`defineTheme` merges an entry property by property rather than replacing it, which that requires:
the built-ins live in `*`, and an application adding one variable to `*` must not have to restate
them. What is refused is one property of one entry given two different values.

### Amended: a theme is known by what it says

Two of the fixes above were true only of themes that kept their object identity, which the
amendment above made a smaller set than it looks.

**Fix 4, the tolerated re-define, now compares a function by its source.** It compared by identity,
so an entry holding a theme function was refused on a second define. Any theme may hold one, and
the README's own example of an application function, in a module loaded twice, was a crash: `the theme entry * already sets $em to something else`. Checked by `a module
holding a theme function loads twice without a refusal` in `packages/ui/tests/theme.test.ts`.

**The class cache is keyed on what a theme says, not on which object said it.** It was keyed on
the `Definitions` object's identity, and the rule list is only ever appended to, so a
`<Theme value={{...}}>` written inline (which is how `README.md` writes it) minted a fresh class
and a fresh copy of its rules on every mount. Two thousand mount-and-unmount cycles took the sheet
from 212 characters to about 18,000 and the counter to `aw-200`. A theme now keys by its contents,
read once per object, with a function read as its source, and `themeAt` caches the merge the same
way. Two thousand cycles now leave the sheet the size of one, checked by `a Theme written inline is
one theme, however many times it mounts` and `two themes that say the same thing get the same
class, and two that do not do not`.

What this costs: reading a theme's contents once per object, which for a provider is the override
chain and not the whole theme, and a cache of merges held by string rather than weakly. Both are
bounded by the number of different themes a page has, which is what the sheet is bounded by too.

## Why

Each fix answers a defect seen in real call sites. The layer is the largest
quality-of-life gain available for one line of output, and it is what lets `ui` ship zero
`!important`: `!important` reverses layer order, so a library `!important` would beat an
application's.

Values stay literals because the class cache already makes a theme swap cheap: a swap is a class
attribute write, not a stylesheet rebuild.

## What this costs

A page with two themes generates two sets of classes rather than swapping one variable. That is
what makes two themes on one page work at all.

The pseudo-element list is a fixed table in this repo, so a pseudo-element the CSS working group
adds later gets one colon until the table learns it. The escape hatch is writing the colons.

## What would reverse this

Fix 2's table growing faster than it can be kept, at which point the leading-colon spelling
becomes the only one and the table goes.
