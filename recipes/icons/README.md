# recipes/icons

One page, three ways of naming an icon, and the bundle weighed after.

- **Written out**: `<Icon name="lucide:check" />`. The build turns that literal into an import of
  that one icon.
- **A standard name**: `<Icons value={standard}>` puts the set's standard selection up, and
  `<Icon name="chevron-down" />` inside a `Button` finds it there.
- **Fetched when the page runs**: a name the source does not contain, resolved by `fromUrl`
  against a route this recipe serves, in the shape the public icon APIs answer in.

## See it

```
npx vite recipes/icons
```

The icon route is only in `main.ts`, so the third icon does not draw under `vite` on its own. The
other two do, and they are the ones the build decides.

## What the gate does with it

```
node --import @aweftjs/build/loader recipes/icons/main.ts
```

Builds the page with vite through `aweft()`, weighs the bundle, renders the same page to markup
with no browser at all, takes that markup over in place, and then drives it in Chromium.

The weighing is the point. It asks the installed set which of its 1,884 icons appear in the
bundle, by looking for each icon's own path data, and the answer has to be exactly the nine the
page named: nothing else from the set, and not the one the page only asks for when it runs.
Measured: a 101,804 byte bundle, of which 1,792 bytes is icon data, against a set that is
594,684 bytes.

It also asserts that the render waited for the fetch (the markup carries the fetched drawing) and
that the icon route was asked for exactly one name.

The hydration is checked by identity, not by comparing descriptions: two elements with the same
attributes are equal and are still two elements. Every element the server wrote outside an `<svg>`,
and each `<svg>` itself, has to be the same object afterwards; every node of the drawing inside an
`<svg>` has to be a different one, because a body written as markup is replaced rather than adopted
(design 131). No `<svg>` may be made through the document, and the page's bytes have to be the
bytes the server sent.

Then all four icons drew in a real browser, with the set's own 24 by 24 box on them.

## What it does not do for you

It does not choose your set: `npm install @iconify-json/<set>` is yours, and a set that is not
installed is a refusal at build time saying exactly that.

It does not cache the names it fetches. A name you know while you are writing the page should be
written out, and then nothing is fetched at all.

It does not decide what a standard name draws. A pack in front of `Icons` wins.

It does not carry a fetched icon across a hydration. A hydration waits for nothing, so a page
whose server fetched an icon ships what the server got, as a pack. That is the line in `main.ts`
that hands `Site` a pack rather than the resolver.
