# 119: The theme check, and what counts as a theme definition

## Decision

`packages/testing/scripts/check-theme.ts` runs in the root gate over `packages/ui/src` and
`recipes/`. Its logic is `checkTheme` and `themeTokens` in `packages/testing/src/theme.ts`, exported
from `@aweftjs/testing` with their two types, `ThemeSource` and `ThemeViolation`, the way every
other gate check keeps its logic in `src` and a thin script in `scripts`. Those four names are what
the check adds to that package's surface. Printing a violation as a console line stays in the
script, because that is one script's
output rather than a capability a caller reaches for.

The script takes paths, so an application can point it at its own source later. Each path is
resolved against the repository root, so an absolute path is taken as it is, and a path holding no
`.ts` or `.tsx` file fails rather than reporting that every value was named. Nothing makes an
application run it.

**What a theme definition is, precisely.** A theme definition is where a value is given a name. The
check reads the source as a tree, not as text, and it looks in exactly three places:

1. Inside an object literal handed to `Theme.define(...)` or `defineTheme(...)`, every property
   whose key does **not** start with `$`, following nested blocks (`_cssProp_`, `_media_`, `_elem_`,
   `_children_`). A property whose key starts with `$` is a named value: its literal is the
   definition and is skipped.
2. Inside a `style` object written on an element: `style={{ ... }}` in JSX, or the `style` property
   of the props object of an `h(...)` call.
3. Nowhere else. A string sitting in ordinary code is not in a CSS position and is not read.

The `value` given to a `Theme` provider is skipped whole, in either spelling. That is what keeps
the check off a page's own theme and off a nested theme, so the theme engine keeps its freedom.

**What fails.** In one of those positions:

- a **colour**: a hex colour, an `rgb()`, `rgba()`, `hsl()` or `hsla()` call, or one of the sixteen
  CSS colour names. `transparent`, `currentColor` and `inherit` are keywords, not colour choices,
  and pass;
- a **size**: a number with `px`, `rem` or `em` on it, or a bare number in one of the properties a
  bare number means pixels in. Zero passes. Percentages, `fr`, `vw` and `ch` are layout rather than
  design values and pass;
- a **duration**: a number with `ms` or `s` on it;
- an `outline` set to `none` or `0` in an entry that mentions `$ring` nowhere.

Each failure names the file, the line, the property, the literal, and the role to use: the check
holds the role table of design 115 and suggests by property, so a colour in `background` is told
to use `$surface`, a colour in `color` is told `$foreground`, a size in `padding` is told
`$space`.

**The snapshot.** `packages/ui/tokens.txt` lists every `$name` the package defines, sorted, one per
line. It is generated from the source, never written by hand, regenerated with
`node packages/testing/scripts/check-theme.ts --write`, and compared on every gate run the way
`surface.txt` is. Widening the contract is therefore a diff in the commit.

## Why

The risk in a check like this is that it fights the theme engine's freedom. The rule above is
narrow enough not to: everything the engine lets an application do with `$name`, nested themes and
its own functions is untouched, and what is refused is one thing only, a value a component uses
without naming it.

The check reads the tree rather than the text because a text scan finds `#abcdef` in an unrelated
string and misses `padding: 8`. This repo has already paid once for a scanner over source, in the
import checker.

## Evidence

`packages/testing/tests/theme.test.ts` plants each of the four failures in a fixture and asserts the
check catches it and names the role, plants a custom nested theme full of literals and asserts it
passes, and asserts a role added to the source changes what `themeTokens` returns.
`packages/ui/tests/look.test.ts`, in "tokens.txt lists every name the package defines", asserts the
committed `tokens.txt` matches what the source defines. `packages/testing/tests/theme.test.ts` also
runs the script itself three times, on an absolute path holding a planted literal, on a path that
holds nothing, and on a clean path. The gate runs `npm run theme:check`.

## What this costs

Three known limits, written down because a checker whose gaps are unknown is worse than one whose
gaps are written down.

1. Only an object literal written where it is used is read. A style object built by a helper and
   returned, as `boxOf` in `popup.tsx` does, is invisible to the check.
2. The size-property list is a copy of the one in `packages/ui/src/values.ts`, because a gate script
   runs without this stack's own loader and cannot import a `.tsx` package. The two can drift; the
   cost of drifting is a bare number that goes unchecked.
3. A `$name` may hold anything, so a component that gives a literal a name to get past the check has
   got past the check. That is the intended escape hatch and it is one word in review.

## What would reverse this

An application adopting the check and finding the three positions too narrow to be worth running.
Then the check grows a fourth position rather than a text scan.
