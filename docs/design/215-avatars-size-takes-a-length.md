# 215: `Avatar`'s `size` takes a length, and its letters scale with the box

Amends design 199, which gave `Avatar` the three-step size axis and nothing else.

## Decision

**`size` takes `sm`, `lg`, nothing, or a CSS length.** A step name is a theme segment, as it was. A
length is written into the element's `style` as its `width` and its `height`, which is what `Icon`'s
`size` already does, and no segment is added. `size` is still a value or a cell, and a cell may hold
either kind: the segment and the style both follow it.

```tsx
<Avatar src={photo} fallback="AB" size="120px" />
```

**The fallback letters are derived from the box.** The `avatar` entry declares itself an inline-size
container and `avatar_fallback` sets its font size from that container's width, through a named
value on the entry:

```ts
avatar: { containerType: 'inline-size', ... },
avatar_fallback: { $avatarLetter: '40cqw', fontSize: '$avatarLetter', lineHeight: '$avatarLetter', ... },
```

So a 32px avatar's letters are 12.8px, a 36px avatar's are 14.4px, and a 120px avatar's are 48px,
with nothing to set per size and nothing to set for a length the theme never heard of. An
application that wants different proportions moves `$avatarLetter`.

**With a cell `src` the `<img>` is in the markup from the first paint.** This is what the component
already does and what design 199 described wrongly: the test for "no picture" is `empty(src)`, and a
cell object is not empty whatever it holds, so a cell `src` always builds the image and the image's
`src` follows the cell. A plain `src` of nothing still builds no image at all. The README says both
rather than "no `<img>` at all".

## Why

An avatar bigger than `lg` is an ordinary thing to want, and every way to it was a workaround: a
`<Theme>` provider wrapped round one avatar to move one font size, a `_children_span` rule written
against the component's insides, or giving up and leaving 48px letters at 12px. Design 193 keeps a
theme segment from reaching a component's parts, and that rule is not being reopened here; the way
out is the one `Icon` already has, because a size is a number and the component can write it.

The letters had to move with it or the length would be half a feature: an avatar at 120px with
12px initials is the third workaround, shipped.

A container query rather than a `font-size` computed in the component: the query is one rule that
is right for the three step names as well as for a length, and it needs nothing from the component
at all. The avatar is an `inline-block` with an explicit width in every case, so declaring it a
container constrains nothing it was not already constrained by.

`$avatarLetter` is a named value because design 119's check refuses a literal in an entry that is not
given a name, and because a proportion is exactly the kind of thing an application overrides.

The `<img>` sentence is a documentation defect, not a behaviour change. Reading the README and
writing a cell `src` leaves `<img src="">` in the markup; the behaviour is right, because a cell
that has not resolved yet is not the same as no picture, and only the sentence was wrong.

## Evidence

`packages/ui/tests/display.test.ts`: `size="sm"` and `size="lg"` put a segment on the chain and
nothing in the style; `size="120px"` puts `width` and `height` in the style and no segment; a cell
moving from `sm` to `96px` moves both; a plain `src` of nothing renders no `<img>` and a cell `src`
holding nothing renders one.

`packages/ui/tests/look.test.ts`: the `avatar` chain carries `container-type: inline-size` and the
`avatar_fallback` chain's font size resolves to the container unit, and neither part carries a
`[hidden]` rule of its own any more (design 207).

`packages/ui/tests/browser.test.ts`, measured in Chromium: an avatar at `size="120px"` measures
120 by 120, and its fallback's computed `font-size` is 48px, against 14.4px for the same avatar at
the default size.

The suite pins both branches: a step name is not written into the style, and a length is not put
on the chain as a segment.

## What this costs

A `size` the theme does not know is now written through rather than refused, so a typo
(`size="med"`) lands in the style as an invalid length rather than as a class that matches
nothing. Both are silent; this one is visible in the element's `style`.

The letters are a container unit, so an avatar whose box has no width, which nothing in this
package renders, has letters of zero.

## What would reverse this

Design 193 being reopened, so a theme segment can reach a component's parts. Then `size` on every
component takes a length the same way, and this becomes the first case of a general rule rather
than a component's own.
