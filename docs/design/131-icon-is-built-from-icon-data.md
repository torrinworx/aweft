# 131: `Icon` is built from icon data, and the default pack is built in

Amended: a lookup that answers late says the same thing a lookup that answers now says, and `Icon`
takes an `element` like every other component here. Amended by design 144: the default pack is
withdrawn, `Icons` starts empty, and a pack's root size applies to the icons under it.

## Decision

**One driver, one data shape.** An icon is a plain object:

```ts
interface IconData {
	body: string;          // what goes inside the <svg>
	width?: number;        // the drawing's own box, 16 when it says nothing
	height?: number;
	left?: number;         // where that box starts, 0 when it says nothing
	top?: number;
	rotate?: number;       // quarter turns
	hFlip?: boolean;
	vFlip?: boolean;
}
```

That is the shape the icon sets in the wild already publish, so an application installs a pack and
hands it over without a converter.

**The element is built, not parsed.** `Icon` makes one `<svg>` with this package's `svg`, and sets
`viewBox`, `width`, `height`, `class` and `fill` from the data and the props. Nothing reads an
`<svg …>` string to get them. The `body` is the drawing itself and is written into the element as
markup, which is the one thing it can be: the light tree and a browser both take it, so a static
render writes the paths and a hydration finds them already there.

`rotate`, `hFlip` and `vFlip` become a `transform` on an inner `<g>`, so the element's own
`transform` stays free for the `rot` prop.

**One element for the component's life.** A `name` that is a cell swaps the body and the attributes
on the element that is already there. The node is never replaced, so a caller holding it keeps
holding it and a hydration never sees one element become another.

**`Icon` props.** `name` is icon data, or a string looked up through the `Icons` context. `size` is
a CSS length, `$iconSize` by default, which is `1em`, so an icon is the size of the text beside it.
`label` gives the element `role="img"` and that `aria-label`; without one the element is
`aria-hidden="true"` and `focusable="false"`, because an icon beside a word it repeats is noise to
a screen reader. `rot` is degrees. The fill is `currentColor`.

**`Icons` is a stack, newest first.** Its value is a pack or a resolver, or a list of them, and the
transform puts what a provider names in front of what it inherited. A pack is
`{ prefix, icons, aliases? }`; a resolver is `(name) => data | Promise<data> | null`. A lookup walks
the stack in order and takes the first answer that is not null. A resolver that answers a promise is
declared `pending`, so a static render waits for it and a page shows nothing in that spot until it
lands.

**A name that nothing answers renders nothing** and asserts, naming the name and the number of
packs that were asked. An icon that is missing is a typo, not a state.

That holds whenever the answer arrives. A resolver that answers a promise of null asserts the same
way, and one that fails asserts naming the reason it gave; the element stays empty either way.
Because the answer lands after every caller has gone, those two are thrown where the host already
reports an error rather than into a promise the render machinery holds, which is where an assert
inside a promise handler would otherwise be swallowed.

**The newest name wins.** Each lookup is stamped, and a resolution that is not the newest is
dropped. A `name` cell that changes while a slow lookup is out would otherwise be overwritten by
the older answer whenever it happened to land last.

**`element` hands in the `<svg>` to decorate**, as it does on every control (design 128), and a
node that is not an `<svg>` is the same assert the controls give. An earlier shape had no `element`
prop at all and wrote the node out as `element="[object Object]"`.

**Amended by design 144.** The paragraph below is withdrawn. The eight glyphs and the
file holding them are deleted, `Icons` starts empty, `IconPack` carries a root `width` and
`height` that apply to every icon under it that declares none, and the assert for a name nothing
answers now says how to answer it. What follows is what was decided before that.

**The default pack ships inside this package.** It is a small set drawn for this package, in the
shape above, and it is the pack at the bottom of every stack. It holds what this package itself needs
and the few every application reaches for: `chevron-down`, `chevron-right`, `chevron-up`,
`chevron-left`, `check`, `x`, `alert` and `search`.

## Why

One driver, in the shape the icon sets already use, with a default pack so a bare `Icon` renders.
A driver per pack would be a package per pack.

The default pack is drawn here rather than depended on.
`packages/testing/scripts/check-dependencies.ts` holds the allowlist the gate enforces, and it
names no icon set; widening it is a policy change, not a side effect of wanting eight glyphs.
Eight paths written by hand cost less than a dependency, and an application that wants a real set
installs one and hands it to `Icons`, which is the case the context exists for.

Every path in the default pack is drawn for this package on a 24 by 24 grid out of straight lines
and one radius. No path data is copied from any icon set.

The class the theme generates, and the caller's own `class` beside it, go through the one place
that flattens a theme and follows a cell inside it, rather than through a second copy in this
file. An `<svg>` has no `theme` prop (design 107), so the flattening has to be asked for rather
than happening on the element; asking for it once is what makes `class` append here as it appends
everywhere else, and a `theme` that is a cell followed here as it is followed everywhere else.

`aria-hidden` by default rather than `role="img"` by default, because most icons in a real page sit
next to the word they mean, and a screen reader that reads both reads everything twice.

## What this costs

The default pack is eight icons and will never be a set. An application that wants a fuller set
installs one; that is the seam, and `Icons` is where it plugs in.

`body` is markup and is written into the element as markup. It is data the application chose, the
same as a `src` on an image, and this package does not sanitise it. A pack from a place you do not
trust is a script you did not read.

**On a hydration the `<svg>` is adopted and the drawing is not.** The nodes the body parses to did
not come through `dom`'s node factory, so `dom` reads them as the caller's own nodes and puts them
where the server's were rather than pairing them. The element, its attributes and its place in the
page are the server's; the paths inside it are the client's. What that costs is one subtree swap
per icon on the first mount of a hydrated page, and nothing after it. Checked by `an icon renders
to markup, and the element is adopted while the drawing is the client's` in
`packages/ui/tests/icon.test.ts`, which asserts both halves.

## What would reverse this

An icon pack format the sets move to that this shape cannot hold, at which point `Icons` grows a
second resolver kind rather than `Icon` growing a second driver.
