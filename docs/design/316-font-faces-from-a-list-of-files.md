# 316: Font faces from a list of files

Builds on design 111 (directives in a theme entry) and design 257 (why a face is declared once).

## Decision

`@aweftjs/ui` exports `fontFaces(family, files, options?)`. It answers the `_fontFace_` directives
for one family, one per file, as a theme entry to spread into the entry the page's root wears:

```ts
Theme.define({ page: { ...fontFaces('IBM Plex Sans', [
	{ src: '/plex/Regular.woff2', weight: 400 },
	{ src: '/plex/Italic.woff2', weight: 400, style: 'italic' },
	{ src: '/serif/Variable.woff2', weight: '200 900', range: 'U+0000-00FF' },
]), fontFamily: '"IBM Plex Sans", $font' } });
```

Each file is `src`, `weight` (a number, or two numbers in a string for a variable file), `style`
(`normal` unless set) and `range` (a `unicode-range`). Every face gets `font-display: swap` unless
`options.display` says otherwise, and a `format()` named from the file's extension. The family and
the URL are written quoted, with a quote or a backslash in either escaped. A `$` in either is a loud
assert, because the stylesheet reads it as a theme variable and writes that variable's value. Each
directive is keyed by the family, the file and the face it declares, so two calls spread into one
entry keep every face, and one file declared upright and slanted is two faces.

## Why

Four applications write a `fonts.ts` that builds these directives with a loop of their own, the same
twenty lines in three of them. Each spells the format, the quoting and the display by hand, and each
key scheme is its own.

## What this costs

One export, and a shape for a face that is not CSS's own: `weight` and `range` rather than
`fontWeight` and `unicodeRange`. A face that needs a descriptor this does not name, such as
`font-stretch`, is written as a directive by hand, as today.

## Evidence

`packages/ui/tests/fonts.test.ts`: the directives a list makes, rendered into a stylesheet, with the
format per extension, the quoting, a variable weight, a range, the display option, two calls keeping
every face, and an empty family, list or source refused.

## What would reverse this

An application that needs a face declared from `local()` names, which would make `src` a list.
